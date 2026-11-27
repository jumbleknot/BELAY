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
