// Guards scripts/allowlist-expiry.mjs — the single home for allowlist expiry semantics.
//
// Ported from MovieCollectionManager (MCM) at fc2b953 (its features 033 and 057), as part of
// BELAY feature 006.
//
// Expiry used to be BINARY: full suppression until the date, hard fail the next morning, no signal
// between — and the failure surfaced on whichever unrelated pull request happened to run first. This
// module adds the tier in between. It is pure on purpose: `today` is always passed in, never read
// from the clock, so both inclusive boundaries are testable without mocking time and a runner's
// timezone cannot shift a classification.
//
// The unmatched-entry cases are the subtle half. An entry keyed on an exact advisory id silently
// stops suppressing when a scanner switches identifier namespace — measured in MCM when pip-audit
// began reporting a CVE under a PYSEC id and the entries "did not expire, they just quietly matched
// nothing". But reporting every unmatched entry would go red every time a scanner was skipped, so the
// scanner-produced-findings guard is what keeps the signal worth reading.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WARNING_WINDOW_DAYS,
  classifyExpiry,
  daysUntil,
  selectUnmatched,
  formatExpiring,
  formatExpired,
  formatUnmatched,
} from '../allowlist-expiry.mjs';

const TODAY = '2026-08-13';

test('the warning window is 14 days', () => {
  assert.equal(WARNING_WINDOW_DAYS, 14);
});

test('daysUntil counts whole days on UTC boundaries and goes negative once past', () => {
  assert.equal(daysUntil('2026-08-13', TODAY), 0);
  assert.equal(daysUntil('2026-08-27', TODAY), 14);
  assert.equal(daysUntil('2026-08-12', TODAY), -1);
  // Across a month end, and across the DST transition a local-time implementation would fumble.
  assert.equal(daysUntil('2026-09-07', TODAY), 25);
  assert.equal(daysUntil('2026-11-05', '2026-10-29'), 7);
});

test('(1) an entry with no expiry is active', () => {
  assert.equal(classifyExpiry(undefined, TODAY), 'active');
  assert.equal(classifyExpiry(null, TODAY), 'active');
});

test('(2) 15 days out is active — one day beyond the window', () => {
  assert.equal(classifyExpiry('2026-08-28', TODAY), 'active');
});

test('(3) exactly 14 days out is expiring — the upper boundary is inclusive', () => {
  assert.equal(classifyExpiry('2026-08-27', TODAY), 'expiring');
});

test('(4) 1 day out is expiring', () => {
  assert.equal(classifyExpiry('2026-08-14', TODAY), 'expiring');
});

test('(5) expiry === today is expiring, NOT expired — an entry suppresses through its final day', () => {
  assert.equal(classifyExpiry(TODAY, TODAY), 'expiring');
});

test('(6) yesterday is expired', () => {
  assert.equal(classifyExpiry('2026-08-12', TODAY), 'expired');
});

test('(7) formatExpiring names the id, the date, the days remaining and who added it', () => {
  const out = formatExpiring(
    [{ id: 'GHSA-7p8r-x3mc-p8w7', addedBy: 'steve', expiry: '2026-08-23', scanner: 'pnpm-audit' }],
    TODAY,
  );
  assert.match(out, /GHSA-7p8r-x3mc-p8w7/);
  assert.match(out, /2026-08-23/);
  assert.match(out, /\b10\b/, 'the day count must appear, not just the date');
  assert.match(out, /steve/);
});

test('(8) formatExpired states the finding WAS suppressed until the date, and by whom', () => {
  const out = formatExpired({ id: 'GHSA-xxxx', addedBy: 'steve', expiry: '2026-08-01', scanner: 'pnpm-audit' });
  assert.match(out, /GHSA-xxxx/);
  assert.match(out, /suppressed until/i, 'the point of this line is that the failure explains itself');
  assert.match(out, /2026-08-01/);
  assert.match(out, /steve/);
});

test('formatUnmatched names the entry, who added it, and that it matched nothing', () => {
  const out = formatUnmatched([{ id: 'GHSA-yyyy', addedBy: 'steve', scanner: 'pip-audit' }]);
  assert.match(out, /GHSA-yyyy/);
  assert.match(out, /steve/);
  assert.match(out, /matched nothing|suppressed nothing/i);
});

// The wording carries a THIRD explanation. It used to offer exactly two — "remediated already, or
// the scanner changed identifier namespace" — and a rule that had gone BLIND read as the first of
// them: in MCM, `gha-curl-pipe-shell` produced 36 parse errors and 0 findings while the code it was
// written to find sat in six workflow files. Two explanations stated as exhaustive is how every
// future unmatched entry gets misread the same way.
test('formatUnmatched does not present its explanations as exhaustive', () => {
  const out = formatUnmatched([{ id: 'GHSA-yyyy', addedBy: 'steve', scanner: 'pip-audit' }]);
  assert.match(out, /could not run|blind|unable to run/i,
    'the possibility that the rule could not RUN must be offered alongside remediation and namespace change');
});

