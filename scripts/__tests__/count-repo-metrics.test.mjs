// Tests for scripts/count-repo-metrics.mjs (feature 013).
//
// The metrics are checked against throwaway `git init` repositories whose contents were counted by
// hand, so every expected number below can be re-derived by reading the fixture. Nothing here reads
// or writes the real tree, except the last test, which checks the learnings document's links.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = join(REPO_ROOT, 'scripts', 'count-repo-metrics.mjs');
const {
  classifyPath, countNonBlankLines, countTestDeclarations, countGateScripts, measureCommit, formatText, mergeLogColumn,
} = await import(pathToFileURL(CLI).href);
const { bodyLinks, classifyBodyLink, splitTarget } = await import(pathToFileURL(join(REPO_ROOT, 'scripts', 'openwiki-links.mjs')).href);

const LABELS = [
  'Features', 'Commits', 'Code lines (non-blank)', 'Test lines (non-blank)', 'Documentation lines (non-blank)',
  'Test declarations', 'Gate scripts (scripts:lint)', 'Guard tests', 'Task lists', 'Task lists with Verify RED',
  'Allowlist entries',
];

// ── fixture repositories ─────────────────────────────────────────────────────────────────────────

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

function git(cwd, args, date) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function tempDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}

function write(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** Build a repository from batches of { path: content }, one commit per batch, each with a pinned date. */
function makeRepo(batches) {
  const dir = tempDir('count-repo-metrics-');
  git(dir, ['init', '-q', '-b', 'main']);
  const shas = [];
  for (const { files, date } of batches) {
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', `at ${date}`], date);
    shas.push(git(dir, ['rev-parse', 'HEAD']));
  }
  return { dir, shas };
}

const FIRST = {
  date: '2026-01-01T00:00:00Z',
  files: {
    'scripts/a.mjs': 'const a = 1;\n\n   \nexport { a };\n',     // code 2
    'docs/x.md': '# X\n\ntext\n',                                 // docs 2
  },
};

const SECOND = {
  date: '2026-02-01T00:00:00Z',
  files: {
    'scripts/b.sh': '#!/bin/sh\necho hi\n',                                       // code 2
    '.forgejo/workflows/g.yml': 'on: push\njobs: {}\n',                           // code 2
    'scripts/bin.mjs': Buffer.from([0x61, 0x00, 0x0a, 0x62, 0x0a]),               // code, binary → 0
    'scripts/__tests__/a.test.mjs':
      "import { test } from 'node:test';\n\ntest('one', () => {});\ntest.skip('two', () => {});\n// test('no')\n", // test 4, decl 2
    'scripts/__tests__/b.guard.test.mjs': "test('g', () => {});\n",             // test 1, decl 1, guard 1
    'scripts/__tests__/fixtures/f.md': '# fixture\n',                           // excluded
    '.specify/v.md': '# vendored\n',                                              // excluded
    'specs/001-a/spec.md': '# A\n',                                               // docs 1, feature
    'specs/001-a/tasks.md': '- **Verify RED**: x\n',                              // docs 1, task list with RED
    'specs/002-b/spec.md': '# B\n',                                               // docs 1, feature
    'specs/002-b/tasks.md': '- task\n',                                           // docs 1, task list
    'specs/003-c/plan.md': '# C\n',                                               // docs 1, not a feature
    'README.md': 'readme\n',                                                      // docs 1
    'scripts/project.json': JSON.stringify({
      targets: { lint: { options: { commands: ['node scripts/a.mjs --selftest', 'node scripts/a.mjs', 'node scripts/b.sh'] } } },
    }),                                                                           // gate scripts 2
    'security/sast/allowlist.yaml': '- id: a\n- id: b\n',                         // 2 entries
    'security/images/allowlist.yaml': '# comments only\n',                        // 0 entries
  },
};

const EXPECTED_SECOND = {
  features: 2, commits: 2, codeLines: 6, testLines: 5, docLines: 8, testDeclarations: 3, gateScripts: 2,
  guardTests: 1, taskLists: 2, taskListsWithVerifyRed: 1, allowlistEntries: 2,
};
const EXPECTED_FIRST = {
  features: 0, commits: 1, codeLines: 2, testLines: 0, docLines: 2, testDeclarations: 0, gateScripts: 0,
  guardTests: 0, taskLists: 0, taskListsWithVerifyRed: 0, allowlistEntries: 0,
};

let shared;
const fixture = () => (shared ??= makeRepo([FIRST, SECOND]));

test('fixture helper builds a two-commit repository', () => {
  const { dir, shas } = fixture();
  assert.equal(shas.length, 2);
  assert.ok(existsSync(join(dir, '.git')));
});

// ── classifyPath (research R2) ───────────────────────────────────────────────────────────────────

test('classifyPath puts each path in exactly one category, by the ordered rules', () => {
  const cases = {
    '.specify/x.md': null,
    '.claude/skills/speckit-plan/SKILL.md': null,
    'scripts/__tests__/fixtures/a.md': null,
    'scripts/__tests__/fixtures/ci/x.mjs': null,
    'security/sast/rules/r.py': null,
    'security/sast/reports/f.json': null,
    'pnpm-lock.yaml': null,
    'scripts/__tests__/a.test.mjs': 'test',
    'scripts/__tests__/jsonc.mjs': 'test',
    'docs/x.md': 'docs',
    'specs/001-a/spec.md': 'docs',
    '.claude/skills/forgejo-issues/SKILL.md': 'docs',
    'scripts/a.mjs': 'code',
    'scripts/a.sh': 'code',
    'scripts/a.ps1': 'code',
    '.devcontainer/Dockerfile': 'code',
    '.devcontainer/toolchain.Dockerfile': 'code',
    '.forgejo/workflows/g.yml': 'code',
    '.forgejo/workflows/g.yaml': 'code',
    'renovate.json': null,
    'security/sast/allowlist.yaml': null,
    '.forgejo/issue_template/bug.yaml': null,
    'LICENSE': null,
    'secrets/.gitkeep': null,
  };
  for (const [path, want] of Object.entries(cases)) assert.equal(classifyPath(path), want, path);
});

// ── the pure counters (research R2, R3) ──────────────────────────────────────────────────────────

test('countNonBlankLines skips blank and whitespace-only lines and counts nothing in a binary', () => {
  assert.equal(countNonBlankLines(Buffer.from('a\n\n  \nb')), 2);
  assert.equal(countNonBlankLines(Buffer.from('a\r\n\r\nb\r\n')), 2);
  assert.equal(countNonBlankLines(Buffer.from('')), 0);
  assert.equal(countNonBlankLines(Buffer.from([0x61, 0x00, 0x0a, 0x62])), 0);
});

test('countTestDeclarations counts test(), test.skip(), it() and t.test(), and nothing else', () => {
  const src = [
    "test('a', () => {});",
    "  test.skip('b', () => {});",
    "test.todo('c');",
    "it('d', () => {});",
    "  await t.test('e', () => {});",
    "// test('commented out')",
    "retest('no');",
    "describe('no', () => {});",
    "const x = 'test(';",
  ].join('\n');
  assert.equal(countTestDeclarations(src), 5);
});

test('countGateScripts counts distinct scripts named by the lint target', () => {
  const pj = (lint) => JSON.stringify({ targets: lint === undefined ? {} : { lint } });
  assert.equal(countGateScripts(pj({ options: { commands: ['node scripts/a.mjs --selftest', 'node scripts/a.mjs', 'bash scripts/b.sh', 'pwsh scripts/c.ps1'] } })), 3);
  assert.equal(countGateScripts(pj({ options: { command: 'node scripts/a.mjs' } })), 1);
  assert.equal(countGateScripts(pj(undefined)), 0);
  assert.equal(countGateScripts(null), 0);
  assert.throws(() => countGateScripts('{not json'), /project\.json/);
});

// ── measureCommit (US1) ──────────────────────────────────────────────────────────────────────────

test('measureCommit counts every metric of HEAD exactly', () => {
  const { dir, shas } = fixture();
  const s = measureCommit({ cwd: dir });
  assert.equal(s.rev, shas[1]);
  assert.match(s.rev, /^[0-9a-f]{40}$/);
  assert.equal(s.commitDate, '2026-02-01');
  assert.deepEqual(s.metrics, EXPECTED_SECOND);
  assert.deepEqual(s.allowlists, { 'security/images/allowlist.yaml': 0, 'security/sast/allowlist.yaml': 2 });
});

test('measureCommit ignores uncommitted and untracked files', () => {
  const { dir } = fixture();
  const before = measureCommit({ cwd: dir });
  writeFileSync(join(dir, 'docs/x.md'), '# X\n\ntext\nmore\nand more\n');
  write(dir, 'scripts/untracked.mjs', 'const u = 1;\n');
  try {
    assert.deepEqual(measureCommit({ cwd: dir }), before);
  } finally {
    git(dir, ['checkout', '--', 'docs/x.md']);
    rmSync(join(dir, 'scripts/untracked.mjs'));
  }
});

test('measureCommit --rev counts an earlier commit, with zero for what did not exist yet', () => {
  const { dir, shas } = fixture();
  const s = measureCommit({ cwd: dir, rev: shas[0] });
  assert.equal(s.rev, shas[0]);
  assert.equal(s.commitDate, '2026-01-01');
  assert.deepEqual(s.metrics, EXPECTED_FIRST);
  assert.deepEqual(s.allowlists, {});
});

test('measureCommit refuses an unknown rev, naming it', () => {
  const { dir } = fixture();
  assert.throws(() => measureCommit({ cwd: dir, rev: 'no-such-rev' }), /no-such-rev/);
});

test('measureCommit refuses a directory that is not a git repository', () => {
  assert.throws(() => measureCommit({ cwd: tempDir('not-a-repo-') }), /not a git repository/);
});

test('measureCommit refuses a malformed allowlist, naming the file', () => {
  const { dir } = makeRepo([{ date: '2026-01-01T00:00:00Z', files: { 'security/x/allowlist.yaml': 'a: 1\n' } }]);
  assert.throws(() => measureCommit({ cwd: dir }), /security\/x\/allowlist\.yaml/);
});

test('measureCommit reports no commit count from a shallow history', () => {
  const { dir } = fixture();
  const shallow = join(tempDir('shallow-'), 'clone');
  const r = spawnSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(dir).href, shallow], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const s = measureCommit({ cwd: shallow });
  assert.equal(s.metrics.commits, null);
  assert.equal(s.metrics.features, 2);
});

