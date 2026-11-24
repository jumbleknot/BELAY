// check-coverage.mjs: the coverage gate for the scripts project (feature 009, backlog item 53).
// The verdict rules are pure: lcov text, a policy, the source-module list and `today` go in, and a
// verdict comes out. So every rule here is tested with in-memory inputs; only the `--run` tests
// start real processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLcov, validatePolicy, listSourceModules, judgeCoverage, formatVerdict,
} from '../check-coverage.mjs';

const TODAY = '2026-11-24';
const POLICY = { version: 1, floor: 70, include: ['scripts/*.mjs', 'scripts/lib/*.mjs'], exceptions: [] };

/** One lcov record. `hit` of `found` lines; branches optional. */
const rec = (path, found, hit, brf = 0, brh = 0) =>
  `SF:${path}\n${brf ? `BRF:${brf}\nBRH:${brh}\n` : ''}LF:${found}\nLH:${hit}\nend_of_record\n`;

const judge = (lcov, modules, policy = POLICY) =>
  judgeCoverage({ records: parseLcov(lcov), modules, policy: validatePolicy(policy, { modules }), today: TODAY });

// ── parseLcov ───────────────────────────────────────────────────────────────────────────────────

test('parseLcov reads lines and branches per record', () => {
  const r = parseLcov(rec('scripts/a.mjs', 10, 8, 4, 3) + rec('scripts/b.mjs', 5, 5));
  assert.deepEqual(r.get('scripts/a.mjs'), { linesFound: 10, linesHit: 8, branchesFound: 4, branchesHit: 3 });
  assert.deepEqual(r.get('scripts/b.mjs'), { linesFound: 5, linesHit: 5, branchesFound: 0, branchesHit: 0 });
});

test('a malformed record fails closed, naming the problem — never read as zero or as passing', () => {
  assert.throws(() => parseLcov('LF:10\nLH:9\nend_of_record\n'), /before any SF/);
  assert.throws(() => parseLcov('SF:scripts/a.mjs\nLF:10\nLH:lots\nend_of_record\n'), /scripts\/a\.mjs.*LH/);
  assert.throws(() => parseLcov('SF:scripts/a.mjs\nLF:10\nend_of_record\n'), /scripts\/a\.mjs.*LH/);
});

// ── judgeCoverage: the floor ────────────────────────────────────────────────────────────────────

test('every module at or above 70% passes', () => {
  const v = judge(rec('scripts/a.mjs', 10, 7) + rec('scripts/b.mjs', 10, 10), ['scripts/a.mjs', 'scripts/b.mjs']);
  assert.equal(v.ok, true);
  assert.deepEqual(v.modules.map((m) => m.status), ['ok', 'ok']);
  assert.equal(v.total.percent, 85);
});

test('one module at 69.9% fails, naming it with its percent and the floor', () => {
  const v = judge(rec('scripts/a.mjs', 1000, 699) + rec('scripts/b.mjs', 10, 10), ['scripts/a.mjs', 'scripts/b.mjs']);
  assert.equal(v.ok, false);
  const a = v.modules.find((m) => m.module === 'scripts/a.mjs');
  assert.equal(a.status, 'below-floor');
  assert.equal(a.appliedFloor, 70);
  assert.match(formatVerdict(v).join('\n'), /✗ scripts\/a\.mjs — 69\.90% lines, floor 70%/);
});

test('a source module absent from the report fails as no-coverage-data, never as passing', () => {
  const v = judge(rec('scripts/a.mjs', 10, 10), ['scripts/a.mjs', 'scripts/new-tool.mjs']);
  assert.equal(v.ok, false);
  const n = v.modules.find((m) => m.module === 'scripts/new-tool.mjs');
  assert.equal(n.status, 'no-coverage-data');
  assert.equal(n.linesFound, null);
  assert.match(formatVerdict(v).join('\n'), /✗ scripts\/new-tool\.mjs — no coverage data/);
});