// Shape-agnostic on purpose: this module knows nothing about Semgrep. The SAST gate supplies the
// per-entry detail (which rule, how many errors) because it is the side holding the scan report.
test('formatUnmatched appends a caller-supplied annotation to the entry that has one', () => {
  const entries = [
    { key: 'a', id: 'rule.blind', addedBy: 'steve', scanner: 'semgrep' },
    { key: 'b', id: 'GHSA-yyyy', addedBy: 'steve', scanner: 'pip-audit' },
  ];
  const out = formatUnmatched(entries, (e) => (e.id === 'rule.blind' ? 'BLINDED: 36 errors' : null));
  const lines = out.split('\n');
  assert.equal(lines.length, 3, 'the annotated entry contributes a second line; the other does not');
  assert.match(lines[0], /rule\.blind/);
  assert.match(lines[1], /BLINDED: 36 errors/);
  assert.match(lines[2], /GHSA-yyyy/);
  assert.doesNotMatch(lines[2], /BLINDED/);
});

test('formatUnmatched is unchanged when no annotator is supplied', () => {
  const entries = [{ key: 'a', id: 'GHSA-yyyy', addedBy: 'steve', scanner: 'pnpm-audit' }];
  assert.equal(formatUnmatched(entries), formatUnmatched(entries, () => null));
});

// --- unmatched selection: the scanner-produced-findings guard ------------------------------------

const ENTRY = (over) => ({ key: 'k1', id: 'GHSA-yyyy', addedBy: 'steve', expiry: undefined, scanner: 'pnpm-audit', ...over });

test('(9) an unmatched entry IS reported when its scanner produced findings', () => {
  const out = selectUnmatched([ENTRY()], new Set(), new Set(['pnpm-audit']));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'GHSA-yyyy');
});

test('(10) an unmatched entry is NOT reported when its scanner produced no findings', () => {
  // A skipped, failed, not-enabled or genuinely clean scanner must never flag its whole entry set —
  // otherwise the check goes red saying "stale entry" when the truth is "the scanner did not run".
  const out = selectUnmatched([ENTRY()], new Set(), new Set(['semgrep']));
  assert.deepEqual(out, []);
  assert.deepEqual(selectUnmatched([ENTRY()], new Set(), new Set()), []);
});

test('(11) a matched entry is never reported, regardless of scanner activity', () => {
  assert.deepEqual(selectUnmatched([ENTRY()], new Set(['k1']), new Set(['pnpm-audit'])), []);
  assert.deepEqual(selectUnmatched([ENTRY()], new Set(['k1']), new Set()), []);
});

test('matching is by unique key, not by advisory id — an allowlist can reuse an id across targets', () => {
  // One advisory id can legitimately carry two entries (two locations, two targets). Keying on the
  // id alone would let one entry's match silently cover the other's staleness.
  const shared = [ENTRY({ key: 'target-a', id: 'CVE-2025-68121' }), ENTRY({ key: 'target-b', id: 'CVE-2025-68121' })];
  const out = selectUnmatched(shared, new Set(['target-a']), new Set(['pnpm-audit']));
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'target-b');
});

test('an expiring entry can also be unmatched — the two properties are orthogonal', () => {
  const entry = ENTRY({ expiry: '2026-08-20' });
  assert.equal(classifyExpiry(entry.expiry, TODAY), 'expiring');
  assert.equal(selectUnmatched([entry], new Set(), new Set(['pnpm-audit'])).length, 1);
});

// --- scope: the second-consumer guard -------------------------------------------------------------
//
// Scanner identity stops being able to separate two runs the moment a SECOND job consults the same
// allowlist over a narrower target set (measured in MCM: a single-image run reported 16 of the other
// run's LIVE entries as "suppressed nothing", the precise opposite of what UNMATCHED is for).
//
// `inScope` is the caller's answer to "was this entry's target even looked at this run". The module
// stays SHAPE-AGNOSTIC. BELAY's SAST gate has one consumer and supplies no flag.

test('(12) an out-of-scope entry is neither matched nor unmatched — it is silent', () => {
  const out = selectUnmatched([ENTRY({ inScope: false })], new Set(), new Set(['pnpm-audit']));
  assert.deepEqual(out, []);
});

test('(13) an in-scope entry that suppressed nothing is STILL reported', () => {
  // The behaviour this check was built for is not traded away to fix the scoping.
  const out = selectUnmatched([ENTRY({ inScope: true })], new Set(), new Set(['pnpm-audit']));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'GHSA-yyyy');
});

test('(14) an entry with no inScope flag is in scope — the SAST gate is unchanged', () => {
  // check-sast-findings.mjs has one allowlist and one consumer, so it supplies no flag. Defaulting
  // absent to IN scope keeps that gate unchanged; only an explicit `false` suppresses.
  assert.equal(selectUnmatched([ENTRY()], new Set(), new Set(['pnpm-audit'])).length, 1);
  assert.equal(selectUnmatched([ENTRY({ inScope: undefined })], new Set(), new Set(['pnpm-audit'])).length, 1);
});

test('(15) scope and scanner-activity are independent guards — either one alone silences', () => {
  // Both conditions must hold to report. Asserted together so a later edit cannot collapse them into
  // one and keep the suite green.
  assert.deepEqual(selectUnmatched([ENTRY({ inScope: false })], new Set(), new Set()), []);
  assert.deepEqual(selectUnmatched([ENTRY({ inScope: true })], new Set(), new Set()), []);
  assert.deepEqual(selectUnmatched([ENTRY({ inScope: false })], new Set(['k1']), new Set(['pnpm-audit'])), []);
});
