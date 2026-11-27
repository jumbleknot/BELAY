// The git runner: a verb allowlist, and authentication through GIT_CONFIG_* in the child environment
// only (FR-017, FR-018, research R2; US3-AC5 "no history").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitRunner, GitVerbRefused, GitError } from '../../src/git-runner.mjs';
import { fakeExecFile } from './helpers/fake-exec.mjs';
import { CANARY } from './helpers/fixtures.mjs';

const runner = (answer) => {
  const x = fakeExecFile(answer);
  return { x, git: createGitRunner({ token: CANARY, execFile: x.execFile, baseEnv: { PATH: '/usr/bin', HOME: '/home/op', GIT_DIR: '/elsewhere', GIT_CONFIG_COUNT: '9', GIT_CONFIG_KEY_0: 'core.pager' } }) };
};

const ALLOWED = [
  ['clone', '--filter=blob:none', '--single-branch', '--branch', 'main', 'https://forge.example/o/r.git', '/clones/r'],
  ['fetch', 'origin', 'main'],
  ['merge', '--ff-only', 'origin/main'],
  ['status', '--porcelain=v1', '--untracked-files=normal'],
  ['rev-parse', '--show-toplevel'],
  ['rev-list', '--count', 'HEAD..origin/main'],
  ['symbolic-ref', '--short', 'HEAD'],
  ['config', '--get', 'remote.origin.url'],
];

test('every allowlisted verb runs', async () => {
  const { x, git } = runner(() => ({ stdout: 'ok\n' }));
  for (const args of ALLOWED) assert.equal((await git.run(args, { cwd: '/clones/r' })).stdout, 'ok\n');
  assert.deepEqual(x.calls.map((c) => c.args), ALLOWED);
});

test('history-writing and other verbs are refused BEFORE execFile is called', async () => {
  const { x, git } = runner();
  const refused = [
    ['commit', '-m', 'x'], ['push'], ['branch', 'new'], ['checkout', '-b', 'x'], ['checkout', 'main'], ['stash'],
    ['reset', '--hard'], ['rebase', 'main'], ['pull'], ['tag', 'v1'], ['config', 'user.name', 'x'],
    ['config', '--unset', 'remote.origin.url'], ['merge', 'origin/main'], ['merge', '--no-ff', 'origin/main'],
    ['-c', 'core.editor=x', 'status'], ['-C', '/elsewhere', 'status'], [], ['gc'], ['worktree', 'add', 'x'],
    ['clone', '-c', 'http.extraHeader=x', 'https://forge.example/o/r.git', '/c'], ['clone', '--config=core.x=y', 'u', '/c'],
    ['fetch', '--upload-pack=/bin/evil', 'origin'], ['clone', '-u', '/bin/evil', 'u', '/c'], ['clone', '--template=/t', 'u', '/c'],
    ['config', '--get', 'remote.origin.url', 'extra'], ['config', '--get-all', 'remote.origin.url'],
  ];
  for (const args of refused) {
    await assert.rejects(git.run(args, { cwd: '/clones/r' }), GitVerbRefused, JSON.stringify(args));
  }
  assert.equal(x.calls.length, 0);
});

test('authentication is in the child environment through GIT_CONFIG_*, never in argv', async () => {
  const { x, git } = runner();
  await git.run(['fetch', 'origin', 'main'], { cwd: '/clones/r' });
  const { args, options } = x.calls[0];
  assert.doesNotMatch(args.join(' '), /canary-|Authorization|extraHeader/);
  assert.equal(options.env.GIT_CONFIG_COUNT, '2');
  assert.equal(options.env.GIT_CONFIG_KEY_0, 'http.extraHeader');
  assert.equal(options.env.GIT_CONFIG_VALUE_0, `Authorization: token ${CANARY}`);
  assert.equal(options.env.GIT_CONFIG_KEY_1, 'credential.helper');
  assert.equal(options.env.GIT_CONFIG_VALUE_1, '');
});

test('GIT_TERMINAL_PROMPT=0 is set; PATH and HOME are kept; inherited GIT_DIR is dropped', async () => {
  const { x, git } = runner();
  await git.run(['status', '--porcelain=v1'], { cwd: '/clones/r' });
  const { env } = x.calls[0].options;
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/op');
  assert.equal(env.GIT_DIR, undefined);
});

