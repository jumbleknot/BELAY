// The stage trailer (feature 016, contracts/stages.md "The stage trailer"): the machine-readable last line of every
// stage-change comment on a proposal issue. `ready` reads the most recent one for a ready-to-plan item's branch and
// spec folder (FR-016); `start_spec` reads every `withdrawn` one so a withdrawn branch is never reused (FR-019).
//
// The cases live in fixtures/stage-trailer/ because the pdlc server carries its own copy of this grammar (its bundle
// cannot import from scripts/), and its tests feed the same files to it: one set of cases, two implementations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderTrailer, parseTrailer, readTrailers, TrailerError } from '../lib/stage-trailer.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/stage-trailer/${name}`, import.meta.url), 'utf8'));
const render = fixture('render.json');
const read = fixture('read.json');

for (const { in: input, out } of render.valid) {
  test(`render then parse round-trips: stage=${input.stage} branch=${input.branch}`, () => {
    const line = renderTrailer(input);
    assert.equal(line, out);
    assert.deepEqual(parseTrailer(line), input);
  });
}

for (const { in: input, why } of render.refused) {
  test(`render refuses a bad ${why}: ${JSON.stringify(input)}`, () => {
    assert.throws(() => renderTrailer(input), (e) => e instanceof TrailerError && e.field === why);
  });
}

for (const c of read.cases) {
  test(`read: ${c.name}`, () => {
    const got = readTrailers(c.comments);
    assert.deepEqual(got.latest, c.expect.latest);
    assert.deepEqual(got.withdrawn, c.expect.withdrawn);
    assert.equal(got.warnings.length, c.expect.warnings, JSON.stringify(got.warnings));
  });
}

test('read: comments may be objects with a body, as the forge returns them', () => {
  const got = readTrailers([{ body: 'x\n\n<!-- pdlc-stage: stage=merged branch=016-a spec=specs/016-a/ -->' }]);
  assert.deepEqual(got.latest, { stage: 'merged', branch: '016-a', spec: 'specs/016-a/' });
});

test('parse: anything but the exact grammar is null, never a partial record', () => {
  for (const line of ['', 'text', '<!-- pdlc-stage: stage=merged branch=016-a -->', '<!-- pdlc-stage: stage=merged branch=016-a spec=specs/016-a/ extra=1 -->',
    '<!--pdlc-stage: stage=merged branch=016-a spec=specs/016-a/ -->']) {
    assert.equal(parseTrailer(line), null, line);
  }
});

test('a warning names the issue comment position and never echoes more than the trailer line', () => {
  const got = readTrailers(['A'.repeat(5000) + '\n<!-- pdlc-stage: stage=shipped branch=016-a spec=specs/016-a/ -->']);
  assert.equal(got.warnings.length, 1);
  assert.match(got.warnings[0], /comment 1/);
  assert.ok(got.warnings[0].length < 300, got.warnings[0]);
});

// ── The stage labels and the transition table (contracts/stages.md), backlog.mjs's copy. The same transitions.json the
//    server's stages tests read, so the two enforcing copies cannot drift (FR-023). ────────────────────────────────────
import { STAGE_LABELS, stageFromLabels, checkTransition, StageError } from '../lib/stage-trailer.mjs';

const transitions = fixture('transitions.json');
const allowed016 = new Set(transitions.allowed.flatMap((r) => r.by.map((by) => `${r.from}>${r.to}>${by}`)));

test('the stage labels are contracts/stages.md\'s, in lifecycle order', () => {
  assert.deepEqual(Object.keys(STAGE_LABELS), transitions.stages);
  assert.equal(STAGE_LABELS['ready-to-plan'], 'status/ready-to-plan');
});

test('stageFromLabels reads exactly one stage label; none or two is stage_ambiguous', () => {
  assert.equal(stageFromLabels(['type/proposal', 'status/needs-spec']), 'ready');
  assert.throws(() => stageFromLabels(['type/proposal']), (e) => e instanceof StageError && e.code === 'stage_ambiguous');
  assert.throws(() => stageFromLabels(['status/needs-spec', 'status/ready-to-plan']), (e) => e instanceof StageError && e.code === 'stage_ambiguous');
});

test('cross-check: every allowed transition passes and every other (from, to, by) is stage_transition_refused', () => {
  for (const from of transitions.stages) for (const to of transitions.stages) for (const by of transitions.callers) {
    const key = `${from}>${to}>${by}`;
    if (allowed016.has(key)) assert.doesNotThrow(() => checkTransition(from, to, by), key);
    else assert.throws(() => checkTransition(from, to, by), (e) => e instanceof StageError && e.code === 'stage_transition_refused' && e.message.includes(from) && e.message.includes(to), key);
  }
});
