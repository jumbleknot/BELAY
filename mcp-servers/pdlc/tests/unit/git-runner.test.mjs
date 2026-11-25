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