test('a module with LF:0 counts as 100%', () => {
  const v = judge(rec('scripts/a.mjs', 0, 0), ['scripts/a.mjs']);
  assert.equal(v.modules[0].percent, 100);
  assert.equal(v.ok, true);
});

test('records outside the include set are ignored', () => {
  const v = judge(rec('scripts/a.mjs', 10, 10) + rec('scripts/__tests__/x.test.mjs', 100, 0) + rec('/tmp/fixture.mjs', 100, 0), ['scripts/a.mjs']);
  assert.equal(v.ok, true);
  assert.equal(v.modules.length, 1);
  assert.equal(v.total.linesFound, 10);
});

test('an empty report fails closed', () => {
  const v = judge('', ['scripts/a.mjs']);
  assert.equal(v.ok, false);
  assert.match(v.failures.join('\n'), /no record for any source module/);
});

test('a report with no record for any source module fails closed', () => {
  const v = judge(rec('/tmp/elsewhere.mjs', 10, 10), ['scripts/a.mjs']);
  assert.equal(v.ok, false);
  assert.match(v.failures.join('\n'), /no record for any source module/);
});

// ── judgeCoverage: exceptions and the total ─────────────────────────────────────────────────────

const exception = (over = {}) => ({
  module: 'scripts/thin.mjs', floor: 55, reason: 'runs only real scanners', addedBy: 'test', expiry: '2027-06-30', ...over,
});

test('an active exception applies its own floor', () => {
  const policy = { ...POLICY, exceptions: [exception()] };
  const v = judge(rec('scripts/thin.mjs', 10, 6) + rec('scripts/a.mjs', 90, 90), ['scripts/thin.mjs', 'scripts/a.mjs'], policy);
  const thin = v.modules.find((m) => m.module === 'scripts/thin.mjs');
  assert.equal(thin.appliedFloor, 55);
  assert.equal(thin.status, 'ok');
  assert.equal(v.ok, true);
});

test('every module meets its applied floor through an exception, but the total is below 70% — fails on the total (US1-AC4)', () => {
  const policy = { ...POLICY, exceptions: [exception()] };
  const v = judge(rec('scripts/thin.mjs', 100, 56) + rec('scripts/a.mjs', 10, 10), ['scripts/thin.mjs', 'scripts/a.mjs'], policy);
  assert.deepEqual(v.modules.map((m) => m.status), ['ok', 'ok']);
  assert.equal(v.ok, false);
  assert.match(v.failures.join('\n'), /total 60\.00% lines is below the floor of 70%/);
});

test('an expiring exception still applies, and warns', () => {
  const policy = { ...POLICY, exceptions: [exception({ expiry: '2026-12-01' })] };
  const v = judge(rec('scripts/thin.mjs', 10, 6) + rec('scripts/a.mjs', 90, 90), ['scripts/thin.mjs', 'scripts/a.mjs'], policy);
  assert.equal(v.ok, true);
  assert.match(formatVerdict(v).join('\n'), /⚠ exception for scripts\/thin\.mjs expires 2026-12-01 \(7 days\)/);
});

test('an expired exception stops applying: the module is judged at the policy floor', () => {
  const policy = { ...POLICY, exceptions: [exception({ expiry: '2026-11-01' })] };
  const v = judge(rec('scripts/thin.mjs', 10, 6) + rec('scripts/a.mjs', 90, 90), ['scripts/thin.mjs', 'scripts/a.mjs'], policy);
  const thin = v.modules.find((m) => m.module === 'scripts/thin.mjs');
  assert.equal(thin.appliedFloor, 70);
  assert.equal(thin.status, 'below-floor');
  assert.match(formatVerdict(v).join('\n'), /exception for scripts\/thin\.mjs expired 2026-11-01 and no longer applies/);
});

// ── validatePolicy ──────────────────────────────────────────────────────────────────────────────

const refuses = (policy, re, modules = ['scripts/thin.mjs']) =>
  assert.throws(() => validatePolicy(policy, { modules }), (e) => e.exitCode === 2 && re.test(e.message));

