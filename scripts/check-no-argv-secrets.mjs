#!/usr/bin/env node
// Argv-secret gate — keep credentials off the Maestro command line.
//
// WHY THIS EXISTS. A `maestro test … --env <KEY>=<value>` argument re-serialises the value onto the
// runner process's argv, where `ps` and `/proc/<pid>/cmdline` show it to every user and process on a
// shared CI host. Ported from MovieCollectionManager (MCM), where the CI runner's multi-line
// `--env FOO="$FOO" \` invocation put an E2E password and a model API key on argv. The fix there was
// a wrapper that hands secrets to Maestro through its `MAESTRO_`-prefixed environment channel; this
// gate keeps the argv form from coming back. BELAY's constitution makes Maestro the mobile E2E runner
// (flows under `frontend/<app>/tests/e2e/mobile/`), so the gate is in place before the first flow.
//
// THE RULE. Any in-scope tracked file that passes a credential-NAMED argument — `--env <KEY>=` or
// `-e <KEY>=`, where <KEY> contains KEY, PASSWORD, SECRET or TOKEN (case-insensitive) — in a command
// that mentions `maestro` fails. The value is irrelevant: the argument PATTERN is the violation.
// Backslash line continuations are joined first, so a flag on a later line of the same command is
// still tied to `maestro`; the finding points at the command's first line. Any wrapper whose path
// names `maestro` (a `maestro-run.sh`, say) is covered the same way: forwarding a secret to the
// wrapper on argv re-exposes it there.
//
// SCOPE (tracked files only, from `git ls-files`; generalised from MCM's one wrapper and its one app
// directory to wherever BELAY may invoke Maestro):
//   - shell and PowerShell scripts anywhere (`*.sh`, `*.bash`, `*.ps1`, `*.psm1`), and all of `scripts/`
//   - CI workflows (`.forgejo/workflows/`, `.github/workflows/`)
//   - `package.json` / `project.json` anywhere (their command strings)
//   - every file under a `tests/e2e/mobile/` directory, and any path naming `maestro`
//   - the instruction files and docs an agent copies commands from: `AGENTS.md`, `CLAUDE.md`, `docs/`
//     and `openwiki/`
// Out of scope: `specs/` and `docs/proposals/` (historical design records), and this file, which holds
// the pattern as regex source.
//
// Usage:
//   node scripts/check-no-argv-secrets.mjs              # scan tracked files; exit 1 on any hit
//   node scripts/check-no-argv-secrets.mjs --selftest   # prove detection on planted lines
//   node scripts/check-no-argv-secrets.mjs --dir <root> # scan another git work tree (tests use this)
//   node scripts/check-no-argv-secrets.mjs --help
//
// Exit codes: 0 clean / selftest passed · 1 flagged argument / selftest broken · 2 bad args or the
// tree cannot be listed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, posix } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-no-argv-secrets.mjs';
const RULE = 'argv-secret';
const USAGE = 'Usage: check-no-argv-secrets.mjs [--selftest | --dir <root> | --help]';

// --- Detection ---------------------------------------------------------------------------------------
// A credential-shaped env-var NAME (case-insensitive substring). A username (TEST_USER) and per-run
// non-secret values (COLLECTION_NAME, BASE_URL) do NOT match.
export const SECRET_KEY = /KEY|PASSWORD|SECRET|TOKEN/i;
// A `--env <NAME>=` / `-e <NAME>=` argument. Tolerant of an opening quote before NAME (`--env "FOO=…"`).
const ENV_ARG = /(?:--env|-e)\s+["']?([A-Za-z_][A-Za-z0-9_]*)=/g;
const RUNNER = /maestro/i;

/** @returns {{line:number,key:string}[]} one hit per credential-named argument in a maestro command */
export function scanText(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; ) {
    const startLine = i;
    let joined = lines[i];
    while (/\\\s*$/.test(joined) && i + 1 < lines.length) {
      joined = joined.replace(/\\\s*$/, ' ') + lines[++i];
    }
    i++;
    if (!RUNNER.test(joined)) continue;
    ENV_ARG.lastIndex = 0;
    let m;
    while ((m = ENV_ARG.exec(joined))) {
      if (SECRET_KEY.test(m[1])) hits.push({ line: startLine + 1, key: m[1] });
    }
  }
  return hits;
}