test('measureCommit reads scriptCommit from the script repository, never the counted one', () => {
  const { dir } = fixture();
  // The fixture does not track the script, so measured against it the script is untracked.
  assert.equal(measureCommit({ cwd: dir, scriptRepo: dir }).scriptCommit, 'untracked');

  const withScript = makeRepo([{ date: '2026-03-01T00:00:00Z', files: { 'scripts/count-repo-metrics.mjs': '// v1\n' } }]);
  const short = git(withScript.dir, ['rev-parse', '--short', 'HEAD']);
  assert.equal(measureCommit({ cwd: dir, scriptRepo: withScript.dir }).scriptCommit, short);
  writeFileSync(join(withScript.dir, 'scripts/count-repo-metrics.mjs'), '// v2\n');
  assert.equal(measureCommit({ cwd: dir, scriptRepo: withScript.dir }).scriptCommit, `${short}+dirty`);

  // By default the script's own repository is used, so counting a repo that tracks a file of the
  // same name never borrows that repo's commit.
  assert.notEqual(measureCommit({ cwd: withScript.dir }).scriptCommit, short);
  assert.match(measureCommit({ cwd: dir }).scriptCommit, /^([0-9a-f]{7,}(\+dirty)?|untracked)$/);
});

// ── the CLI (US1, contracts/cli.md) ──────────────────────────────────────────────────────────────

