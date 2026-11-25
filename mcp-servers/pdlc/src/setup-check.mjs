// check_setup (data-model.md Setup check result; spec FR-028; research R4, R7). It REPORTS whether a
// repository can take proposals; it creates nothing. Labels and the form are fixed in Claude Code in
// that repository, by its own backlog tooling, so the server keeps no label-writing verb (FR-002).
//
// The master form and labels are read from ../contract/, relative to this module, so the packed
// extension carries the very copy it compares against.
import { readFileSync } from 'node:fs';
import { loadLabels, BOT_MANAGED_LABEL } from './labels.mjs';

/** Where every target repository keeps its copy of the master form. External contract. */
export const FORM_PATH = '.forgejo/issue_template/proposal.yaml';
const FORM_FILE_NAME = 'proposal.yaml';

export const FIX_HINT = 'Fix this in Claude Code in that repository: run its label setup to create the missing labels, '
  + `and commit a byte-identical copy of the master proposal form at ${FORM_PATH} on its default branch.`;

const readContract = (name) => readFileSync(new URL(`../contract/${name}`, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');

/**
 * @param {{forge: ReturnType<import('./forge-client.mjs').createForgeClient>,
 *          allowlist: ReturnType<import('./repo-allowlist.mjs').createRepoAllowlist>, config: {owner: string},
 *          masterForm?: string, masterLabels?: Array<{name: string}>}} deps
 */
export function createSetupCheck({ forge, allowlist, config, masterForm = readContract('proposal.yaml'), masterLabels = JSON.parse(readContract('proposal-labels.json')) }) {
  // status/bot-managed is only guarded against; a repository without the bot has nothing to guard.
  const required = masterLabels.map((l) => l.name).filter((n) => n !== BOT_MANAGED_LABEL);

  return {
    async check({ repo: repoArg }) {
      const repo = await allowlist.resolve(repoArg);
      const path = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(repo.name)}`;
      const labels = await loadLabels(forge, path);
      const missing_labels = required.filter((n) => !labels.has(n));

      let form;
      const text = await forge.raw(`${path}/raw/${FORM_PATH}`, { query: { ref: repo.default_branch }, capability: 'read repository files' });
      if (text === null) form = 'missing';
      else {
        const templates = (await forge.get(`${path}/issue_templates`, { capability: 'read issue templates' })) ?? [];
        // The forge skips a malformed form silently, so presence alone proves nothing (R7). Measured
        // 2026-11-25: `file_name` is the full repository path; a bare name is accepted for older builds.
        if (!templates.some((t) => t?.file_name === FORM_PATH || t?.file_name === FORM_FILE_NAME)) form = 'not_in_effect';
        else form = lf(text) === lf(masterForm) ? 'ok' : 'out_of_step';
      }

      const ok = missing_labels.length === 0 && form === 'ok';
      return { repo: repo.name, ok, default_branch: repo.default_branch, missing_labels, form, fix_hint: ok ? null : FIX_HINT };
    },
  };
}
