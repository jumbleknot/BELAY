// A real-git "forge" in a temp folder: bare repositories with uploadpack.allowFilter=true, addressed as
// file:// URLs. A plain path would make git ignore --filter and hardlink instead, leaving the blobless
// clone untested (research R3). Setup uses git directly; the server's git runner never commits.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const IDENTITY = ['-c', 'user.name=pdlc-test', '-c', 'user.email=pdlc-test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
export const sh = (cwd, ...args) => execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function bareForge() {
  const root = mkdtempSync(join(tmpdir(), 'pdlc-git-'));
  const forgeDir = join(root, 'forge');
  const work = join(root, 'work');
  const cloneRoot = join(root, 'clones');
  for (const d of [forgeDir, work, cloneRoot]) mkdirSync(d);

  /** Create a bare repository `name` whose default branch is `branch`, with one commit. */
  const createRepo = (name, { branch = 'main', files = { 'README.md': `# ${name}\n` } } = {}) => {
    const bare = join(forgeDir, `${name}.git`);
    sh(forgeDir, 'init', '--bare', '--initial-branch', branch, bare);
    sh(bare, 'config', 'uploadpack.allowFilter', 'true');
    sh(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    const w = join(work, name);
    sh(work, 'clone', pathToFileURL(bare).href, w);
    sh(w, 'checkout', '-B', branch);
    for (const [f, text] of Object.entries(files)) { mkdirSync(dirname(join(w, f)), { recursive: true }); writeFileSync(join(w, f), text); }
    sh(w, 'add', '-A');
    sh(w, 'commit', '-m', 'initial');
    sh(w, 'push', 'origin', `HEAD:refs/heads/${branch}`);
    return { bare, work: w, branch };
  };

  /** Push one more commit to the bare repository, from the work tree. Returns the new sha. */
  const pushCommit = ({ work: w, branch }, file = 'CHANGELOG.md', text = `change ${Date.now()}\n`) => {
    writeFileSync(join(w, file), text);
    sh(w, 'add', '-A');
    sh(w, 'commit', '-m', `update ${file}`);
    sh(w, 'push', 'origin', `HEAD:refs/heads/${branch}`);
    return sh(w, 'rev-parse', 'HEAD');
  };

  const originUrlFor = (name) => pathToFileURL(join(forgeDir, `${name}.git`)).href;
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, cloneRoot, createRepo, pushCommit, originUrlFor, cleanup };
}

/** A fingerprint of a copy's state that a refusal must leave byte-identical. */
export function copyState(path) {
  return {
    status: sh(path, 'status', '--porcelain=v1', '--untracked-files=all'),
    head: sh(path, 'rev-parse', 'HEAD'),
    refs: sh(path, 'for-each-ref', '--format=%(refname) %(objectname)'),
    stash: sh(path, 'stash', 'list'),
    commits: sh(path, 'rev-list', '--all', '--count'),
  };
}