const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });

test('CLI --json prints the snapshot', () => {
  const { dir, shas } = fixture();
  const r = run(['--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.rev, shas[1]);
  assert.deepEqual(s.metrics, EXPECTED_SECOND);
});

test('CLI text form has the header line and every label', () => {
  const { dir, shas } = fixture();
  const r = run(['--rev', shas[0]], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^count-repo-metrics: ${shas[0]} \\(2026-01-01\\), script `));
  for (const label of LABELS) assert.ok(r.stdout.includes(label), label);
  assert.equal(formatText(measureCommit({ cwd: dir })), run([], dir).stdout);
});

test('CLI text form says a shallow commit count is unavailable', () => {
  const s = measureCommit({ cwd: fixture().dir });
  const text = formatText({ ...s, metrics: { ...s.metrics, commits: null } });
  assert.match(text, /Commits\s+unavailable \(shallow history\)/);
});

test('CLI --help exits 0, does nothing else, and states the classification rules', () => {
  const r = run(['--help'], tempDir('help-'));
  assert.equal(r.status, 0, r.stderr);
  for (const word of ['--rev', '--json', '--append-log', 'code', 'test', 'docs', 'not counted', 'speckit-taskstoissues', 'non-blank']) {
    assert.ok(r.stdout.includes(word), word);
  }
});

test('CLI rejects bad arguments with exit 2 and empty stdout', () => {
  const { dir } = fixture();
  for (const args of [['--revv', 'HEAD'], ['--rev'], ['HEAD'], ['--json', '--append-log', 'f.md']]) {
    const r = run(args, dir);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout, '', args.join(' '));
  }
});

test('CLI exits 1 on an unknown rev, naming it, with empty stdout', () => {
  const r = run(['--rev', 'nope'], fixture().dir);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /nope/);
});

// ── mergeLogColumn (US2, data-model.md "Log table") ──────────────────────────────────────────────

const START = '<!-- metrics-log:start -->';
const END = '<!-- metrics-log:end -->';
const DOC = `# Doc\n\nbefore text\n\n${START}\n${END}\n\nafter text\n`;
const snap = (rev, commitDate, over = {}) => ({
  rev: rev.padEnd(40, '0'), commitDate, scriptCommit: 'abc1234',
  metrics: { ...EXPECTED_SECOND, ...over }, allowlists: {},
});
const tableOf = (md) => md.slice(md.indexOf(START) + START.length, md.indexOf(END)).trim().split('\n')
  .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));

test('mergeLogColumn fills empty markers with the header, the script row and every metric row', () => {
  const out = mergeLogColumn(DOC, snap('1111111', '2026-02-01'));
  const rows = tableOf(out);
  assert.deepEqual(rows[0], ['Metric', '`1111111` 2026-02-01']);
  assert.deepEqual(rows[2], ['Script commit', 'abc1234']);
  assert.deepEqual(rows.slice(3).map((r) => r[0]), LABELS);
  assert.equal(rows[3][1], '2');
});

test('mergeLogColumn appends later columns and inserts back-fills in commit-date order', () => {
  let md = mergeLogColumn(DOC, snap('2222222', '2026-02-01'));
  md = mergeLogColumn(md, snap('3333333', '2026-03-01', { features: 3 }));
  md = mergeLogColumn(md, snap('1111111', '2026-01-01', { features: 1 }));
  const rows = tableOf(md);
  assert.deepEqual(rows[0].slice(1), ['`1111111` 2026-01-01', '`2222222` 2026-02-01', '`3333333` 2026-03-01']);
  assert.deepEqual(rows[3], ['Features', '1', '2', '3']);
});

test('mergeLogColumn refuses a rev already logged, and a shallow snapshot', () => {
  const md = mergeLogColumn(DOC, snap('2222222', '2026-02-01'));
  assert.throws(() => mergeLogColumn(md, snap('2222222', '2026-02-01')), /already logged/);
  assert.throws(() => mergeLogColumn(DOC, snap('4444444', '2026-02-01', { commits: null })), /shallow/);
});

test('mergeLogColumn marks a value a column lacks with —', () => {
  // An older table with a row the snapshot does not know, and missing a row the snapshot has.
  const old = `${START}\n| Metric | \`1111111\` 2026-01-01 |\n| --- | --- |\n| Script commit | 0000000 |\n| Features | 1 |\n| Retired metric | 9 |\n${END}\n`;
  const rows = tableOf(mergeLogColumn(old, snap('2222222', '2026-02-01')));
  const byLabel = Object.fromEntries(rows.slice(2).map((r) => [r[0], r.slice(1)]));
  assert.deepEqual(byLabel['Retired metric'], ['9', '—']);
  assert.deepEqual(byLabel.Commits, ['—', '2']);
  assert.deepEqual(byLabel.Features, ['1', '2']);
});

test('mergeLogColumn refuses a document without both markers', () => {
  assert.throws(() => mergeLogColumn('# no markers\n', snap('1111111', '2026-01-01')), /markers/);
  assert.throws(() => mergeLogColumn(`${START}\n`, snap('1111111', '2026-01-01')), /markers/);
});

test('mergeLogColumn leaves every byte outside the markers unchanged', () => {
  const out = mergeLogColumn(DOC, snap('1111111', '2026-01-01'));
  assert.ok(out.startsWith(`# Doc\n\nbefore text\n\n${START}\n`));
  assert.ok(out.endsWith(`${END}\n\nafter text\n`));
});

// ── --append-log (US2) ───────────────────────────────────────────────────────────────────────────

test('CLI --append-log writes the column once, and refuses a repeat or a file without markers', () => {
  const { dir, shas } = fixture();
  const doc = join(tempDir('log-'), 'doc.md');
  writeFileSync(doc, DOC);
  const first = run(['--append-log', doc], dir);
  assert.equal(first.status, 0, first.stderr);
  const written = readFileSync(doc, 'utf8');
  assert.ok(written.includes(`\`${shas[1].slice(0, 7)}\` 2026-02-01`));

  const again = run(['--append-log', doc], dir);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already logged/);
  assert.equal(readFileSync(doc, 'utf8'), written);

  const bare = join(dirname(doc), 'bare.md');
  writeFileSync(bare, '# nothing here\n');
  const refused = run(['--append-log', bare], dir);
  assert.equal(refused.status, 1);
  assert.equal(readFileSync(bare, 'utf8'), '# nothing here\n');
});

// ── the learnings document (SC-004) ──────────────────────────────────────────────────────────────

test('learnings document links resolve', () => {
  const docPath = join(REPO_ROOT, 'docs', 'BELAY-Learnings.md');
  const text = readFileSync(docPath, 'utf8');
  const links = bodyLinks(text);
  assert.ok(links.length > 0, 'the document links its rules to their homes');
  const broken = [];
  for (const { target, line } of links) {
    const kind = classifyBodyLink(target).kind;
    if (kind === 'skip') continue;
    if (kind === 'site-root') { broken.push(`${line}: ${target} (site-root link)`); continue; }
    if (!existsSync(resolve(dirname(docPath), splitTarget(target).path))) broken.push(`${line}: ${target}`);
  }
  assert.deepEqual(broken, []);
});