test('validatePolicy refuses a floor outside 50–100', () => {
  refuses({ ...POLICY, floor: 49 }, /floor/);
  refuses({ ...POLICY, floor: 101 }, /floor/);
  refuses({ ...POLICY, floor: '70' }, /floor/);
});

test('validatePolicy refuses an empty include, a non-.mjs pattern, and a pattern matching scripts/__tests__/', () => {
  refuses({ ...POLICY, include: [] }, /include/);
  refuses({ ...POLICY, include: ['scripts/*.js'] }, /include/);
  refuses({ ...POLICY, include: ['scripts/**/*.mjs'] }, /__tests__/);
});

test('validatePolicy refuses a bad exception: floor below 50 or not below the policy floor, blank reason or addedBy, missing or malformed expiry', () => {
  const withEx = (over) => ({ ...POLICY, exceptions: [exception(over)] });
  refuses(withEx({ floor: 49 }), /floor/);
  refuses(withEx({ floor: 70 }), /floor/);
  refuses(withEx({ reason: '  ' }), /reason/);
  refuses(withEx({ addedBy: '' }), /addedBy/);
  refuses(withEx({ expiry: undefined }), /expiry/);
  refuses(withEx({ expiry: '30/06/2027' }), /expiry/);
});

test('validatePolicy refuses an exception for a module that does not exist (a stale entry)', () => {
  refuses({ ...POLICY, exceptions: [exception({ module: 'scripts/gone.mjs' })] }, /scripts\/gone\.mjs/);
});

test('validatePolicy refuses an unknown version and unknown keys', () => {
  refuses({ ...POLICY, version: 2 }, /version/);
  refuses({ ...POLICY, flor: 70 }, /flor/);
});

// ── listSourceModules ───────────────────────────────────────────────────────────────────────────

test('listSourceModules lists the include patterns from the FILE SYSTEM, sorted, excluding tests', () => {
  const mods = listSourceModules(POLICY.include);
  assert.ok(mods.includes('scripts/check-coverage.mjs'));
  assert.ok(mods.includes('scripts/lib/is-main.mjs'));
  assert.ok(!mods.some((m) => m.includes('__tests__')));
  assert.deepEqual(mods, [...mods].sort());
});

// ── formatVerdict ───────────────────────────────────────────────────────────────────────────────

test('formatVerdict puts the summary LAST, and orders failing modules worst first (no data, then lowest)', () => {
  const v = judge(rec('scripts/a.mjs', 100, 69) + rec('scripts/b.mjs', 100, 40) + rec('scripts/c.mjs', 10, 10),
    ['scripts/a.mjs', 'scripts/b.mjs', 'scripts/c.mjs', 'scripts/d.mjs']);
  const lines = formatVerdict(v);
  const failing = lines.filter((l) => /✗ scripts\//.test(l)).map((l) => l.match(/scripts\/\w\.mjs/)[0]);
  assert.deepEqual(failing, ['scripts/d.mjs', 'scripts/b.mjs', 'scripts/a.mjs']);
  // The total (119 of 210 lines, 56.67%) is below the floor too, and is reported after the modules.
  assert.match(lines.at(-2), /✗ total 56\.67% lines is below the floor of 70%/);
  assert.match(lines.at(-1), /❌ 3 of 4 modules below the floor; total .*% lines \(floor 70%\)/);
});

test('a passing verdict prints the total, branches as not gated, and the lowest module, last', () => {
  const v = judge(rec('scripts/a.mjs', 10, 8, 4, 2) + rec('scripts/b.mjs', 10, 10), ['scripts/a.mjs', 'scripts/b.mjs']);
  assert.match(formatVerdict(v).at(-1),
    /\[coverage\] ✅ 2 modules ≥ 70% lines; total 90\.00% lines \(50\.00% branches, not gated\); lowest: scripts\/a\.mjs 80\.00%/);
});
