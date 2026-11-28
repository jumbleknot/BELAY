// "A refusal changes nothing" (FR-025; tasks.md T044, finding U1), as one reusable check for both tiers.
//
//   const snap = snapshot({ forge, folders: [specFolder], git: [repoPath] });
//   … the refused call …
//   assertUnchanged(snap);
//
// It records the fake forge's write count, a hash of every file under each folder, and, for each real git repository,
// its refs, `git status --porcelain` and HEAD. assertUnchanged fails naming what moved.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function hashTree(dir) {
  const h = createHash('sha256');
  const walk = (d, rel) => {
    if (!existsSync(d)) { h.update(`<absent ${rel}>`); return; }
    for (const name of readdirSync(d).sort()) {
      if (name === '.git') continue;
      const abs = join(d, name);
      const st = lstatSync(abs);
      if (st.isDirectory()) walk(abs, `${rel}/${name}`);
      else h.update(`${rel}/${name}\0`).update(st.isFile() ? readFileSync(abs) : Buffer.from('<special>')).update('\0');
    }
  };
  walk(dir, '');
  return h.digest('hex');
}

const gitState = (repo) => ({
  refs: execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: repo, encoding: 'utf8' }),
  status: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' }),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
});

export function snapshot({ forge = null, folders = [], git = [] } = {}) {
  return {
    forge, folders, git,
    writes: forge ? forge.writes().length : null,
    trees: folders.map(hashTree),
    repos: git.map(gitState),
  };
}

export function assertUnchanged(snap, what = 'the refusal') {
  if (snap.forge) assert.equal(snap.forge.writes().length, snap.writes, `${what} wrote to the forge`);
  snap.folders.forEach((f, i) => assert.equal(hashTree(f), snap.trees[i], `${what} changed files under ${f}`));
  snap.git.forEach((r, i) => assert.deepEqual(gitState(r), snap.repos[i], `${what} changed the git state of ${r}`));
}
