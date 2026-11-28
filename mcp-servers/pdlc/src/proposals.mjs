// Proposals are forge issues labelled type/proposal (data-model.md Proposal). Every operation applies
// the write guards IN ORDER and refuses at the first failure, before anything is written (FR-012 to
// FR-019):
//   0. schema and size (also checked by the server before the handler runs)
//   1. the repository is in the owner's allowlist
//   2. update/comment: the issue exists, is not a PR, carries type/proposal, not status/bot-managed
//   3. every label name resolves in this repository
//   4. update: updated_at equals expected_updated_at
//   5. create: no open proposal has the same title
import { Refusal } from './refusal.mjs';
import { MAX_BODY_BYTES, MAX_TITLE_CHARS, SECTION_IDS } from './tool-contract.mjs';
import { renderBody, parseBody } from './proposal-body.mjs';
import {
  BOT_MANAGED_LABEL, PROPOSAL_LABEL, STAGE_STATUS_LABELS, STATUS_LABELS, loadLabels, planPrioritySwap, planStatusSwap, priorityFromLabels,
  priorityLabel, statusFromLabels,
} from './labels.mjs';

export const TITLE_PREFIX = 'Proposal: ';
const titleFor = (featureName) => `${TITLE_PREFIX}${featureName.trim()}`;
const titleKey = (t) => String(t).trim().toLowerCase();

function checkSections(sections, { requireFeatureName }) {
  const unknown = Object.keys(sections ?? {}).filter((k) => !SECTION_IDS.includes(k));
  if (unknown.length) throw new Refusal('invalid_input', `unknown section(s): ${unknown.join(', ')}; the ids are ${SECTION_IDS.join(', ')}`);
  if (requireFeatureName && String(sections?.feature_name ?? '').trim() === '') {
    throw new Refusal('invalid_input', 'feature_name must not be empty: the title is derived from it');
  }
}

function checkTitle(title) {
  if (!title.startsWith(TITLE_PREFIX) || title.slice(TITLE_PREFIX.length).trim() === '') {
    throw new Refusal('invalid_input', `the title must be "${TITLE_PREFIX}<feature name>"`);
  }
  if (title.length > MAX_TITLE_CHARS) throw new Refusal('invalid_input', `the title is longer than ${MAX_TITLE_CHARS} characters`);
}

function checkBodySize(body) {
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_BODY_BYTES) throw new Refusal('invalid_input', `the body would be ${bytes} bytes; the limit is ${MAX_BODY_BYTES}`);
}

const names = (issue) => (issue.labels ?? []).map((l) => l.name);

/**
 * @param {{forge: ReturnType<import('./forge-client.mjs').createForgeClient>,
 *          allowlist: ReturnType<import('./repo-allowlist.mjs').createRepoAllowlist>, config: {owner: string}}} deps
 */
