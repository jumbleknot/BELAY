#!/usr/bin/env node
// Measure the repository at one commit, for the learnings document's measurement log (feature 013).
//
// WHY THIS EXISTS. MovieCollectionManager kept a log of its size and shape by hand, and measured the
// hand counts as wrong by about a month's growth (4.5% of its production code). So every number in
// docs/BELAY-Learnings.md Part 3 comes from this script, and `--append-log` writes the column itself:
// a pasted number has the same failure mode as a hand-counted one (research R5).
//
// WHY ONLY GIT OBJECTS. The tree is read with `ls-tree` and `cat-file --batch`, never from disk, so
// uncommitted edits, ignored files and another session's work in the shared checkout cannot move a
// number, and the same commit always gives the same output (research R1).
//
// Usage:
//   node scripts/count-repo-metrics.mjs [--rev <commit>] [--json]
//   node scripts/count-repo-metrics.mjs [--rev <commit>] --append-log <file>
//
// Exit codes: 0 counted (and written) · 1 unknown rev, not a repository, malformed allowlist, or
// --append-log refused · 2 bad arguments. Nothing is printed to stdout on 1 or 2.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { ArgvError, dieOnArgvError, partitionArgsWithValues, wantsHelp } from './lib/argv-contract.mjs';
import { isMain } from './lib/is-main.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = 'scripts/count-repo-metrics.mjs';

const RULES = `Line categories (non-blank lines; each tracked file is in exactly one, first rule wins):
  not counted  vendored Spec Kit scaffolding (.specify/**, .claude/skills/speckit-*/**), test fixtures
               (any "fixtures" path segment), Semgrep rule samples (security/sast/rules/**), generated
               reports (security/sast/reports/**), pnpm-lock.yaml
  test         any "__tests__" path segment, or a basename *.test.*
  docs         *.md
  code         *.mjs *.js *.cjs *.ts *.sh *.ps1 *.py, Dockerfile and *.Dockerfile, .forgejo/workflows/*.y(a)ml
  not counted  everything else (configuration JSON and YAML, LICENSE, .gitkeep, ...)
  A blob with a NUL byte in its first 8 KiB is binary and counts no lines.
  Caveat: the project-owned .claude/skills/speckit-taskstoissues is excluded by the speckit-* prefix.

Metrics, at the counted commit:
  Features                    specs/NNN-*/ directories that contain spec.md
  Commits                     commits reachable from it, merges included (unavailable from a shallow clone)
  Test declarations           test(), test.skip/todo/only(), it(), t.test() calls in test files
  Gate scripts                distinct scripts/*.mjs|sh|ps1 named by scripts/project.json's lint target
  Guard tests                 scripts/__tests__/*.guard.test.mjs
  Task lists [with Verify RED] specs/NNN-*/tasks.md [containing "Verify RED"]
  Allowlist entries           entries in security/*/allowlist.yaml (finding allowlists; not the egress list)`;

const USAGE = `usage: node scripts/count-repo-metrics.mjs [--rev <commit>] [--json]
       node scripts/count-repo-metrics.mjs [--rev <commit>] --append-log <file>

Measures the COMMITTED tree of one commit (default HEAD); the working copy never changes a number.
  --rev <commit>       the commit to count
  --json               print the snapshot as JSON
  --append-log <file>  add the snapshot as a new column to the log table between
                       <!-- metrics-log:start --> and <!-- metrics-log:end --> in <file>

${RULES}`;

/** The metrics in log-table order, with their row labels (contracts/cli.md). */
const METRICS = [
  ['features', 'Features'],
  ['commits', 'Commits'],
  ['codeLines', 'Code lines (non-blank)'],
  ['testLines', 'Test lines (non-blank)'],
  ['docLines', 'Documentation lines (non-blank)'],
  ['testDeclarations', 'Test declarations'],
  ['gateScripts', 'Gate scripts (scripts:lint)'],
  ['guardTests', 'Guard tests'],
  ['taskLists', 'Task lists'],
  ['taskListsWithVerifyRed', 'Task lists with Verify RED'],
  ['allowlistEntries', 'Allowlist entries'],
];
const SCRIPT_ROW = 'Script commit';

