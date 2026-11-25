// The read-only local proposal copy of a repository (data-model.md Local proposal copy; spec FR-017;
// research R3). One folder per repository under the clone root, which a Claude Desktop project reads.
// The only change the server ever makes to a copy is a clone or a fast-forward of the default branch.
import { existsSync as realExistsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Refusal } from './refusal.mjs';

const samePath = (a, b) => {
  const norm = (p) => { let r; try { r = realpathSync(p); } catch { r = resolve(p); } return r.replace(/\\/g, '/').replace(/\/+$/, ''); };
  const [x, y] = [norm(a), norm(b)];
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};
// Owner and repository names are case-insensitive on the forge; `.git` and a trailing / are optional.
const urlKey = (u) => String(u).trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
const hasUserinfo = (u) => /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i.test(String(u).trim());

/**
 * @param {{cloneRoot: string, originUrlFor: (name: string) => string,
 *          git: {run(args: string[], opts: {cwd: string}): Promise<{stdout: string}>},
 *          existsSync?: (p: string) => boolean}} deps
 */
export function createLocalCopy({ cloneRoot, originUrlFor, git, existsSync = realExistsSync }) {
  const out = async (args, cwd) => (await git.run(args, { cwd })).stdout.trim();
  const count = async (args, cwd) => Number.parseInt(await out(args, cwd), 10);

  const branchOf = async (path) => {
    try { return await out(['symbolic-ref', '--short', 'HEAD'], path); } catch { return null; }   // detached
  };

  /**
   * is_copy_of_repo (data-model.md): the folder is the top of a git work tree whose origin is this
   * repository. Checked FIRST, before git does anything else in the folder.
   */
  const assertCopyOfRepo = async (path, name) => {
    let top;
    try { top = await out(['rev-parse', '--show-toplevel'], path); } catch {
      throw new Refusal('copy_foreign', `${path} exists but is not a git repository; move it aside and sync again`);
    }
    if (!samePath(top, path)) throw new Refusal('copy_foreign', `${path} is inside another repository (${top}), not a copy of ${name}`);
    let origin = '';
    try { origin = await out(['config', '--get', 'remote.origin.url'], path); } catch { /* no origin */ }
    if (hasUserinfo(origin)) throw new Refusal('copy_foreign', `${path}'s origin URL carries credentials; it is not a copy this server made`);
    if (urlKey(origin) !== urlKey(originUrlFor(name))) {
      throw new Refusal('copy_foreign', `${path}'s origin is not ${name} on the configured forge; it is not a copy of ${name}`);
    }
  };

  /** dirty | off default | diverged, judged from local state only, so a refusal changes no ref. */
  const assertSafeToFastForward = async (path, branch) => {
    const current = await branchOf(path);
    if (current !== branch) {
      throw new Refusal('copy_off_branch', `${path} is ${current ? `on branch ${current}` : 'on a detached HEAD'}, not ${branch}; switch it back in your own tools`);
    }
    if ((await out(['status', '--porcelain=v1', '--untracked-files=normal'], path)) !== '') {
      throw new Refusal('copy_dirty', `${path} has local changes or untracked files; the copy is read-only, so remove them first`);
    }
    const ahead = await count(['rev-list', '--count', `origin/${branch}..HEAD`], path);
    if (ahead > 0) throw new Refusal('copy_diverged', `${path} has ${ahead} local commit(s) not on origin/${branch}; the copy is read-only and cannot be fast-forwarded`);
  };

  /** Fetch, then measure. Changes no working-tree file. */
  const measure = async (path, branch) => {
    await git.run(['fetch', 'origin', branch], { cwd: path });
    return {
      branch: await branchOf(path),
      clean: (await out(['status', '--porcelain=v1', '--untracked-files=normal'], path)) === '',
      behind: await count(['rev-list', '--count', `HEAD..origin/${branch}`], path),
      ahead: await count(['rev-list', '--count', `origin/${branch}..HEAD`], path),
    };
  };

  return {
    pathOf: (name) => join(cloneRoot, name),

    /** @param {{name: string, default_branch: string}} repo */
    async status(repo) {
      const path = join(cloneRoot, repo.name);
      if (!existsSync(path)) {
        return { repo: repo.name, path, exists: false, branch: null, default_branch: null, clean: null, behind: null, ahead: null };
      }
      await assertCopyOfRepo(path, repo.name);
      const m = await measure(path, repo.default_branch);
      return { repo: repo.name, path, exists: true, branch: m.branch, default_branch: repo.default_branch, clean: m.clean, behind: m.behind, ahead: m.ahead };
    },

    /** @param {{name: string, default_branch: string}} repo */
    async sync(repo) {
      const path = join(cloneRoot, repo.name);
      const branch = repo.default_branch;
      const result = (action, from, to) => ({ repo: repo.name, path, action, from, to, default_branch: branch });
      if (!existsSync(path)) {
        await git.run(['clone', '--filter=blob:none', '--single-branch', '--branch', branch, originUrlFor(repo.name), path], { cwd: cloneRoot });
        return result('cloned', null, await out(['rev-parse', 'HEAD'], path));
      }
      await assertCopyOfRepo(path, repo.name);
      await assertSafeToFastForward(path, branch);
      const m = await measure(path, branch);
      const from = await out(['rev-parse', 'HEAD'], path);
      if (m.behind === 0) return result('up_to_date', from, from);
      await git.run(['merge', '--ff-only', `origin/${branch}`], { cwd: path });
      return result('fast_forwarded', from, await out(['rev-parse', 'HEAD'], path));
    },
  };
}