// --- Scope -------------------------------------------------------------------------------------------
/** Is this tracked repo-relative POSIX path one the gate reads? */
export function inScope(rel) {
  if (rel === SELF) return false; // the gate holds the pattern as regex source
  if (rel.startsWith('specs/')) return false; // historical spec records
  if (rel.startsWith('docs/proposals/')) return false; // design records, same rationale
  const base = posix.basename(rel);
  return (
    rel.startsWith('scripts/') ||
    /\.(?:sh|bash|ps1|psm1)$/.test(base) ||
    /^\.(?:forgejo|github)\/workflows\//.test(rel) ||
    base === 'package.json' ||
    base === 'project.json' ||
    /(?:^|\/)tests\/e2e\/mobile\//.test(rel) ||
    /maestro/i.test(rel) ||
    rel.startsWith('docs/') ||
    rel.startsWith('openwiki/') ||
    rel === 'AGENTS.md' ||
    rel === 'CLAUDE.md'
  );
}

function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.split(/\r?\n/).filter(Boolean).map((p) => posix.normalize(p));
}

function isProbablyText(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

function runScan(root) {
  let files;
  try {
    files = trackedFiles(root);
  } catch (e) {
    console.error(`[argv-secrets] cannot list tracked files in ${root}: ${String(e.stderr || e.message).trim()}`);
    process.exit(2);
  }
  const findings = [];
  let scanned = 0;
  for (const rel of files) {
    if (!inScope(rel)) continue;
    let buf;
    try {
      buf = readFileSync(resolve(root, rel));
    } catch {
      continue; // tracked but deleted in the work tree
    }
    if (!isProbablyText(buf)) continue;
    scanned++;
    for (const hit of scanText(buf.toString('utf8'))) findings.push({ file: rel, ...hit });
  }
  if (findings.length) {
    for (const f of findings) {
      console.error(`${f.file}:${f.line}: ${RULE}: --env ${f.key}= passes a credential-named value to Maestro on argv, visible to ps and /proc`);
    }
    console.error(
      `[argv-secrets] ❌ ${findings.length} credential-named argument(s) to Maestro (${scanned} file(s) scanned). ` +
        'Hand secrets to Maestro through its MAESTRO_-prefixed environment variables (from the job env or a ' +
        'gitignored local env file), never as --env/-e arguments.',
    );
    process.exit(1);
  }
  console.log(`[argv-secrets] ✅ no credential-named arguments to Maestro; ${scanned} file(s) scanned.`);
}

function selftest() {
  const key = (s) => 'E2E_TEST_' + s; // assembled so this file never holds a planted line
  const POS = [
    ['single-line --env', `maestro test flow.yaml --env ${key('PASSWORD')}="$P"`],
    ['short -e form', `maestro test flow.yaml -e ${key('TOKEN')}=x`],
    ['backslash continuation', `maestro test x.yaml \\\n    --env MODEL_API_${'KEY'}=abc`],
    ['quoted name', `maestro test x.yaml --env "${key('SECRET')}=x"`],
    ['wrapper forwarding', `bash scripts/maestro-run.sh flow.yaml --env ${key('PASSWORD')}=x`],
  ];
  const NEG = [
    ['wrapper with no argv secret', 'bash scripts/maestro-run.sh tests/e2e/mobile/x.yaml'],
    ['non-secret env', 'maestro test x.yaml --env COLLECTION_NAME="t-1"'],
    ['username env', 'maestro test x.yaml --env E2E_TEST_USER="$U"'],
    ['not a maestro command', `docker run -e ${key('PASSWORD')}=x image`],
  ];
  const fails = [];
  for (const [label, text] of POS) if (scanText(text).length === 0) fails.push(`positive '${label}' NOT detected`);
  for (const [label, text] of NEG) if (scanText(text).length !== 0) fails.push(`negative '${label}' false-positived`);
  const multi = scanText(`echo start\nmaestro test x.yaml \\\n  --env ${key('PASSWORD')}=x`);
  if (multi.length !== 1 || multi[0].line !== 2) fails.push('a continued command is not reported at its first line');
  if (!inScope('frontend/app/tests/e2e/mobile/login.yaml') || !inScope('.forgejo/workflows/x.yml') || inScope('specs/001/plan.md')) {
    fails.push('scope does not cover the flows and workflows, or reads specs/');
  }
  if (fails.length) {
    console.error('[argv-secrets --selftest] ❌ FAILED:\n  - ' + fails.join('\n  - '));
    process.exit(1);
  }
  console.log('[argv-secrets --selftest] ✅ detects planted --env/-e secrets (incl. continuations and wrappers); clean forms pass.');
}

function parseArgs(argv) {
  const opts = { selftest: false, help: false, dir: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') opts.selftest = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--dir') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: '--dir needs a directory' };
      opts.dir = resolve(v);
    } else return { error: `Unknown argument: ${a}` };
  }
  return opts;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`${opts.error}. ${USAGE}`);
    process.exit(2);
  }
  if (opts.help) console.log(USAGE);
  else if (opts.selftest) selftest();
  else runScan(opts.dir);
}
