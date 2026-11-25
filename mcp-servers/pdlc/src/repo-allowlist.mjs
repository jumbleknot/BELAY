// The owner-and-repository guard (spec FR-012; research R1). The token can see every repository the
// account can see, so filtering /repos/search to the configured owner IS the allowlist, never an
// optional nicety. Names come back in canonical case, and only the canonical name is used afterwards.
import { existsSync as realExistsSync } from 'node:fs';
import { join } from 'node:path';
import { Refusal } from './refusal.mjs';

/**
 * @param {{forge: ReturnType<import('./forge-client.mjs').createForgeClient>, config: {owner: string, cloneRoot: string},
 *          existsSync?: (p: string) => boolean}} deps
 */
export function createRepoAllowlist({ forge, config, existsSync = realExistsSync }) {
  const owner = config.owner.toLowerCase();
  let cache = null;

  const load = async () => {
    const { items, truncated } = await forge.getAll('/repos/search', {
      capability: 'list repositories',
      rows: (body) => body?.data ?? [],
    });
    const repos = items
      .filter((r) => String(r?.owner?.login ?? '').toLowerCase() === owner)
      .map((r) => ({ name: r.name, description: r.description ?? '', default_branch: r.default_branch }));
    cache = { repos, truncated };
    return cache;
  };

  const find = (name) => cache.repos.find((r) => r.name.toLowerCase() === name.toLowerCase());

  return {
    async list() {
      const { repos, truncated } = await load();
      return { repos: repos.map((r) => ({ ...r, has_clone: existsSync(join(config.cloneRoot, r.name, '.git')) })), truncated };
    },

    /** The canonical repository row for a requested name, or a refusal before any other forge request. */
    async resolve(requested) {
      if (typeof requested !== 'string' || requested.trim() === '') {
        throw new Refusal('unknown_repo', 'name a repository from list_repos');
      }
      if (requested.includes('/')) {
        throw new Refusal('unknown_repo', `"${requested}" names an owner; give only the repository name, which must be under ${config.owner}`);
      }
      if (!cache) await load();
      let hit = find(requested);
      if (!hit) { await load(); hit = find(requested); }
      if (!hit) throw new Refusal('unknown_repo', `"${requested}" is not a repository under ${config.owner}; call list_repos for the names`);
      return { ...hit };
    },
  };
}