test('execFile always receives an argument array, with no shell option, and the git binary', async () => {
  const { x, git } = runner();
  await git.run(['rev-parse', '--show-toplevel'], { cwd: '/clones/r' });
  const c = x.calls[0];
  assert.equal(c.file, 'git');
  assert.ok(Array.isArray(c.args));
  assert.equal('shell' in c.options, false);
  assert.equal(c.options.cwd, '/clones/r');
});

test('a configured git path is used as the binary', async () => {
  const x = fakeExecFile();
  const git = createGitRunner({ token: CANARY, execFile: x.execFile, gitPath: 'C:\\Program Files\\Git\\cmd\\git.exe', baseEnv: {} });
  await git.run(['status'], { cwd: '/c' });
  assert.equal(x.calls[0].file, 'C:\\Program Files\\Git\\cmd\\git.exe');
});

test('a failing git call rejects with GitError carrying the exit code and a redacted stderr', async () => {
  const { git } = runner(() => ({ code: 128, stderr: `fatal: auth failed for Authorization: token ${CANARY}` }));
  const e = await git.run(['fetch', 'origin', 'main'], { cwd: '/clones/r' }).catch((err) => err);
  assert.ok(e instanceof GitError);
  assert.equal(e.exitCode, 128);
  assert.doesNotMatch(`${e.message} ${e.stderr}`, /canary-/);
});

// ── Feature 016: exact argument shapes for one spec in progress (research R4; FR-020, FR-021) ─────────────────
//
// Each new shape is allowed only for a call that names the spec it belongs to (`spec`, below): its branch, its folder,
// the copy and the clone root. Without it, every new shape is refused, so 014's callers and 014's refusal list above
// are unchanged. With it, the arguments must match the shape EXACTLY: an extra, missing or altered argument is refused.
import { Refusal } from '../../src/refusal.mjs';
import { join } from 'node:path';

const ROOT = '/clones';
const SPEC = Object.freeze({
  cloneRoot: ROOT, repo: 'BELAY', copyPath: join(ROOT, 'BELAY'), defaultBranch: 'main',
  featureBranch: '017-pane-probe', specDir: 'specs/017-pane-probe', recordedRemoteTip: 'a'.repeat(40),
});
const WT = join(ROOT, '.pdlc-specs', 'BELAY', '017-pane-probe');
const SCRATCH = join(ROOT, '.pdlc-scratch', 'BELAY-1a2b3c');
const MERGE = join(ROOT, '.pdlc-backups', 'BELAY', '017-pane-probe', '20261127T233000Z', 'merge');
const MSG = "docs(017): approve spec for proposal item #91\n\nApproved in Claude Desktop by the spec's author.";

const SHAPES = [
  { name: 'fetch every head', args: ['fetch', 'origin', '+refs/heads/*:refs/remotes/origin/*'], cwd: SPEC.copyPath },
  { name: 'make the scratch clone', args: ['clone', '--shared', '--no-checkout', SPEC.copyPath, SCRATCH], cwd: ROOT },
  { name: 'copy remote refs into scratch', args: ['fetch', SPEC.copyPath, '+refs/remotes/origin/*:refs/remotes/origin/*'], cwd: SCRATCH },
  { name: 'check out scratch', args: ['checkout', '--detach', 'origin/main'], cwd: SCRATCH },
  { name: 'create the worktree', args: ['worktree', 'add', '-b', '017-pane-probe', WT, 'origin/main'], cwd: SPEC.copyPath },
  { name: 'list worktrees', args: ['worktree', 'list', '--porcelain'], cwd: SPEC.copyPath },
  { name: 'read a file at a commit', args: ['show', `${'b'.repeat(40)}:specs/017-pane-probe/spec.md`], cwd: WT },
  { name: 'three-way merge of one file', args: ['merge-file', '-p', join(MERGE, 'ours'), join(MERGE, 'base'), join(MERGE, 'theirs')], cwd: WT },
  { name: 'stage the feature folder', args: ['add', '--', 'specs/017-pane-probe'], cwd: WT },
  { name: 'commit', args: ['commit', '--no-verify', '-m', MSG], cwd: WT },
  { name: 'publish', args: ['push', 'origin', 'refs/heads/017-pane-probe:refs/heads/017-pane-probe'], cwd: WT },
  { name: 'fast-forward the worktree', args: ['merge', '--ff-only', 'origin/017-pane-probe'], cwd: WT },
  { name: 'undo an unpublished commit', args: ['reset', '--soft', 'a'.repeat(40)], cwd: WT },
  { name: 'diff stat', args: ['diff', '--stat', 'a'.repeat(40), 'b'.repeat(40), '--', 'specs/017-pane-probe'], cwd: WT },
  { name: 'log', args: ['log', '--format=%H%x09%an%x09%s', `${'a'.repeat(40)}..${'b'.repeat(40)}`], cwd: WT },
];