export function createProposals({ forge, allowlist, config }) {
  const repoPath = (name) => `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(name)}`;

  /** Guards 1 and 2 for a read or a write on one issue. */
  const loadProposal = async (repoArg, number, { write }) => {
    const repo = await allowlist.resolve(repoArg);
    const path = repoPath(repo.name);
    let issue;
    try {
      issue = await forge.get(`${path}/issues/${number}`, { capability: 'read issues' });
    } catch (e) {
      if (e instanceof Refusal && e.code === 'not_found') throw new Refusal('not_found', `${repo.name} has no issue #${number}`);
      throw e;
    }
    if (issue.pull_request) throw new Refusal('not_a_proposal', `#${number} in ${repo.name} is a pull request, not a proposal`);
    if (!names(issue).includes(PROPOSAL_LABEL)) throw new Refusal('not_a_proposal', `#${number} in ${repo.name} is not labelled ${PROPOSAL_LABEL}`);
    if (write && names(issue).includes(BOT_MANAGED_LABEL)) {
      throw new Refusal('bot_managed', `#${number} in ${repo.name} carries ${BOT_MANAGED_LABEL}; it belongs to the dependency bot`);
    }
    return { repo, path, issue };
  };

  const summary = (issue) => {
    const labelNames = names(issue);
    return { status: statusFromLabels(labelNames).status, priority: priorityFromLabels(labelNames).priority };
  };

  return {
    repoPath,
    loadProposal,

    async create({ repo: repoArg, title, sections, priority, status }) {
      checkSections(sections, { requireFeatureName: true });
      const finalTitle = titleFor(sections.feature_name);
      if (title.trim() !== finalTitle) throw new Refusal('invalid_input', `the title must be "${finalTitle}" (${TITLE_PREFIX}<feature name>)`);
      checkTitle(finalTitle);
      const body = renderBody({ ...sections, priority });
      checkBodySize(body);

      const repo = await allowlist.resolve(repoArg);
      const path = repoPath(repo.name);
      const labels = await loadLabels(forge, path);
      const labelIds = labels.resolve([PROPOSAL_LABEL, STATUS_LABELS[status], priorityLabel(priority)]);

      const { items } = await forge.getAll(`${path}/issues`, {
        query: { state: 'open', type: 'issues', labels: PROPOSAL_LABEL }, capability: 'list issues', maxPages: 20,
      });
      const clash = items.find((i) => !i.pull_request && names(i).includes(PROPOSAL_LABEL) && titleKey(i.title) === titleKey(finalTitle));
      if (clash) throw new Refusal('duplicate_title', `open proposal #${clash.number} in ${repo.name} already has this title; update it instead`, { number: clash.number });

      const created = await forge.post(`${path}/issues`, { title: finalTitle, body, labels: labelIds }, { capability: 'create issues' });
      return { number: created.number, title: created.title, status, priority, url: created.html_url, updated_at: created.updated_at };
    },

    async get({ repo: repoArg, number }) {
      const { path, issue } = await loadProposal(repoArg, number, { write: false });
      const { items: comments } = await forge.getAll(`${path}/issues/${number}/comments`, { capability: 'read comments', maxPages: 20 });
      const labelNames = names(issue);
      const parsed = parseBody(issue.body ?? '');
      const status = statusFromLabels(labelNames);
      const priority = priorityFromLabels(labelNames);
      const warnings = [...parsed.warnings];
      if (status.warning) warnings.push(status.warning);
      if (priority.warning) warnings.push(priority.warning);
      const sectionPriority = parsed.sections.priority.trim().toLowerCase();
      if (priority.priority !== 'unknown' && sectionPriority !== '' && sectionPriority !== priority.priority) {
        warnings.push(`the priority label (${priority.priority}) differs from the Priority section (${sectionPriority}); the label wins`);
      }
      return {
        number: issue.number, title: issue.title, status: status.status, priority: priority.priority, state: issue.state,
        sections: parsed.sections, labels: labelNames,
        comments: comments.map((c) => ({ author: c.user?.login ?? null, created_at: c.created_at, body: c.body })),
        updated_at: issue.updated_at, url: issue.html_url, warnings,
      };
    },

    async list({ repo: repoArg, status, query, state = 'open' }, { maxPages = 10 } = {}) {
      const repo = await allowlist.resolve(repoArg);
      const path = repoPath(repo.name);
      const wanted = status === 'all' ? [PROPOSAL_LABEL] : [PROPOSAL_LABEL, STATUS_LABELS[status] ?? STAGE_STATUS_LABELS[status]];
      (await loadLabels(forge, path)).resolve(wanted);   // guard 3: an unknown name would be IGNORED by the forge
      const r = await forge.getAll(`${path}/issues`, {
        query: { state, type: 'issues', labels: wanted.join(','), ...(query ? { q: query } : {}) },
        capability: 'list issues', maxPages,
      });
      const proposals = r.items
        .filter((i) => !i.pull_request && wanted.every((w) => names(i).includes(w)))
        .map((i) => ({ number: i.number, title: i.title, ...summary(i), state: i.state, updated_at: i.updated_at }));
      return { proposals, total: r.truncated ? r.total : proposals.length, truncated: r.truncated };
    },

    async update({ repo: repoArg, number, expected_updated_at, title, sections = {}, priority, status }) {
      checkSections(sections, { requireFeatureName: false });
      if (title !== undefined) checkTitle(title);
      checkBodySize(renderBody(sections));                                  // guard 0 on what was given

      const { path, issue } = await loadProposal(repoArg, number, { write: true });   // guards 1, 2
      const labelNames = names(issue);
      const labels = await loadLabels(forge, path);                          // guard 3
      const statusSwap = status ? planStatusSwap(labelNames, status, labels) : { remove: [], add: [] };
      const prioritySwap = priority ? planPrioritySwap(labelNames, priority, labels) : { remove: [], add: [] };
      if (issue.updated_at !== expected_updated_at) {                         // guard 4
        throw new Refusal('stale', `#${number} changed since ${expected_updated_at}; read it again with get_proposal and merge`, { updated_at: issue.updated_at });
      }

      const current = parseBody(issue.body ?? '').sections;
      const next = { ...current, ...sections, ...(priority ? { priority } : {}) };
      const body = renderBody(next);
      checkBodySize(body);
      const changed = [];
      if (title !== undefined && title !== issue.title) changed.push('title');
      for (const id of SECTION_IDS) if (id in sections && sections[id] !== current[id]) changed.push(`sections.${id}`);
      if (prioritySwap.remove.length || prioritySwap.add.length) changed.push('priority');
      if (statusSwap.remove.length || statusSwap.add.length) changed.push('status');

      const patch = {};
      if (changed.includes('title')) patch.title = title;
      if (body !== renderBody(current)) patch.body = body;
      if (Object.keys(patch).length) await forge.patch(`${path}/issues/${number}`, patch, { capability: 'edit issues' });
      // R8: remove the one old id, then add the new one; never replace the whole label set.
      for (const id of [...statusSwap.remove, ...prioritySwap.remove]) await forge.delete(`${path}/issues/${number}/labels/${id}`, { capability: 'edit issue labels' });
      const add = [...statusSwap.add, ...prioritySwap.add];
      if (add.length) await forge.post(`${path}/issues/${number}/labels`, { labels: add }, { capability: 'edit issue labels' });

      const after = changed.length ? await forge.get(`${path}/issues/${number}`, { capability: 'read issues' }) : issue;
      return { number, title: after.title, ...summary(after), url: after.html_url, updated_at: after.updated_at, changed };
    },

    async comment({ repo: repoArg, number, body }) {
      const bytes = Buffer.byteLength(body ?? '', 'utf8');
      if (bytes === 0 || bytes > MAX_BODY_BYTES) throw new Refusal('invalid_input', `a comment must be 1 to ${MAX_BODY_BYTES} bytes (got ${bytes})`);
      const { path } = await loadProposal(repoArg, number, { write: true });
      const c = await forge.post(`${path}/issues/${number}/comments`, { body }, { capability: 'comment on issues' });
      const after = await forge.get(`${path}/issues/${number}`, { capability: 'read issues' });
      return { number, comment_url: c.html_url, updated_at: after.updated_at };
    },

    summary,
  };
}
