// Stages of a proposal issue (feature 016, contracts/stages.md; research R7).
//
// A proposal carries exactly ONE stage label at a time, from `status/proposal-draft` to `status/merged`. A stage
// change removes the old stage label and adds the new one, touching no other label (014 R8), and is allowed only along
// the transition table below (FR-023). Every stage change except draft ⇔ ready also posts a comment whose last line is
// the stage trailer, which carries the feature branch and spec folder a label cannot.
//
// THE TRAILER GRAMMAR IS A COPY. BELAY's backlog tooling has the same grammar in scripts/lib/stage-trailer.mjs; this
// bundle cannot import from there. tests/unit/stages.test.mjs feeds both copies the same fixtures, so they stay equal.
import { Refusal } from './refusal.mjs';

/** Stage id → its label. External contract (contracts/stages.md "Stages"), in lifecycle order. */
export const STAGE_LABELS = Object.freeze({
  draft: 'status/proposal-draft',
  ready: 'status/needs-spec',
  'spec-in-progress': 'status/spec-in-progress',
  'ready-to-plan': 'status/ready-to-plan',
  'in-engineering': 'status/in-engineering',
  merged: 'status/merged',
});
const STAGES = Object.keys(STAGE_LABELS);
const OPEN_STAGES = STAGES.filter((s) => s !== 'merged');

/** The only stage changes allowed, and who may make each (contracts/stages.md "Transitions"). */
const TRANSITIONS = Object.freeze([
  { from: ['ready'], to: 'spec-in-progress', by: ['start_spec', 'backlog.mjs'] },
  { from: ['spec-in-progress'], to: 'ready-to-plan', by: ['approve_spec'] },
  { from: ['ready-to-plan'], to: 'spec-in-progress', by: ['reopen_spec'] },
  { from: ['spec-in-progress', 'ready-to-plan'], to: 'ready', by: ['withdraw_spec'] },
  { from: ['spec-in-progress', 'ready-to-plan'], to: 'draft', by: ['withdraw_spec'] },
  { from: ['spec-in-progress', 'ready-to-plan'], to: 'in-engineering', by: ['backlog.mjs'] },
  { from: OPEN_STAGES, to: 'merged', by: ['feature-merged'] },
  { from: ['draft'], to: 'ready', by: ['update_proposal'] },
  { from: ['ready'], to: 'draft', by: ['update_proposal'] },
]);

/** The one stage an issue's labels say it is at. Two stage labels, or none, is `stage_ambiguous`. */
export function stageFromLabels(names) {
  const held = STAGES.filter((s) => names.includes(STAGE_LABELS[s]));
  if (held.length !== 1) {
    const what = held.length ? `two or more stage labels (${held.map((s) => STAGE_LABELS[s]).join(', ')})` : 'no stage label';
    throw new Refusal('stage_ambiguous', `the issue has ${what}; fix its labels on the forge so it carries exactly one stage, then try again`);
  }
  return held[0];
}

/** Throws `stage_transition_refused` unless `by` may move an issue from `from` to `to`. */
export function checkTransition(from, to, by) {
  const ok = TRANSITIONS.some((t) => t.to === to && t.from.includes(from) && t.by.includes(by));
  if (!ok) {
    throw new Refusal('stage_transition_refused', `a proposal at stage "${from}" cannot move to "${to}" this way (${by}); see the stages in the pdlc runbook`);
  }
}

/** The label ids to remove and add to move from the issue's current stage to `to`; [] and [] when already there. */
export function planStageSwap(currentNames, to, labels) {
  const from = stageFromLabels(currentNames);
  if (from === to) return { remove: [], add: [] };
  return { remove: [labels.idOf(STAGE_LABELS[from])], add: [labels.idOf(STAGE_LABELS[to])] };
}

// ── the stage trailer (a copy of scripts/lib/stage-trailer.mjs; same fixtures) ───────────────────────────

export const TRAILER_STAGES = Object.freeze(['spec-in-progress', 'ready-to-plan', 'in-engineering', 'merged', 'withdrawn']);
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const SPEC = /^specs\/(?!\.+\/$)[A-Za-z0-9._-]+\/$/;
const PREFIX = '<!-- pdlc-stage:';
const LINE = /^<!-- pdlc-stage: stage=(\S+) branch=(\S+) spec=(\S+) -->$/;

/** A trailer that cannot be rendered; `field` names the offending part (stage, branch or spec). */
export class TrailerError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'TrailerError';
    this.field = field;
  }
}

function check({ stage, branch, spec }) {
  if (!TRAILER_STAGES.includes(stage)) return ['stage', `stage must be one of ${TRAILER_STAGES.join(', ')}`];
  if (typeof branch !== 'string' || !BRANCH.test(branch)) return ['branch', 'branch may contain only A-Z a-z 0-9 . _ / -'];
  if (typeof spec !== 'string' || !SPEC.test(spec)) return ['spec', 'spec must be one folder under specs/, ending in /'];
  return null;
}

export function renderTrailer({ stage, branch, spec }) {
  const bad = check({ stage, branch, spec });
  if (bad) throw new TrailerError(bad[0], `cannot write a stage trailer: ${bad[1]}`);
  return `${PREFIX} stage=${stage} branch=${branch} spec=${spec} -->`;
}

export function parseTrailer(line) {
  const m = LINE.exec(String(line ?? ''));
  if (!m) return null;
  const record = { stage: m[1], branch: m[2], spec: m[3] };
  return check(record) ? null : record;
}

const lastLine = (body) => String(body ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n').pop().trim();

/** { latest, withdrawn, warnings } from an issue's comments, oldest first (see scripts/lib/stage-trailer.mjs). */
export function readTrailers(comments) {
  let latest = null;
  const withdrawn = [];
  const warnings = [];
  (comments ?? []).forEach((comment, i) => {
    const line = lastLine(typeof comment === 'string' ? comment : comment?.body);
    if (!line.startsWith(PREFIX)) return;
    const record = parseTrailer(line);
    if (!record) {
      warnings.push(`comment ${i + 1}: ignored a malformed stage trailer: ${line.slice(0, 200)}`);
      return;
    }
    latest = record;
    if (record.stage === 'withdrawn') withdrawn.push(record.branch);
  });
  return { latest, withdrawn, warnings };
}
