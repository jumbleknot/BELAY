// Real git, no doubles: a copy the server must not touch is refused, and left byte-identical
// (data-model.md Local proposal copy .dirty, .branch, .diverged, .is_copy_of_repo; FR-017; SC-004,
// SC-005; US3-AC4, US3-AC5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalCopy } from '../../src/local-copy.mjs';
import { createGitRunner } from '../../src/git-runner.mjs';
import { Refusal } from '../../src/refusal.mjs';
import { bareForge, sh, copyState } from './helpers/bare-forge.mjs';

const forge = bareForge();
test.after(() => forge.cleanup());
const lc = createLocalCopy({ cloneRoot: forge.cloneRoot, originUrlFor: forge.originUrlFor, git: createGitRunner({ token: 'canary-refusals-0123456789' }) });

/** A fresh, synced copy of a fresh repository, so every case starts clean. */
async function freshCopy(name) {
  const src = forge.createRepo(name, { files: { 'README.md': `# ${name}\n`, 'notes.md': 'tracked\n' } });
  const repo = { name, default_branch: 'main' };
  assert.equal((await lc.sync(repo)).action, 'cloned');
  return { src, repo, path: join(forge.cloneRoot, name) };
}

async function refusedUnchanged(repo, path, code, op = 'sync') {
  const before = copyState(path);
  let e;
  try { await lc[op](repo); } catch (err) { e = err; }
  assert.ok(e instanceof Refusal, `${op} on ${repo.name}: expected ${code}, got ${e?.stack ?? JSON.stringify(e)}`);
  assert.equal(e.code, code);
  assert.ok(e.reason.length > 0);
  assert.deepEqual(copyState(path), before, `${repo.name}: the copy changed`);
}

test('a modified tracked file is copy_dirty, and nothing changes', async () => {
  const { src, repo, path } = await freshCopy('dirty-tracked');
  forge.pushCommit(src);
  writeFileSync(join(path, 'notes.md'), 'edited by hand\n');
  await refusedUnchanged(repo, path, 'copy_dirty');
  assert.equal(readFileSync(join(path, 'notes.md'), 'utf8'), 'edited by hand\n');
});

test('an untracked file is copy_dirty, and nothing changes', async () => {
  const { src, repo, path } = await freshCopy('dirty-untracked');
  forge.pushCommit(src);
  writeFileSync(join(path, 'scratch.txt'), 'mine\n');
  await refusedUnchanged(repo, path, 'copy_dirty');
});

test('another branch is copy_off_branch, and nothing changes', async () => {
  const { src, repo, path } = await freshCopy('off-branch');
  forge.pushCommit(src);
  sh(path, 'checkout', '-q', '-b', 'experiment');
  await refusedUnchanged(repo, path, 'copy_off_branch');
});

test('a detached HEAD is copy_off_branch, and nothing changes', async () => {
  const { src, repo, path } = await freshCopy('detached');
  forge.pushCommit(src);
  sh(path, 'checkout', '-q', '--detach');
  await refusedUnchanged(repo, path, 'copy_off_branch');
});

test('a local commit ahead of origin is copy_diverged, and nothing changes', async () => {
  const { src, repo, path } = await freshCopy('diverged');
  forge.pushCommit(src);
  writeFileSync(join(path, 'local.md'), 'a local commit\n');
  sh(path, 'add', '-A');
  sh(path, 'commit', '-q', '-m', 'local');
  await refusedUnchanged(repo, path, 'copy_diverged');
});

test('a repository with a different origin is copy_foreign for sync and for status, and nothing changes', async () => {
  const { repo, path } = await freshCopy('foreign-origin');
  const other = forge.createRepo('somewhere-else');
  sh(path, 'remote', 'set-url', 'origin', forge.originUrlFor('somewhere-else'));
  await refusedUnchanged(repo, path, 'copy_foreign');
  await refusedUnchanged(repo, path, 'copy_foreign', 'status');
  assert.ok(other);
});

test('a folder that is not a repository is copy_foreign, and nothing is created in it', async () => {
  const path = join(forge.cloneRoot, 'not-a-repo');
  mkdirSync(path);
  writeFileSync(join(path, 'keep.txt'), 'mine\n');
  const repo = { name: 'not-a-repo', default_branch: 'main' };
  for (const op of ['sync', 'status']) {
    let e;
    try { await lc[op](repo); } catch (err) { e = err; }
    assert.ok(e instanceof Refusal && e.code === 'copy_foreign', `${op}: ${e?.stack ?? e}`);
  }
  assert.deepEqual(readdirSync(path), ['keep.txt']);
});

test('a subfolder of another repository is copy_foreign (rev-parse --show-toplevel is not the folder)', async () => {
  const { path: parent } = await freshCopy('parent-repo');
  const nested = join(parent, 'nested');
  mkdirSync(nested);
  const lcNested = createLocalCopy({ cloneRoot: parent, originUrlFor: () => forge.originUrlFor('parent-repo'), git: createGitRunner({ token: 't' }) });
  let e;
  try { await lcNested.sync({ name: 'nested', default_branch: 'main' }); } catch (err) { e = err; }
  assert.ok(e instanceof Refusal && e.code === 'copy_foreign', String(e?.stack ?? e));
});

test('after every operation in this file, no copy gained a branch, a stash or an extra commit', () => {
  for (const name of readdirSync(forge.cloneRoot)) {
    const path = join(forge.cloneRoot, name);
    let stash;
    try { stash = sh(path, 'stash', 'list'); } catch { continue; }   // not a repository
    assert.equal(stash, '', `${name} has a stash`);
    const heads = sh(path, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').sort();
    const expected = { 'off-branch': ['experiment', 'main'] }[name] ?? ['main'];
    assert.deepEqual(heads, expected, name);
  }
});
