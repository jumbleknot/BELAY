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

// ── --run, end to end ───────────────────────────────────────────────────────────────────────────
// Each case builds a tiny project in a temp dir, laid out like this repository (scripts/*.mjs,
// scripts/__tests__/*.test.mjs, scripts/coverage-policy.yaml), and starts the REAL CLI in it. The
// CLI starts a real `node --test`, with no mocks of the runner. This test itself runs under the outer
// suite's coverage, which is exactly the nesting research R10 measured: --run must strip
// NODE_TEST_CONTEXT, or the inner run writes no report.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-coverage.mjs');

const FULL = 'export function full(x) {\n  if (x) {\n    return 1;\n  }\n  return 2;\n}\n';
const PARTIAL = 'export function partial(x) {\n  if (x === 1) {\n    return "one";\n  }\n  const a = x * 2;\n  const b = a + 1;\n  const c = b * 3;\n  const d = c - 4;\n  return String(d);\n}\n';
const POLICY_YAML = 'version: 1\nfloor: 70\ninclude:\n  - "scripts/*.mjs"\nexceptions: []\n';

function project({ files, policy = POLICY_YAML }) {
  const root = mkdtempSync(join(tmpdir(), 'belay-coverage-run-'));
  mkdirSync(join(root, 'scripts', '__tests__'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'coverage-policy.yaml'), policy);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const cli = (root, args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  return { status: r.status, out, last: out.trim().split('\n').at(-1) };
};

const fullTest = 'import { test } from "node:test";\nimport { full } from "../full.mjs";\ntest("full", () => { full(true); full(false); });\n';
const partialTest = 'import { test } from "node:test";\nimport { partial } from "../partial.mjs";\ntest("partial", () => { partial(1); });\n';

test('--run: a module below the floor exits 1, naming it, with the ❌ summary as the LAST line', () => {
  const root = project({ files: {
    'scripts/full.mjs': FULL, 'scripts/partial.mjs': PARTIAL,
    'scripts/__tests__/full.test.mjs': fullTest, 'scripts/__tests__/partial.test.mjs': partialTest,
  } });
  try {
    const r = cli(root, ['--run']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /✗ scripts\/partial\.mjs — \d+\.\d\d% lines, floor 70%/);
    assert.match(r.last, /\[coverage\] ❌ 1 of 2 modules below the floor/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--run: a passing project exits 0 with ✅ last, and deletes a stale report first', () => {
  const root = project({ files: { 'scripts/full.mjs': FULL, 'scripts/__tests__/full.test.mjs': fullTest } });
  try {
    mkdirSync(join(root, 'coverage'));
    // A stale report claiming a module that no longer exists: judged on it, the run would fail.
    writeFileSync(join(root, 'coverage', 'scripts.lcov'), 'SF:scripts/gone.mjs\nLF:10\nLH:0\nend_of_record\n');
    const r = cli(root, ['--run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.last, /\[coverage\] ✅ 1 modules ≥ 70% lines; total 100\.00% lines/);
    assert.doesNotMatch(r.out, /gone\.mjs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--run: a failing test exits with the runner\'s non-zero code, and still prints the verdict', () => {
  const failing = 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { full } from "../full.mjs";\ntest("full", () => { full(true); full(false); assert.fail("boom"); });\n';
  const root = project({ files: { 'scripts/full.mjs': FULL, 'scripts/__tests__/full.test.mjs': failing } });
  try {
    const r = cli(root, ['--run']);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /\[coverage\] /);
    assert.match(r.out, /tests failed: the coverage verdict above is for information only/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--run: a module whose only test is skipped fails as below the floor — a skip is not an exemption', () => {
  const skipped = 'import { test } from "node:test";\nimport { partial } from "../partial.mjs";\ntest.skip("partial", () => { partial(1); partial(2); });\n';
  const root = project({ files: {
    'scripts/full.mjs': FULL, 'scripts/partial.mjs': PARTIAL,
    'scripts/__tests__/full.test.mjs': fullTest, 'scripts/__tests__/partial.test.mjs': skipped,
  } });
  try {
    const r = cli(root, ['--run']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /✗ scripts\/partial\.mjs — /);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--run: a source module no test loads fails as no coverage data', () => {
  const root = project({ files: {
    'scripts/full.mjs': FULL, 'scripts/unloaded.mjs': FULL, 'scripts/__tests__/full.test.mjs': fullTest,
  } });
  try {
    const r = cli(root, ['--run']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /✗ scripts\/unloaded\.mjs — no coverage data/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--run: when the tests load nothing in include, the run fails closed', () => {
  const lonely = 'import { test } from "node:test";\ntest("nothing", () => {});\n';
  const root = project({ files: { 'scripts/full.mjs': FULL, 'scripts/__tests__/lonely.test.mjs': lonely } });
  try {
    const r = cli(root, ['--run']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /no record for any source module|report .*(missing|empty)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the gate alone: --report <missing file> exits 1 naming it; an unknown flag exits 2', () => {
  const root = project({ files: { 'scripts/full.mjs': FULL } });
  try {
    const missing = cli(root, ['--report', 'coverage/nope.lcov']);
    assert.equal(missing.status, 1, missing.out);
    assert.match(missing.out, /coverage report coverage\/nope\.lcov is missing/);
    const unknown = cli(root, ['--frobnicate']);
    assert.equal(unknown.status, 2, unknown.out);
    assert.match(unknown.out, /unknown argument --frobnicate/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an invalid policy exits 2 before anything runs', () => {
  const root = project({ files: { 'scripts/full.mjs': FULL, 'scripts/__tests__/full.test.mjs': fullTest }, policy: 'version: 1\nfloor: 40\ninclude: ["scripts/*.mjs"]\n' });
  try {
    const r = cli(root, ['--run']);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /invalid coverage policy: floor/);
    assert.equal(existsSync(join(root, 'coverage', 'scripts.lcov')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── --selftest ──────────────────────────────────────────────────────────────────────────────────
// Each broken judge wraps the real one and switches off exactly ONE rule, so each test proves the
// selftest notices that rule going missing.
import { coverageSelftest } from '../check-coverage.mjs';

const recompute = (v) => ({ ...v, ok: v.failures.length === 0 && v.modules.every((m) => m.status === 'ok') });

const neverBelowFloor = (args) => {
  const v = judgeCoverage(args);
  return recompute({ ...v, modules: v.modules.map((m) => (m.status === 'below-floor' ? { ...m, status: 'ok' } : m)) });
};
const ignoresMissing = (args) => {
  const v = judgeCoverage(args);
  return recompute({ ...v, modules: v.modules.filter((m) => m.status !== 'no-coverage-data') });
};
const ignoresTotal = (args) => {
  const v = judgeCoverage(args);
  return recompute({ ...v, failures: v.failures.filter((f) => !f.startsWith('total ')) });
};
const passesEmpty = (args) => {
  const v = judgeCoverage(args);
  return recompute({ ...v, failures: v.failures.filter((f) => !f.includes('no record for any source module')) });
};

test('selftest: the real gate passes its own selftest, and the CLI says so', () => {
  assert.deepEqual(coverageSelftest().failures, []);
  const r = spawnSync(process.execPath, [CLI, '--selftest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ check-coverage --selftest passed/);
});

test('selftest: a judge that never reports below-floor is caught', () => {
  const { failures } = coverageSelftest({ judgeCoverage: neverBelowFloor });
  assert.ok(failures.some((f) => /below the floor/.test(f)), failures.join('\n'));
});

test('selftest: a judge that ignores missing modules is caught (no coverage data)', () => {
  const { failures } = coverageSelftest({ judgeCoverage: ignoresMissing });
  assert.ok(failures.some((f) => /no coverage data/.test(f)), failures.join('\n'));
});

test('selftest: a judge that ignores the total is caught', () => {
  const { failures } = coverageSelftest({ judgeCoverage: ignoresTotal });
  assert.ok(failures.some((f) => /total/.test(f)), failures.join('\n'));
});

test('selftest: a judge that passes an empty report is caught (fail closed)', () => {
  const { failures } = coverageSelftest({ judgeCoverage: passesEmpty });
  assert.ok(failures.some((f) => /fail closed|empty report/.test(f)), failures.join('\n'));
});

test('selftest: a policy validator that accepts anything is caught', () => {
  const { failures } = coverageSelftest({ validatePolicy: (raw) => raw });
  assert.ok(failures.some((f) => /exception floor below 50|missing module/.test(f)), failures.join('\n'));
});

test('the gate alone: --report takes an ABSOLUTE path as given, and a truncated report fails closed', () => {
  const root = project({ files: { 'scripts/full.mjs': FULL } });
  const elsewhere = mkdtempSync(join(tmpdir(), 'belay-coverage-report-'));
  try {
    const abs = join(elsewhere, 'cut.lcov');
    writeFileSync(abs, 'SF:scripts/full.mjs\nLF:5\nLH:');          // cut off mid-record
    const r = cli(root, ['--report', abs]);
    assert.equal(r.status, 1, r.out);
    assert.doesNotMatch(r.out, /is missing/);
    assert.match(r.out, /malformed lcov record for scripts\/full\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

// ── --policy <file> (feature 014, research R16) ─────────────────────────────────────────────────
// Another Nx project (pdlc) keeps its own policy inside its own root, and gates its own report with
// it. The default, scripts/coverage-policy.yaml, must be unchanged when the flag is absent.

const OTHER_POLICY_YAML = 'version: 1\nfloor: 90\ninclude:\n  - "tools/x/src/*.mjs"\nexceptions: []\n';

test('policy: --policy <file> outside scripts/ sets the floor and the module glob', () => {
  const root = project({ files: {
    'scripts/full.mjs': FULL,
    'tools/x/policy.yaml': OTHER_POLICY_YAML,
    'tools/x/src/a.mjs': FULL,
    'tools/x/src/b.mjs': FULL,
    'coverage/x.lcov': 'SF:tools/x/src/a.mjs\nLF:10\nLH:10\nend_of_record\nSF:tools/x/src/b.mjs\nLF:10\nLH:8\nend_of_record\n',
  } });
  try {
    const r = cli(root, ['--policy', 'tools/x/policy.yaml', '--report', 'coverage/x.lcov']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /✗ tools\/x\/src\/b\.mjs — 80\.00% lines, floor 90%/);
    assert.match(r.last, /\[coverage\] ❌ 1 of 2 modules below the floor; total 90\.00% lines \(floor 90%\)/);
    assert.doesNotMatch(r.out, /scripts\/full\.mjs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('policy: without --policy, the default scripts/coverage-policy.yaml is used, unchanged', () => {
  const root = project({ files: {
    'scripts/full.mjs': FULL,
    'tools/x/policy.yaml': OTHER_POLICY_YAML,
    'coverage/scripts.lcov': 'SF:scripts/full.mjs\nLF:10\nLH:8\nend_of_record\n',
  } });
  try {
    const r = cli(root, ['--report', 'coverage/scripts.lcov']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.last, /\[coverage\] ✅ 1 modules ≥ 70% lines; total 80\.00% lines/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('policy: an unreadable --policy file exits non-zero and names the file', () => {
  const root = project({ files: { 'scripts/full.mjs': FULL } });
  try {
    const r = cli(root, ['--policy', 'tools/nope/policy.yaml', '--report', 'coverage/x.lcov']);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /tools\/nope\/policy\.yaml/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Feature 016 (research R12): `--run --results <file>` attaches the test-result collector to scripts:test's own run.
import { buildTestArgs } from '../check-coverage.mjs';
test('016: --results adds the collector pair before the test glob; an empty --results (Nx with no argument) adds nothing', () => {
  const policy = { include: ['scripts/*.mjs'] };
  const plain = buildTestArgs({ policy, reportPath: 'coverage/scripts.lcov', results: '' });
  assert.equal(plain.at(-1), 'scripts/__tests__/*.test.mjs');
  assert.ok(!plain.some((a) => a.includes('collect-test-results')));
  const withR = buildTestArgs({ policy, reportPath: 'coverage/scripts.lcov', results: '/tmp/r/scripts-test.jsonl' });
  assert.equal(withR.at(-1), 'scripts/__tests__/*.test.mjs');
  assert.ok(withR.some((a) => /--test-reporter=.*collect-test-results\.mjs$/.test(a)));
  assert.ok(withR.includes('--test-reporter-destination=/tmp/r/scripts-test.jsonl'));
  assert.ok(withR.includes('--test-reporter=spec') && withR.includes('--test-reporter=lcov'), 'the existing reporters stay');
});
