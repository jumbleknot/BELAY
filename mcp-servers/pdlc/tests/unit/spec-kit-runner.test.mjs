// The Spec Kit runner (feature 016; research R1, R3, R14). It answers two questions about a target repository's own
// Spec Kit, and runs two of its scripts, so a Claude Desktop spec follows that repository's numbering, branch naming
// and template (FR-002) without the server reimplementing any of them.
//
//   inspect()  reads the copy: is Spec Kit initialised, at a version the server can follow, with the scripts and
//              prompts it needs, and with no mandatory specify/clarify hook it cannot honour (FR-005)?
//   prepare()  runs the branch script as a dry run and resolve-template, ONLY in a disposable scratch clone that holds
//              no credential, and returns the branch name, the feature number and the template (R1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpecKitRunner } from '../../src/spec-kit-runner.mjs';
import { Refusal } from '../../src/refusal.mjs';
import { CANARY } from './helpers/fixtures.mjs';

const FIXTURES = new URL('../fixtures/spec-kit/', import.meta.url);
const fixture = (name) => new URL(`${name}/`, FIXTURES).pathname;
const refusedWith = (code) => (e) => e instanceof Refusal && e.code === code;

// ── inspect (R3, R14; FR-005, US7-AC1) ──────────────────────────────────────────────────────────────────────────

const inspectOnly = createSpecKitRunner({ cloneRoot: '/unused', git: null, execFile: null });

test('inspect: a repository with no .specify/init-options.json is not initialised, and not ok', async () => {
  const r = await inspectOnly.inspect({ copyPath: fixture('not-initialised') });
  assert.equal(r.initialised, false);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not set up for Spec Kit|not initialised/i);
});

test('inspect: a folder with no .specify at all is not initialised either', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'pdlc-nospec-'));
  try {
    const r = await inspectOnly.inspect({ copyPath: empty });
    assert.deepEqual([r.initialised, r.ok], [false, false]);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test('inspect: BELAY-like 1.4.2 reads version, script and numbering, and is ok', async () => {
  const r = await inspectOnly.inspect({ copyPath: fixture('belay-like') });
  assert.equal(r.initialised, true);
  assert.equal(r.version, '1.4.2');
  assert.equal(r.supported, true);
  assert.equal(r.script, 'ps');
  assert.equal(r.feature_numbering, 'sequential');
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.reason, undefined);
});

test('inspect: every specify and clarify hook is classified as R3 says, and other hook points are not reported', async () => {
  const { hooks } = await inspectOnly.inspect({ copyPath: fixture('belay-like') });
  assert.deepEqual(hooks, [
    { point: 'before_specify', command: 'speckit.git.feature', optional: false, handling: 'server' },
    { point: 'after_specify', command: 'speckit.git.commit', optional: true, handling: 'not_run' },
    { point: 'after_specify', command: 'speckit.belay.spec-stage', optional: false, handling: 'server' },
    { point: 'before_clarify', command: 'speckit.git.commit', optional: true, handling: 'not_run' },
    { point: 'after_clarify', command: 'speckit.agent-context.update', optional: true, handling: 'not_run' },
    { point: 'after_clarify', command: 'speckit.acme.disabled', optional: false, handling: 'not_run' },
  ]);
});

test('inspect: an unknown MANDATORY specify hook is unsupported and makes ok false, naming it; an unknown optional one is not_run', async () => {
  const r = await inspectOnly.inspect({ copyPath: fixture('unknown-mandatory-hook') });
  assert.equal(r.supported, true);
  assert.equal(r.ok, false);
  assert.match(r.reason, /speckit\.acme\.notify/);
  assert.deepEqual(r.hooks.find((h) => h.command === 'speckit.acme.notify').handling, 'unsupported');
  assert.deepEqual(r.hooks.find((h) => h.command === 'speckit.acme.optional-extra').handling, 'not_run');
});

test('inspect: a version outside 1.4.x is not supported, named in the reason', async () => {
  const r = await inspectOnly.inspect({ copyPath: fixture('old-version') });
  assert.equal(r.initialised, true);
  assert.equal(r.supported, false);
  assert.equal(r.ok, false);
  assert.match(r.reason, /1\.3\.9/);
});