test('016: every new shape runs when it names its spec', async () => {
  const { x, git } = runner(() => ({ stdout: 'ok\n' }));
  for (const s of SHAPES) assert.equal((await git.run(s.args, { cwd: s.cwd, spec: SPEC })).stdout, 'ok\n', s.name);
  assert.deepEqual(x.calls.map((c) => c.args), SHAPES.map((s) => s.args));
});

test('016: the history-writing shapes are refused without a spec, before execFile', async () => {
  const { x, git } = runner();
  for (const s of SHAPES.filter((s) => ['checkout', 'worktree', 'show', 'merge-file', 'add', 'commit', 'push', 'reset', 'diff', 'log'].includes(s.args[0]))) {
    await assert.rejects(git.run(s.args, { cwd: s.cwd }), GitVerbRefused, s.name);
  }
  assert.equal(x.calls.length, 0);
});

const REFUSED_016 = [
  // push: force, delete, mirror, a different destination, a different or default branch, extra arguments
  ['push', '--force', 'origin', 'refs/heads/017-pane-probe:refs/heads/017-pane-probe'],
  ['push', 'origin', '+refs/heads/017-pane-probe:refs/heads/017-pane-probe'],
  ['push', '--delete', 'origin', '017-pane-probe'],
  ['push', '--mirror', 'origin'],
  ['push', 'origin', 'refs/heads/017-pane-probe:refs/heads/other'],
  ['push', 'origin', 'refs/heads/017-pane-probe:refs/heads/017-pane-probe', '--tags'],
  ['push', 'upstream', 'refs/heads/017-pane-probe:refs/heads/017-pane-probe'],
  ['push', 'origin', '017-pane-probe'],
  ['push', 'origin', 'refs/heads/017-pane-probe'],
  // commit: without --no-verify, another message shape, extra options
  ['commit', '-m', MSG],
  ['commit', '--no-verify', '-m', 'wip'],
  ['commit', '--no-verify', '-m', MSG, '--amend'],
  ['commit', '--no-verify', '--amend', '-m', MSG],
  ['commit', '-a', '--no-verify', '-m', MSG],
  // add: anything but exactly the feature folder
  ['add', '--', 'specs/018-other'],
  ['add', '--', 'specs'],
  ['add', '--', '.'],
  ['add', '-A'],
  ['add', 'specs/017-pane-probe'],
  ['add', '--', 'specs/017-pane-probe', '.specify/feature.json'],
  ['add', '--', 'specs/017-pane-probe/../../.forgejo'],
  // reset: only --soft onto the recorded remote tip
  ['reset', '--hard', 'a'.repeat(40)],
  ['reset', '--soft', 'c'.repeat(40)],
  ['reset', '--soft', 'HEAD~1'],
  ['reset', '--mixed', 'a'.repeat(40)],
  ['reset', '--soft'],
  // worktree: only add -b <feature> <path under .pdlc-specs/<Repo>/> origin/<default>, and list --porcelain
  ['worktree', 'remove', WT],
  ['worktree', 'prune'],
  ['worktree', 'add', WT, 'origin/main'],
  ['worktree', 'add', '-b', 'other-branch', WT, 'origin/main'],
  ['worktree', 'add', '-b', '017-pane-probe', '/tmp/elsewhere', 'origin/main'],
  ['worktree', 'add', '-b', '017-pane-probe', WT, 'origin/017-other'],
  ['worktree', 'add', '-B', '017-pane-probe', WT, 'origin/main'],
  ['worktree', 'list'],
  // checkout: only --detach origin/<default>
  ['checkout', 'main'],
  ['checkout', '--detach', 'origin/017-pane-probe'],
  ['checkout', '-b', '017-pane-probe'],
  // show, merge-file, diff, log: only their exact shapes
  ['show', 'HEAD'],
  [`show`, `${'b'.repeat(40)}:.forgejo/workflows/guardrails.yml`],
  ['show', 'HEAD:specs/017-pane-probe/spec.md'],
  ['merge-file', join(MERGE, 'ours'), join(MERGE, 'base'), join(MERGE, 'theirs')],
  ['merge-file', '-p', '/etc/passwd', join(MERGE, 'base'), join(MERGE, 'theirs')],
  ['diff', '--stat', 'a'.repeat(40), 'b'.repeat(40)],
  ['diff', 'a'.repeat(40), 'b'.repeat(40), '--', 'specs/017-pane-probe'],
  ['diff', '--stat', 'a'.repeat(40), 'b'.repeat(40), '--', 'specs/018-other'],
  ['log', '-p', `${'a'.repeat(40)}..${'b'.repeat(40)}`],
  ['log', '--format=%H%x09%an%x09%s', 'main'],
];

