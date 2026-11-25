// Wires the real modules to the fake forge (and an optional fake git), as server.mjs does in production.
import { createForgeClient } from '../../../src/forge-client.mjs';
import { createRepoAllowlist } from '../../../src/repo-allowlist.mjs';
import { createProposals } from '../../../src/proposals.mjs';
import { fakeForge } from './fake-forge.mjs';
import { config } from './fixtures.mjs';

export function world(opts = {}) {
  const forge = fakeForge(opts);
  const client = createForgeClient({ config, fetch: forge.fetch });
  const allowlist = createRepoAllowlist({ forge: client, config, existsSync: () => false });
  const proposals = createProposals({ forge: client, allowlist, config });
  return { forge, client, allowlist, proposals, config };
}