test('inspect: a missing script or prompt is not ok, naming the file', async () => {
  const r = await inspectOnly.inspect({ copyPath: fixture('missing-scripts') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /resolve-template\.ps1/);
});

test('inspect: no extensions.yml means no hooks, and is ok', async () => {
  const r = await inspectOnly.inspect({ copyPath: fixture('no-extensions') });
  assert.deepEqual(r.hooks, []);
  assert.equal(r.ok, true, r.reason);
});

// ── prepare: the scripts, in a scratch clone only (R1; US1-AC1, US8-AC6) ────────────────────────────────────────

function world({ scriptOut, scriptFail = false, templateOut, interpreters = { pwsh: '/usr/bin/pwsh' }, gitFail } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pdlc-runner-'));
  const copyPath = join(root, 'BELAY');
  cpSync(fixture('belay-like'), copyPath, { recursive: true });
  const gitCalls = [];
  const git = {
    async run(args, opts) {
      gitCalls.push({ args, cwd: opts.cwd, spec: opts.spec });
      if (gitFail && gitFail(args)) throw new Error(`git ${args[0]} failed`);
      // `clone --shared --no-checkout <copy> <scratch>` and `checkout`: make the scratch tree exist, as git would.
      if (args[0] === 'clone') cpSync(copyPath, args[4], { recursive: true });
      return { stdout: '' };
    },
  };
  const execCalls = [];
  const execFile = (file, args, options, cb) => {
    execCalls.push({ file, args, options, existedAtCall: existsSync(options.cwd) });
    const isTemplate = args.some((a) => a.endsWith('resolve-template.ps1'));
    if (scriptFail && !isTemplate) return cb(Object.assign(new Error('exit 1'), { code: 1 }), '', 'boom: the script failed');
    cb(null, isTemplate ? (templateOut ?? JSON.stringify({ TEMPLATE_NAME: 'spec-template', TEMPLATE_CONTENT: '# Feature Specification: [FEATURE NAME]\n' }))
      : (scriptOut ?? '{"BRANCH_NAME":"017-pane-probe","FEATURE_NUM":"017","DRY_RUN":true}\n'), '');
  };
  const runner = createSpecKitRunner({
    cloneRoot: root, git, execFile,
    findExecutable: (name) => interpreters[name] ?? null,
    baseEnv: { PATH: '/usr/bin', HOME: '/home/op', PDLC_FORGE_TOKEN: CANARY, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: token ${CANARY}`, SOMETHING: `has ${CANARY} inside` },
    randomId: () => '1a2b3c',
    platform: 'linux',
  });
  return { root, copyPath, runner, gitCalls, execCalls, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const REPO = { name: 'BELAY', default_branch: 'main' };

test('prepare: fetch every head into the copy, then clone a scratch clone, copy remote refs into it, check out — in that order', async () => {
  const w = world();
  try {
    await w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'pane-probe' });
    const scratch = join(w.root, '.pdlc-scratch', 'BELAY-1a2b3c');
    assert.deepEqual(w.gitCalls.map((c) => [c.args, c.cwd]), [
      [['fetch', 'origin', '+refs/heads/*:refs/remotes/origin/*'], w.copyPath],
      [['clone', '--shared', '--no-checkout', w.copyPath, scratch], w.root],
      [['fetch', w.copyPath, '+refs/remotes/origin/*:refs/remotes/origin/*'], scratch],
      [['checkout', '--detach', 'origin/main'], scratch],
    ]);
    // the scratch calls name the spec context the git allowlist checks them against
    for (const c of w.gitCalls.slice(1)) assert.deepEqual(c.spec, { cloneRoot: w.root, repo: 'BELAY', copyPath: w.copyPath, defaultBranch: 'main' });
  } finally { w.cleanup(); }
});

test('prepare: both scripts run INSIDE the scratch clone, never the copy or a worktree, with fixed script paths and the dry-run flags', async () => {
  const w = world();
  try {
    await w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'pane-probe' });
    const scratch = join(w.root, '.pdlc-scratch', 'BELAY-1a2b3c');
    assert.equal(w.execCalls.length, 2);
    for (const c of w.execCalls) {
      assert.equal(c.file, '/usr/bin/pwsh');
      assert.equal(c.options.cwd, scratch);
      assert.ok(c.existedAtCall, 'the scratch clone exists while the script runs');
      assert.equal('shell' in c.options, false);
    }
    const [branch, template] = w.execCalls;
    assert.deepEqual(branch.args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      join(scratch, '.specify', 'extensions', 'git', 'scripts', 'powershell', 'create-new-feature-branch.ps1'),
      '-Json', '-DryRun', '-ShortName', 'pane-probe', 'pane probe']);
    assert.deepEqual(template.args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      join(scratch, '.specify', 'scripts', 'powershell', 'resolve-template.ps1'), 'spec-template', '-Json']);
  } finally { w.cleanup(); }
});

test('prepare: the scripts\' environment holds NO credential: no GIT_CONFIG_*, no PDLC_FORGE_TOKEN, no Authorization, no token value', async () => {
  const w = world();
  try {
    await w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'pane-probe' });
    for (const { options } of w.execCalls) {
      const env = options.env;
      assert.ok(!Object.keys(env).some((k) => k.startsWith('GIT_CONFIG')), Object.keys(env).join(','));
      assert.equal(env.PDLC_FORGE_TOKEN, undefined);
      assert.ok(!Object.values(env).some((v) => String(v).includes(CANARY) || /Authorization/i.test(String(v))));
      assert.equal(env.GIT_TERMINAL_PROMPT, '0');
      assert.equal(env.PATH, '/usr/bin');
    }
    // and no argument either: the description is derived from the short name, never from proposal or spec text
    assert.ok(!w.execCalls.flatMap((c) => c.args).some((a) => a.includes(CANARY)));
  } finally { w.cleanup(); }
});

test('prepare: BRANCH_NAME, FEATURE_NUM and TEMPLATE_CONTENT are parsed', async () => {
  const w = world();
  try {
    const r = await w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'pane-probe' });
    assert.deepEqual(r, { branch: '017-pane-probe', feature_num: '017', template: '# Feature Specification: [FEATURE NAME]\n' });
  } finally { w.cleanup(); }
});

test('prepare: the scratch folder is deleted on success', async () => {
  const w = world();
  try {
    await w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'pane-probe' });
    assert.deepEqual(readdirSync(join(w.root, '.pdlc-scratch')), []);
  } finally { w.cleanup(); }
});

test('prepare: the scratch folder is deleted on failure too, and the failure is spec_kit_unavailable with the script\'s reason', async () => {
  const w = world({ scriptFail: true });
  try {
    await assert.rejects(w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'pane-probe' }),
      (e) => refusedWith('spec_kit_unavailable')(e) && /boom/.test(e.reason));
    assert.deepEqual(readdirSync(join(w.root, '.pdlc-scratch')), []);
  } finally { w.cleanup(); }
});

test('prepare: output that is not the script\'s JSON is refused, never half-read', async () => {
  const w = world({ scriptOut: 'WARNING: something\n{"FEATURE_NUM":"017"}\n' });
  try {
    await assert.rejects(w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'pane-probe' }), refusedWith('spec_kit_unavailable'));
  } finally { w.cleanup(); }
});

test('prepare: a leftover scratch folder from an earlier crash is removed at the next prepare for that repository only', async () => {
  const w = world();
  try {
    const scratchRoot = join(w.root, '.pdlc-scratch');
    mkdirSync(join(scratchRoot, 'BELAY-deadbe'), { recursive: true });
    writeFileSync(join(scratchRoot, 'BELAY-deadbe', 'x'), 'left by a crash');
    mkdirSync(join(scratchRoot, 'MCM-cafe00'), { recursive: true });
    await w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'pane-probe' });
    assert.deepEqual(readdirSync(scratchRoot), ['MCM-cafe00']);
  } finally { w.cleanup(); }
});

test('prepare: a scratch path that would land outside .pdlc-scratch/ is refused path_outside_feature, before git runs', async () => {
  const w = world();
  try {
    await assert.rejects(w.runner.prepare({ repo: { name: '../BELAY', default_branch: 'main' }, copyPath: w.copyPath, shortName: 'pane-probe' }),
      refusedWith('path_outside_feature'));
    assert.equal(w.gitCalls.filter((c) => c.args[0] === 'clone').length, 0);
  } finally { w.cleanup(); }
});

test('prepare: with no pwsh, Windows PowerShell is used on Windows (measured: the workstation has only 5.1); elsewhere it is refused', async () => {
  const w = world({ interpreters: { 'powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' } });
  try {
    const onWindows = createSpecKitRunner({ cloneRoot: w.root, git: { run: async (a, o) => { if (a[0] === 'clone') cpSync(w.copyPath, a[4], { recursive: true }); return { stdout: '' }; } },
      execFile: (file, args, options, cb) => { w.execCalls.push({ file }); cb(null, args.some((a) => a.endsWith('resolve-template.ps1')) ? '{"TEMPLATE_CONTENT":"t"}' : '{"BRANCH_NAME":"017-a","FEATURE_NUM":"017"}', ''); },
      findExecutable: (n) => (n === 'powershell.exe' ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : null), baseEnv: {}, randomId: () => 'aa', platform: 'win32' });
    await onWindows.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'a-b' });
    assert.match(w.execCalls[0].file, /powershell\.exe$/);
    await assert.rejects(w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: 'pane-probe' }),
      (e) => refusedWith('spec_kit_unavailable')(e) && /pwsh/.test(e.reason));
  } finally { w.cleanup(); }
});

test('prepare: a short name outside the contract (2 to 4 kebab words, at most 40 characters) is refused invalid_input', async () => {
  const w = world();
  try {
    for (const bad of ['one', 'a-b-c-d-e', 'Has-Upper', 'x--y', '-lead', 'a'.repeat(41) + '-b']) {
      await assert.rejects(w.runner.prepare({ repo: REPO, copyPath: w.copyPath, shortName: bad }), refusedWith('invalid_input'), bad);
    }
    assert.equal(w.gitCalls.length, 0);
  } finally { w.cleanup(); }
});

test('interpreterPath names the interpreter prepare() would use, or null when there is none', () => {
  const r = (found, platform) => createSpecKitRunner({ cloneRoot: '/x', git: null, execFile: null, findExecutable: (n) => found[n] ?? null, platform });
  assert.equal(r({ pwsh: '/usr/bin/pwsh' }, 'linux').interpreterPath('ps'), '/usr/bin/pwsh');
  assert.equal(r({ 'powershell.exe': 'C:\\ps.exe' }, 'win32').interpreterPath('ps'), 'C:\\ps.exe');
  assert.equal(r({}, 'linux').interpreterPath('ps'), null);
  assert.equal(r({ bash: '/bin/bash' }, 'linux').interpreterPath('sh'), '/bin/bash');
  assert.equal(r({ 'bash.exe': 'C:\\git\\bash.exe' }, 'win32').interpreterPath('sh'), 'C:\\git\\bash.exe');
});
