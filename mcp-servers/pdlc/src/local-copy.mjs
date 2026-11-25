// The read-only local proposal copy of a repository (data-model.md Local proposal copy; spec FR-017;
// research R3). One folder per repository under the clone root, which a Claude Desktop project reads.
// The only change the server ever makes to a copy is a clone or a fast-forward of the default branch.
import { existsSync as realExistsSync } from 'node:fs';
import { join } from 'node:path';

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
      const m = await measure(path, branch);
      const from = await out(['rev-parse', 'HEAD'], path);
      if (m.behind === 0) return result('up_to_date', from, from);
      await git.run(['merge', '--ff-only', `origin/${branch}`], { cwd: path });
      return result('fast_forwarded', from, await out(['rev-parse', 'HEAD'], path));
    },
  };
}
