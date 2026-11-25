// Real git, no doubles (constitution Test Type Integrity): clone and fast-forward against local bare
// repositories (US1-AC2, US1-AC3, FR-017 credential not stored; research R2, R3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalCopy } from '../../src/local-copy.mjs';
import { createGitRunner } from '../../src/git-runner.mjs';
import { bareForge, sh, copyState } from './helpers/bare-forge.mjs';

const TOKEN = 'canary-integration-0123456789abcdef';
const forge = bareForge();
test.after(() => forge.cleanup());

const lc = createLocalCopy({ cloneRoot: forge.cloneRoot, originUrlFor: forge.originUrlFor, git: createGitRunner({ token: TOKEN }) });

test('sync clones a blobless, single-branch copy whose files are readable, then status and fast-forward work', async () => {
  const src = forge.createRepo('alpha', { files: { 'README.md': '# alpha\n', 'docs/vision.md': 'the vision\n' } });
  const repo = { name: 'alpha', default_branch: 'main' };

  const cloned = await lc.sync(repo);
  assert.equal(cloned.action, 'cloned');
  assert.equal(cloned.to, sh(src.work, 'rev-parse', 'HEAD'));
  const path = join(forge.cloneRoot, 'alpha');
  assert.equal(readFileSync(join(path, 'docs', 'vision.md'), 'utf8'), 'the vision\n');

  assert.equal(sh(path, 'config', '--get', 'remote.origin.promisor'), 'true');
  assert.equal(sh(path, 'config', '--get', 'remote.origin.partialclonefilter'), 'blob:none');

  const clean = await lc.status(repo);
  assert.deepEqual({ exists: clean.exists, branch: clean.branch, clean: clean.clean, behind: clean.behind, ahead: clean.ahead },
    { exists: true, branch: 'main', clean: true, behind: 0, ahead: 0 });

  const newSha = forge.pushCommit(src, 'CHANGELOG.md', 'v2\n');
  const before = copyState(path);
  const behind = await lc.status(repo);
  assert.equal(behind.behind, 1);
  assert.equal(copyState(path).status, before.status, 'status changes no working-tree file');
  assert.equal(copyState(path).head, before.head);
  assert.equal(existsSync(join(path, 'CHANGELOG.md')), false);

  const ff = await lc.sync(repo);
  assert.deepEqual({ action: ff.action, from: ff.from, to: ff.to }, { action: 'fast_forwarded', from: before.head, to: newSha });
  assert.equal(readFileSync(join(path, 'CHANGELOG.md'), 'utf8'), 'v2\n');

  const again = await lc.sync(repo);
  assert.equal(again.action, 'up_to_date');
});

test('a repository whose default branch is not main is cloned and synced on that branch', async () => {
  const src = forge.createRepo('beta', { branch: 'trunk' });
  const repo = { name: 'beta', default_branch: 'trunk' };
  assert.equal((await lc.sync(repo)).action, 'cloned');
  const path = join(forge.cloneRoot, 'beta');
  assert.equal(sh(path, 'symbolic-ref', '--short', 'HEAD'), 'trunk');
  const sha = forge.pushCommit(src);
  assert.equal((await lc.status(repo)).behind, 1);
  assert.equal((await lc.sync(repo)).to, sha);
});

test('.git/config holds no credential and no userinfo after clone and fetch', async () => {
  for (const name of ['alpha', 'beta']) {
    const config = readFileSync(join(forge.cloneRoot, name, '.git', 'config'), 'utf8');
    assert.doesNotMatch(config, /canary-|Authorization|extraHeader|token/i, name);
    assert.doesNotMatch(config, /:\/\/[^/\s]*@/, `${name}: no userinfo in any URL`);
  }
});

test('no operation created a commit, branch or stash in the copy', () => {
  for (const [name, branch] of [['alpha', 'main'], ['beta', 'trunk']]) {
    const path = join(forge.cloneRoot, name);
    assert.equal(sh(path, 'stash', 'list'), '');
    const heads = sh(path, 'for-each-ref', '--format=%(refname)', 'refs/heads');
    assert.equal(heads.split('\n').length, 1, `${name} has only its default branch: ${heads}`);
    assert.equal(sh(path, 'rev-list', '--count', `origin/${branch}..HEAD`), '0');
  }
});