test('016: any extra or altered argument is refused, with a spec, before execFile', async () => {
  const { x, git } = runner();
  for (const args of REFUSED_016) {
    await assert.rejects(git.run(args, { cwd: WT, spec: SPEC }), GitVerbRefused, JSON.stringify(args));
  }
  assert.equal(x.calls.length, 0);
});

test('016: add, commit, push and reset run only in the spec\'s own worktree, never in the copy', async () => {
  const { x, git } = runner();
  for (const args of [['add', '--', 'specs/017-pane-probe'], ['commit', '--no-verify', '-m', MSG],
    ['push', 'origin', 'refs/heads/017-pane-probe:refs/heads/017-pane-probe'], ['reset', '--soft', 'a'.repeat(40)]]) {
    await assert.rejects(git.run(args, { cwd: SPEC.copyPath, spec: SPEC }), GitVerbRefused, JSON.stringify(args));
  }
  assert.equal(x.calls.length, 0);
});

test('016: the scratch clone must come from the copy and land under .pdlc-scratch/', async () => {
  const { x, git } = runner();
  for (const args of [
    ['clone', '--shared', '--no-checkout', '/somewhere/else', SCRATCH],
    ['clone', '--shared', '--no-checkout', SPEC.copyPath, join(ROOT, 'BELAY-2')],
    ['clone', '--shared', '--no-checkout', SPEC.copyPath, join(ROOT, '.pdlc-scratch', '..', 'BELAY')],
  ]) await assert.rejects(git.run(args, { cwd: ROOT, spec: SPEC }), GitVerbRefused, JSON.stringify(args));
  // and the scratch-only shapes run only inside the scratch folder
  await assert.rejects(git.run(['checkout', '--detach', 'origin/main'], { cwd: SPEC.copyPath, spec: SPEC }), GitVerbRefused);
  await assert.rejects(git.run(['fetch', SPEC.copyPath, '+refs/remotes/origin/*:refs/remotes/origin/*'], { cwd: SPEC.copyPath, spec: SPEC }), GitVerbRefused);
  assert.equal(x.calls.length, 0);
});

test('016: the push-target guard refuses push_target_refused for the default branch, even in a valid shape', async () => {
  const { x, git } = runner();
  const onMain = { ...SPEC, featureBranch: 'main' };
  await assert.rejects(git.run(['push', 'origin', 'refs/heads/main:refs/heads/main'], { cwd: WT, spec: onMain }),
    (e) => e instanceof Refusal && e.code === 'push_target_refused' && /default branch/.test(e.reason));
  // a valid shape for a branch that is not this spec's recorded feature branch is refused the same way
  await assert.rejects(git.run(['push', 'origin', 'refs/heads/018-other:refs/heads/018-other'], { cwd: WT, spec: SPEC }),
    (e) => e instanceof Refusal && e.code === 'push_target_refused');
  // so are commit, add, reset and worktree add when the spec's feature branch is the default branch
  for (const [args, cwd] of [[['commit', '--no-verify', '-m', MSG], WT], [['add', '--', 'specs/017-pane-probe'], WT],
    [['reset', '--soft', 'a'.repeat(40)], WT], [['worktree', 'add', '-b', 'main', WT, 'origin/main'], SPEC.copyPath]]) {
    await assert.rejects(git.run(args, { cwd, spec: onMain }), (e) => e instanceof Refusal && e.code === 'push_target_refused', JSON.stringify(args));
  }
  assert.equal(x.calls.length, 0);
});