class CountError extends Error {}

// ── classification and counting (research R2, R3) ────────────────────────────────────────────────

const CODE_EXT = /\.(mjs|js|cjs|ts|sh|ps1|py)$/;

/** 'code' | 'test' | 'docs' | null (not counted), by the ordered rules in RULES. */
export function classifyPath(path) {
  const segments = path.split('/');
  const base = segments.at(-1);
  if (path.startsWith('.specify/') || /^\.claude\/skills\/speckit-[^/]+\//.test(path)) return null;
  if (segments.includes('fixtures')) return null;
  if (path.startsWith('security/sast/rules/') || path.startsWith('security/sast/reports/')) return null;
  if (base === 'pnpm-lock.yaml') return null;
  if (segments.includes('__tests__') || /\.test\.[^/]+$/.test(base)) return 'test';
  if (base.endsWith('.md')) return 'docs';
  if (CODE_EXT.test(base) || base === 'Dockerfile' || base.endsWith('.Dockerfile')) return 'code';
  if (/^\.forgejo\/workflows\/[^/]+\.ya?ml$/.test(path)) return 'code';
  return null;
}

const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

export function countNonBlankLines(buf) {
  if (isBinary(buf)) return 0;
  return buf.toString('utf8').split('\n').filter((line) => /\S/.test(line)).length;
}

const DECLARATION = /^\s*(?:await\s+)?(?:test|it|t\.test)(?:\.(?:skip|todo|only))?\(/;

export function countTestDeclarations(text) {
  return text.split('\n').filter((line) => DECLARATION.test(line)).length;
}

/** Distinct scripts the lint target runs. `projectJson` is the file's text, or null when absent. */
export function countGateScripts(projectJson) {
  if (projectJson == null) return 0;
  let project;
  try {
    project = JSON.parse(projectJson);
  } catch (e) {
    throw new CountError(`scripts/project.json is not valid JSON: ${e.message}`);
  }
  const options = project?.targets?.lint?.options ?? {};
  const commands = options.commands ?? (options.command ? [options.command] : []);
  const scripts = new Set();
  for (const c of commands) for (const m of String(c).matchAll(/scripts\/[\w./-]+\.(?:mjs|sh|ps1)\b/g)) scripts.add(m[0]);
  return scripts.size;
}

// ── reading one commit (research R1, R4) ─────────────────────────────────────────────────────────

function git(cwd, args, { input, binary = false } = {}) {
  const r = spawnSync('git', args, { cwd, input, maxBuffer: 1 << 30, encoding: binary ? 'buffer' : 'utf8' });
  if (r.error) throw new CountError(`cannot run git: ${r.error.message}`);
  return { ok: r.status === 0, out: r.stdout, err: binary ? r.stderr.toString() : r.stderr };
}

/** Read many blobs in one `cat-file --batch`, parsing by declared size: content may hold any bytes. */
function readBlobs(cwd, oids) {
  if (!oids.length) return new Map();
  const r = git(cwd, ['cat-file', '--batch'], { input: Buffer.from(`${oids.join('\n')}\n`), binary: true });
  if (!r.ok) throw new CountError(`git cat-file failed: ${r.err.trim()}`);
  const out = r.out;
  const blobs = new Map();
  let at = 0;
  while (at < out.length) {
    const nl = out.indexOf(0x0a, at);
    const [oid, type, size] = out.subarray(at, nl).toString().split(' ');
    if (type !== 'blob') throw new CountError(`git cat-file: unexpected object ${oid} (${type})`);
    const start = nl + 1;
    blobs.set(oid, out.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return blobs;
}

function scriptCommitIn(scriptRepo) {
  const log = git(scriptRepo, ['log', '-1', '--format=%h', 'HEAD', '--', SCRIPT_PATH]);
  const short = log.ok ? log.out.trim() : '';
  if (!short) return 'untracked';
  const status = git(scriptRepo, ['status', '--porcelain', '--', SCRIPT_PATH]);
  return status.ok && status.out.trim() ? `${short}+dirty` : short;
}

function countAllowlist(path, buf) {
  let doc;
  try {
    doc = parseYaml(buf.toString('utf8'));
  } catch (e) {
    throw new CountError(`${path} is not valid YAML: ${e.message}`);
  }
  if (doc == null) return 0;
  if (!Array.isArray(doc)) throw new CountError(`${path}: expected a YAML list of entries, found ${typeof doc}`);
  return doc.length;
}

/** The MetricSnapshot of one commit (data-model.md). */
export function measureCommit({ cwd = process.cwd(), rev = 'HEAD', scriptRepo = REPO_ROOT } = {}) {
  const inside = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) throw new CountError(`${cwd} is not a git repository`);
  const resolved = git(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  if (!resolved.ok) throw new CountError(`unknown commit: ${rev}`);
  const sha = resolved.out.trim();
  const committedAt = Number(git(cwd, ['show', '-s', '--format=%ct', sha]).out.trim());
  const commitDate = new Date(committedAt * 1000).toISOString().slice(0, 10);

  const tree = git(cwd, ['ls-tree', '-r', '-z', '--full-tree', sha]);
  if (!tree.ok) throw new CountError(`git ls-tree failed: ${tree.err.trim()}`);
  const entries = tree.out.split('\0').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    const [mode, type, oid] = meta.split(' ');
    return { mode, type, oid, path };
  }).filter((e) => e.type === 'blob' && e.mode !== '120000');

  const wanted = entries.filter((e) => classifyPath(e.path) || e.path === 'scripts/project.json'
    || /^security\/[^/]+\/allowlist\.yaml$/.test(e.path) || /^specs\/\d{3}-[^/]+\/tasks\.md$/.test(e.path));
  const blobs = readBlobs(cwd, [...new Set(wanted.map((e) => e.oid))]);
  const blobOf = (e) => blobs.get(e.oid);

  const metrics = Object.fromEntries(METRICS.map(([key]) => [key, 0]));
  const allowlists = {};
  for (const e of entries) {
    const category = classifyPath(e.path);
    if (category === 'code') metrics.codeLines += countNonBlankLines(blobOf(e));
    if (category === 'docs') metrics.docLines += countNonBlankLines(blobOf(e));
    if (category === 'test') {
      const buf = blobOf(e);
      metrics.testLines += countNonBlankLines(buf);
      if (!isBinary(buf)) metrics.testDeclarations += countTestDeclarations(buf.toString('utf8'));
    }
    if (/^specs\/\d{3}-[^/]+\/spec\.md$/.test(e.path)) metrics.features++;
    if (/^specs\/\d{3}-[^/]+\/tasks\.md$/.test(e.path)) {
      metrics.taskLists++;
      if (blobOf(e).toString('utf8').includes('Verify RED')) metrics.taskListsWithVerifyRed++;
    }
    if (/^scripts\/__tests__\/[^/]+\.guard\.test\.mjs$/.test(e.path)) metrics.guardTests++;
    if (/^security\/[^/]+\/allowlist\.yaml$/.test(e.path)) allowlists[e.path] = countAllowlist(e.path, blobOf(e));
  }
  const project = entries.find((e) => e.path === 'scripts/project.json');
  metrics.gateScripts = countGateScripts(project ? blobOf(project).toString('utf8') : null);
  metrics.allowlistEntries = Object.values(allowlists).reduce((a, b) => a + b, 0);

  const shallow = git(cwd, ['rev-parse', '--is-shallow-repository']).out.trim() === 'true';
  metrics.commits = shallow ? null : Number(git(cwd, ['rev-list', '--count', sha]).out.trim());

  const sortedAllowlists = Object.fromEntries(Object.entries(allowlists).sort(([a], [b]) => a.localeCompare(b)));
  return { rev: sha, commitDate, scriptCommit: scriptCommitIn(scriptRepo), metrics, allowlists: sortedAllowlists };
}

// ── output ───────────────────────────────────────────────────────────────────────────────────────

const shownValue = (key, value) => (key === 'commits' && value === null ? 'unavailable (shallow history)' : String(value));

export function formatText(snapshot) {
  const width = Math.max(...METRICS.map(([, label]) => label.length)) + 2;
  const lines = [`count-repo-metrics: ${snapshot.rev} (${snapshot.commitDate}), script ${snapshot.scriptCommit}`];
  for (const [key, label] of METRICS) lines.push(`  ${label.padEnd(width)} ${shownValue(key, snapshot.metrics[key])}`);
  return `${lines.join('\n')}\n`;
}

// ── the log table (research R5, data-model.md "Log table") ───────────────────────────────────────

const START = '<!-- metrics-log:start -->';
const END = '<!-- metrics-log:end -->';
const MISSING = '—';

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const row = (values) => `| ${values.join(' | ')} |`;
const headerDate = (h) => /(\d{4}-\d{2}-\d{2})\s*$/.exec(h)?.[1] ?? '';
const headerSha = (h) => /`([0-9a-f]+)`/.exec(h)?.[1] ?? '';

/** Return `markdown` with `snapshot` merged in as a new column. Throws rather than write a bad table. */
export function mergeLogColumn(markdown, snapshot) {
  const s = markdown.indexOf(START);
  const e = markdown.indexOf(END);
  if (s === -1 || e === -1 || e < s) throw new CountError(`the log needs both markers, ${START} then ${END}`);
  if (snapshot.metrics.commits === null) throw new CountError('refusing to log a snapshot from a shallow history: its commit count is unknown');

  const body = markdown.slice(s + START.length, e).trim();
  const lines = body ? body.split('\n') : [];
  let headers = [];
  let labels = [SCRIPT_ROW, ...METRICS.map(([, label]) => label)];
  let values = new Map(labels.map((l) => [l, []]));
  if (lines.length) {
    headers = cells(lines[0]).slice(1);
    labels = [];
    values = new Map();
    for (const line of lines.slice(2)) {
      const [label, ...rest] = cells(line);
      labels.push(label);
      values.set(label, rest);
    }
    for (const [, label] of METRICS) {
      if (!values.has(label)) { labels.push(label); values.set(label, headers.map(() => MISSING)); }
    }
  }

  const short = snapshot.rev.slice(0, 7);
  if (headers.some((h) => headerSha(h) && (snapshot.rev.startsWith(headerSha(h)) || headerSha(h).startsWith(short)))) {
    throw new CountError(`${short} is already logged; a column is never edited`);
  }

  const fresh = new Map([[SCRIPT_ROW, snapshot.scriptCommit], ...METRICS.map(([key, label]) => [label, shownValue(key, snapshot.metrics[key])])]);
  let at = headers.findIndex((h) => headerDate(h) > snapshot.commitDate);
  if (at === -1) at = headers.length;
  headers.splice(at, 0, `\`${short}\` ${snapshot.commitDate}`);
  for (const label of labels) values.get(label).splice(at, 0, fresh.get(label) ?? MISSING);

  const table = [row(['Metric', ...headers]), row(['---', ...headers.map(() => '---')]),
    ...labels.map((label) => row([label, ...values.get(label)]))].join('\n');
  return `${markdown.slice(0, s + START.length)}\n${table}\n${markdown.slice(e)}`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

export function main(argv = process.argv.slice(2)) {
  if (wantsHelp(argv)) {
    console.log(USAGE);
    return 0;
  }
  let values;
  let flags;
  try {
    ({ values, flags } = partitionArgsWithValues(argv, { accepted: ['--json'], withValues: ['--rev', '--append-log'], usage: USAGE }));
    if (flags.has('--json') && values.has('--append-log')) throw new ArgvError(`--json and --append-log cannot be combined\n\n${USAGE}`);
  } catch (err) {
    dieOnArgvError(err, { hard: false });
    return process.exitCode;
  }
  try {
    const snapshot = measureCommit({ rev: values.get('--rev') ?? 'HEAD' });
    const logFile = values.get('--append-log');
    if (logFile) {
      let text;
      try {
        text = readFileSync(logFile, 'utf8');
      } catch (e) {
        throw new CountError(`cannot read ${logFile}: ${e.message}`);
      }
      writeFileSync(logFile, mergeLogColumn(text, snapshot));
    }
    process.stdout.write(flags.has('--json') ? `${JSON.stringify(snapshot, null, 2)}\n` : formatText(snapshot));
    return 0;
  } catch (err) {
    if (!(err instanceof CountError)) throw err;
    console.error(`count-repo-metrics: ${err.message}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main();
