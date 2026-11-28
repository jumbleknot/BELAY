// The stage trailer (feature 016, contracts/stages.md "The stage trailer"; research R7).
//
// Every stage change on a proposal issue posts one comment whose LAST line is a machine-readable record:
//
//   <!-- pdlc-stage: stage=<stage id|withdrawn> branch=<branch> spec=<specs/NNN-slug/> -->
//
// The stage itself is the issue's one status label. The trailer carries what a label cannot: the feature branch and the
// spec folder. `backlog.mjs ready` prints them for ready-to-plan items (FR-016), and every `withdrawn` trailer marks a
// branch that is never reused (FR-019). An HTML comment, so the forge renders only the human text above it.
//
// THE GRAMMAR IS EXACT. A last line that starts like a trailer but does not match is ignored and reported as a warning,
// never half-read: a reader that guessed at a malformed record would list the wrong branch as ready to plan.
//
// The Claude Desktop tool server carries its own copy of this grammar, because its bundle cannot import from scripts/.
// Nothing here depends on it (feature 014 FR-035): both copies are fed the same fixtures
// (scripts/__tests__/fixtures/stage-trailer/), so they cannot drift.

// ── The stages and their transitions (contracts/stages.md). The server enforces the same table; both are tested
//    against scripts/__tests__/fixtures/stage-trailer/transitions.json. ───────────────────────────────────────────────

/** Stage id → its status label, in lifecycle order. */
export const STAGE_LABELS = Object.freeze({
  draft: 'status/proposal-draft',
  ready: 'status/needs-spec',
  'spec-in-progress': 'status/spec-in-progress',
  'ready-to-plan': 'status/ready-to-plan',
  'in-engineering': 'status/in-engineering',
  merged: 'status/merged',
});
const STAGE_IDS = Object.keys(STAGE_LABELS);
const OPEN_STAGES = STAGE_IDS.filter((s) => s !== 'merged');
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

/** A refused stage operation; `code` is stage_ambiguous or stage_transition_refused. */
export class StageError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'StageError';
    this.code = code;
  }
}

/** The one stage an issue's label names say it is at; none or two is stage_ambiguous. */
export function stageFromLabels(names) {
  const held = STAGE_IDS.filter((s) => names.includes(STAGE_LABELS[s]));
  if (held.length !== 1) throw new StageError('stage_ambiguous', held.length ? `the issue carries two or more stage labels (${held.map((s) => STAGE_LABELS[s]).join(', ')})` : 'the issue carries no stage label');
  return held[0];
}

/** Throws stage_transition_refused unless `by` may move an issue from `from` to `to`. */
export function checkTransition(from, to, by) {
  if (!TRANSITIONS.some((t) => t.to === to && t.from.includes(from) && t.by.includes(by))) {
    throw new StageError('stage_transition_refused', `a proposal at stage "${from}" cannot move to "${to}" this way (${by})`);
  }
}

/** Stage ids a trailer may carry: every stage after `ready` (contracts/stages.md "Stages"), plus `withdrawn`. */
export const TRAILER_STAGES = Object.freeze(['spec-in-progress', 'ready-to-plan', 'in-engineering', 'merged', 'withdrawn']);

const BRANCH = /^[A-Za-z0-9._/-]+$/;
// One folder under specs/, never `.` or `..`, with the trailing slash the contract requires.
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

/** Render the trailer line for one stage change. Throws TrailerError rather than write a record no reader accepts. */
export function renderTrailer({ stage, branch, spec }) {
  const bad = check({ stage, branch, spec });
  if (bad) throw new TrailerError(bad[0], `cannot write a stage trailer: ${bad[1]}`);
  return `${PREFIX} stage=${stage} branch=${branch} spec=${spec} -->`;
}

/** Parse one line. Returns { stage, branch, spec } only for an exact match, otherwise null. */
export function parseTrailer(line) {
  const m = LINE.exec(String(line ?? ''));
  if (!m) return null;
  const record = { stage: m[1], branch: m[2], spec: m[3] };
  return check(record) ? null : record;
}

const lastLine = (body) => String(body ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n').pop().trim();

/**
 * Read the stage record from an issue's comments, oldest first (strings, or objects with a `body`).
 * Returns { latest, withdrawn, warnings }:
 *   latest     the most recent valid trailer, or null;
 *   withdrawn  the branch of every `withdrawn` trailer, oldest first;
 *   warnings   one line per comment whose last line looks like a trailer but does not match the grammar.
 */
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
