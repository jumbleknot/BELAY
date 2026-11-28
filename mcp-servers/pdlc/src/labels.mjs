// Label names are resolved to ids against the repository's own labels before any filtered or write
// request (spec FR-014): the forge silently ignores an unknown name in `labels=` and returns the
// UNFILTERED set (research R8, measured). A state or priority change removes one id and adds one,
// rather than replacing the whole set, so labels the server did not mean to touch stay put.
import { Refusal } from './refusal.mjs';

// External contract (contracts/proposal-body.md "Labels and states"): every target repository's
// form, backlog tooling and skill use these exact names.
export const PROPOSAL_LABEL = 'type/proposal';
export const BOT_MANAGED_LABEL = 'status/bot-managed';
export const STATUS_LABELS = Object.freeze({ draft: 'status/proposal-draft', ready: 'status/needs-spec' });
export const PRIORITIES = Object.freeze(['p1', 'p2', 'p3']);
export const priorityLabel = (p) => `priority/${p}`;
const PRIORITY_PREFIX = 'priority/';

/**
 * Load every page of a repository's labels.
 * @param {ReturnType<import('./forge-client.mjs').createForgeClient>} forge
 * @param {string} repoPath `/repos/<owner>/<name>`
 */
export async function loadLabels(forge, repoPath) {
  const { items } = await forge.getAll(`${repoPath}/labels`, { capability: 'read labels', maxPages: 20 });
  const byName = new Map(items.map((l) => [l.name, l.id]));
  const idOf = (name) => {
    if (!byName.has(name)) {
      throw new Refusal('unknown_label', `the repository has no "${name}" label; set it up in Claude Code in that repository (check_setup lists what is missing)`);
    }
    return byName.get(name);
  };
  return { has: (name) => byName.has(name), idOf, resolve: (names) => names.map(idOf), names: () => [...byName.keys()] };
}

/** The ids to remove and add to move a proposal to `target` ('draft' | 'ready'). */
export function planStatusSwap(current, target, labels) {
  const want = STATUS_LABELS[target];
  const other = target === 'draft' ? STATUS_LABELS.ready : STATUS_LABELS.draft;
  const remove = current.includes(other) ? [labels.idOf(other)] : [];
  const add = current.includes(want) ? [] : [labels.idOf(want)];
  return { remove, add };
}

/** The ids to remove and add so exactly one `priority/*` label, the target's, remains. */
export function planPrioritySwap(current, target, labels) {
  const want = priorityLabel(target);
  const remove = current.filter((n) => n.startsWith(PRIORITY_PREFIX) && n !== want).map((n) => labels.idOf(n));
  const add = current.includes(want) ? [] : [labels.idOf(want)];
  return { remove, add };
}

/** Feature 016: the stages after ready (contracts/stages.md). A proposal at one of them reports that stage id as its status. */
export const STAGE_STATUS_LABELS = Object.freeze({
  'spec-in-progress': 'status/spec-in-progress', 'ready-to-plan': 'status/ready-to-plan',
  'in-engineering': 'status/in-engineering', merged: 'status/merged',
});

/** draft ⇔ status/proposal-draft, ready ⇔ status/needs-spec; neither or both is unknown (data-model Proposal.status). */
export function statusFromLabels(names) {
  const staged = Object.entries(STAGE_STATUS_LABELS).filter(([, l]) => names.includes(l)).map(([id]) => id);
  const legacy = ['status/proposal-draft', 'status/needs-spec'].filter((l) => names.includes(l));
  if (staged.length === 1 && legacy.length === 0) return { status: staged[0], warning: null };
  if (staged.length > 0) return { status: 'unknown', warning: 'more than one stage label is present' };
  const draft = names.includes(STATUS_LABELS.draft);
  const ready = names.includes(STATUS_LABELS.ready);
  if (draft !== ready) return { status: draft ? 'draft' : 'ready', warning: null };
  return { status: 'unknown', warning: draft ? 'both status labels are present (status/proposal-draft and status/needs-spec)' : 'no status label (status/proposal-draft or status/needs-spec)' };
}

/** Exactly one priority/* label; none or several is unknown (data-model Proposal.priority). */
export function priorityFromLabels(names) {
  const found = names.filter((n) => n.startsWith(PRIORITY_PREFIX)).map((n) => n.slice(PRIORITY_PREFIX.length));
  if (found.length === 1 && PRIORITIES.includes(found[0])) return { priority: found[0], warning: null };
  return { priority: 'unknown', warning: found.length ? `several priority labels (${found.map(priorityLabel).join(', ')})` : 'no priority label (priority/p1, p2 or p3)' };
}
