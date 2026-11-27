// The server's stage module (feature 016, contracts/stages.md; research R7). Stage labels, the transition table that
// guards every stage change (FR-023), the label swap, and the server's copy of the stage trailer grammar.
//
// CROSS-CHECK: the trailer and transition cases are the fixtures scripts/lib/stage-trailer.mjs is tested against
// (scripts/__tests__/fixtures/stage-trailer/). The bundle cannot import from scripts/, so the server keeps its own copy;
// feeding both the same files is what keeps the two copies equal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STAGE_LABELS, stageFromLabels, checkTransition, planStageSwap,
  renderTrailer, parseTrailer, readTrailers, TrailerError,
} from '../../src/stages.mjs';
import { Refusal } from '../../src/refusal.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../../../scripts/__tests__/fixtures/stage-trailer/${name}`, import.meta.url), 'utf8'));
const transitions = fixture('transitions.json');
const render = fixture('render.json');
const read = fixture('read.json');
const contractLabels = JSON.parse(readFileSync(new URL('../../contract/proposal-labels.json', import.meta.url), 'utf8')).map((l) => l.name);

const refusedWith = (code) => (e) => e instanceof Refusal && e.code === code;

// ── stage labels ──────────────────────────────────────────────────────────────────────────────────────────

test('every stage has exactly the label contracts/stages.md names, and each is in the shared label contract', () => {
  assert.deepEqual(STAGE_LABELS, {
    draft: 'status/proposal-draft', ready: 'status/needs-spec', 'spec-in-progress': 'status/spec-in-progress',
    'ready-to-plan': 'status/ready-to-plan', 'in-engineering': 'status/in-engineering', merged: 'status/merged',
  });
  assert.deepEqual(Object.keys(STAGE_LABELS), transitions.stages);
  for (const label of Object.values(STAGE_LABELS)) assert.ok(contractLabels.includes(label), label);
});

test('stageFromLabels reads the one stage label, ignoring type and priority labels', () => {
  for (const [stage, label] of Object.entries(STAGE_LABELS)) {
    assert.equal(stageFromLabels(['type/proposal', label, 'priority/p2']), stage);
  }
});

test('stage_ambiguous: two stage labels, or none, is refused (data-model.md Proposal issue.stage)', () => {
  assert.throws(() => stageFromLabels(['type/proposal', 'status/needs-spec', 'status/spec-in-progress']), refusedWith('stage_ambiguous'));
  assert.throws(() => stageFromLabels(['type/proposal', 'priority/p1']), refusedWith('stage_ambiguous'));
  assert.throws(() => stageFromLabels([]), refusedWith('stage_ambiguous'));
});

// ── the transition table (FR-023) ─────────────────────────────────────────────────────────────────────────

const allowed = new Set(transitions.allowed.flatMap((r) => r.by.map((by) => `${r.from}>${r.to}>${by}`)));

for (const row of transitions.allowed) {
  for (const by of row.by) {
    test(`allowed: ${row.from} → ${row.to} by ${by}`, () => {
      assert.doesNotThrow(() => checkTransition(row.from, row.to, by));
    });
  }
}

test('every other (from, to, caller) is refused stage_transition_refused, naming both stages', () => {
  let refused = 0;
  for (const from of transitions.stages) {
    for (const to of transitions.stages) {
      for (const by of transitions.callers) {
        if (allowed.has(`${from}>${to}>${by}`)) continue;
        assert.throws(() => checkTransition(from, to, by), (e) => refusedWith('stage_transition_refused')(e)
          && e.reason.includes(from) && e.reason.includes(to), `${from} → ${to} by ${by}`);
        refused += 1;
      }
    }
  }
  assert.equal(refused, 6 * 6 * 7 - allowed.size);
});

test('an unknown caller or stage is refused, never treated as allowed', () => {
  assert.throws(() => checkTransition('ready', 'spec-in-progress', 'someone_else'), refusedWith('stage_transition_refused'));
  assert.throws(() => checkTransition('ready', 'shipped', 'start_spec'), refusedWith('stage_transition_refused'));
});

// ── the label swap ────────────────────────────────────────────────────────────────────────────────────────

const ids = new Map(contractLabels.map((name, i) => [name, 100 + i]));
const labels = { idOf: (n) => { if (!ids.has(n)) throw new Error(`no ${n}`); return ids.get(n); } };

test('planStageSwap removes only the old stage label and adds the new one; type and priority are untouched', () => {
  const current = ['type/proposal', 'status/needs-spec', 'priority/p1'];
  assert.deepEqual(planStageSwap(current, 'spec-in-progress', labels), {
    remove: [ids.get('status/needs-spec')], add: [ids.get('status/spec-in-progress')],
  });
});

test('planStageSwap to the stage already held is a no-op (idempotent re-apply)', () => {
  assert.deepEqual(planStageSwap(['type/proposal', 'status/ready-to-plan'], 'ready-to-plan', labels), { remove: [], add: [] });
});

test('planStageSwap refuses an ambiguous starting point rather than guessing which label to remove', () => {
  assert.throws(() => planStageSwap(['status/needs-spec', 'status/spec-in-progress'], 'ready-to-plan', labels), refusedWith('stage_ambiguous'));
});

// ── the trailer: the same fixtures as scripts/lib/stage-trailer.mjs (cross-check) ─────────────────────────

for (const { in: input, out } of render.valid) {
  test(`cross-check render/parse: stage=${input.stage} branch=${input.branch}`, () => {
    assert.equal(renderTrailer(input), out);
    assert.deepEqual(parseTrailer(out), input);
  });
}

for (const { in: input, why } of render.refused) {
  test(`cross-check render refuses a bad ${why}: ${JSON.stringify(input)}`, () => {
    assert.throws(() => renderTrailer(input), (e) => e instanceof TrailerError && e.field === why);
  });
}

for (const c of read.cases) {
  test(`cross-check read: ${c.name}`, () => {
    const got = readTrailers(c.comments);
    assert.deepEqual(got.latest, c.expect.latest);
    assert.deepEqual(got.withdrawn, c.expect.withdrawn);
    assert.equal(got.warnings.length, c.expect.warnings);
  });
}
