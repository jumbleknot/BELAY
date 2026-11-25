#!/usr/bin/env node
// check-coverage.mjs: the coverage gate for the scripts Nx project (feature 009, backlog item 53).
//
// The constitution requires 70% coverage for new features, and before this nothing measured it.
// The gate runs the suite under Node's built-in coverage, writing an lcov report, then fails when a
// source module or the total is below the floor in scripts/coverage-policy.yaml.
//
// TWO TRAPS IT EXISTS TO DEFEAT (specs/009-scripts-coverage-gate/research.md, measured on Node 26):
//   - A module NO TEST LOADS is ABSENT from the report, not reported at 0% (R1). So the source list
//     comes from the FILE SYSTEM, and a source module missing from the report fails as uncovered.
//   - The built-in --test-coverage-lines checks only the TOTAL (R2), which cannot enforce a
//     per-module floor and cannot see a missing module.
//
// The verdict functions are PURE (lcov text, a policy, the module list and `today` in, a verdict
// out), so the rules are unit-tested without running anything.
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, matchesGlob, resolve } from 'node:path';
import { classifyExpiry, daysUntil, WARNING_WINDOW_DAYS } from './allowlist-expiry.mjs';
import { isMain } from './lib/is-main.mjs';

/** A usage problem (bad arguments, an invalid policy): exit 2. */
export class CoverageUsageError extends Error {
  constructor(message) { super(message); this.exitCode = 2; }
}

/** A report that cannot be trusted (missing, malformed): fail closed, exit 1. */
export class CoverageReportError extends Error {
  constructor(message) { super(message); this.exitCode = 1; }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POLICY_KEYS = new Set(['version', 'floor', 'include', 'exceptions']);
const EXCEPTION_KEYS = new Set(['module', 'floor', 'reason', 'addedBy', 'expiry']);
const MIN_FLOOR = 50;

const pct = (n) => `${n.toFixed(2)}%`;
const blank = (s) => typeof s !== 'string' || s.trim() === '';

// ── lcov ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Parse lcov text into Map<path, {linesFound, linesHit, branchesFound, branchesHit}>.
 * Anything malformed THROWS: a record we cannot read must never be read as zero or as passing.
 */
export function parseLcov(text) {
  const records = new Map();
  let current = null;
  let path = null;
  const num = (key, value) => {
    if (!/^\d+$/.test(value)) throw new CoverageReportError(`malformed lcov record for ${path}: ${key} is "${value}", not a count`);
    return Number(value);
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('SF:')) {
      path = line.slice(3).replace(/\\/g, '/');
      current = { linesFound: null, linesHit: null, branchesFound: 0, branchesHit: 0 };
      continue;
    }
    const sep = line.indexOf(':');
    const key = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? '' : line.slice(sep + 1);
    if (key === 'end_of_record') {
      if (!current) throw new CoverageReportError('malformed lcov: end_of_record before any SF');
      if (current.linesFound === null || current.linesHit === null) {
        throw new CoverageReportError(`malformed lcov record for ${path}: missing ${current.linesFound === null ? 'LF' : 'LH'}`);
      }
      records.set(path, current);
      current = null;
      continue;
    }
    if (!['LF', 'LH', 'BRF', 'BRH'].includes(key)) continue;   // DA, FN, BRDA…: not needed for the verdict
    if (!current) throw new CoverageReportError(`malformed lcov: ${key} before any SF`);
    if (key === 'LF') current.linesFound = num(key, value);
    else if (key === 'LH') current.linesHit = num(key, value);
    else if (key === 'BRF') current.branchesFound = num(key, value);
    else current.branchesHit = num(key, value);
  }
  if (current) throw new CoverageReportError(`malformed lcov record for ${path}: no end_of_record`);
  return records;
}

// ── policy ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Validate scripts/coverage-policy.yaml (data-model.md: Coverage policy, Exception). Throws
 * CoverageUsageError (exit 2) on anything invalid. There is never a fallback floor.
 * @param {unknown} raw the parsed YAML
 * @param {{modules: string[]}} ctx the source modules, so a stale exception is caught
 */
export function validatePolicy(raw, { modules }) {
  const bad = (msg) => { throw new CoverageUsageError(`invalid coverage policy: ${msg}`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('it must be a mapping');
  for (const k of Object.keys(raw)) if (!POLICY_KEYS.has(k)) bad(`unknown key "${k}"`);
  if (raw.version !== 1) bad(`version must be 1 (got ${JSON.stringify(raw.version)})`);
  const { floor, include } = raw;
  if (typeof floor !== 'number' || !(floor >= MIN_FLOOR && floor <= 100)) bad(`floor must be a number from ${MIN_FLOOR} to 100 (got ${JSON.stringify(floor)})`);
  if (!Array.isArray(include) || include.length === 0) bad('include must be a non-empty list of patterns');
  for (const p of include) {
    if (typeof p !== 'string' || !p.endsWith('.mjs')) bad(`include pattern ${JSON.stringify(p)} must end in .mjs`);
    if (matchesGlob('scripts/__tests__/x.mjs', p) || p.includes('__tests__')) bad(`include pattern "${p}" matches scripts/__tests__/: tests are never source`);
  }
  const exceptions = raw.exceptions ?? [];
  if (!Array.isArray(exceptions)) bad('exceptions must be a list');
  const known = new Set(modules);
  const seen = new Set();
  for (const e of exceptions) {
    const who = e?.module ?? '(no module)';
    if (!e || typeof e !== 'object') bad('an exception must be a mapping');
    for (const k of Object.keys(e)) if (!EXCEPTION_KEYS.has(k)) bad(`exception for ${who}: unknown key "${k}"`);
    if (blank(e.module)) bad('an exception has no module');
    if (!include.some((p) => matchesGlob(e.module, p))) bad(`exception for ${e.module}: the module is outside include`);
    if (!known.has(e.module)) bad(`exception for ${e.module}: no such module (a stale entry; delete it)`);
    if (seen.has(e.module)) bad(`exception for ${e.module}: listed twice`);
    seen.add(e.module);
    if (typeof e.floor !== 'number' || e.floor < MIN_FLOOR || e.floor >= floor) {
      bad(`exception for ${e.module}: floor must be at least ${MIN_FLOOR} and below the policy floor of ${floor} (got ${JSON.stringify(e.floor)})`);
    }
    if (blank(e.reason)) bad(`exception for ${e.module}: reason is required`);
    if (blank(e.addedBy)) bad(`exception for ${e.module}: addedBy is required`);
    // classifyExpiry treats a missing or unparseable date as `active`, so a typo would make a
    // PERMANENT exception. The date is therefore required and checked here.
    if (typeof e.expiry !== 'string' || !ISO_DATE.test(e.expiry)) bad(`exception for ${e.module}: expiry must be a YYYY-MM-DD date (got ${JSON.stringify(e.expiry)})`);
  }
  return { version: 1, floor, include: [...include], exceptions: exceptions.map((e) => ({ ...e })) };
}

/** Every source module the include patterns match ON DISK (not git: an untracked new script counts), sorted. */
export function listSourceModules(include, root = process.cwd()) {
  const found = new Set();
  for (const p of include) for (const f of globSync(p, { cwd: root })) found.add(f.replace(/\\/g, '/'));
  return [...found].filter((f) => !f.includes('__tests__')).sort();
}

// ── the verdict ─────────────────────────────────────────────────────────────────────────────────

/**
 * Judge a report against the policy (data-model.md: Module result, Verdict).
 * @returns {{ok: boolean, floor: number, modules: object[], total: object, failures: string[], warnings: string[]}}
 */
export function judgeCoverage({ records, modules, policy, today }) {
  const failures = [];
  const warnings = [];
  const inScope = new Map([...records].filter(([path]) => policy.include.some((p) => matchesGlob(path, p))));
  if (inScope.size === 0) failures.push('the report has no record for any source module: nothing was measured, so nothing passes');

  const exceptionFor = new Map();
  for (const e of policy.exceptions) {
    const state = classifyExpiry(e.expiry, today);
    if (state === 'expired') {
      warnings.push(`exception for ${e.module} expired ${e.expiry} and no longer applies: judged at the policy floor of ${policy.floor}%`);
      continue;
    }
    if (state === 'expiring') warnings.push(`exception for ${e.module} expires ${e.expiry} (${daysUntil(e.expiry, today)} days)`);
    exceptionFor.set(e.module, e);
  }

  const results = modules.map((module) => {
    const rec = inScope.get(module);
    const appliedFloor = exceptionFor.get(module)?.floor ?? policy.floor;
    if (!rec) {
      return { module, linesFound: null, linesHit: null, branchesFound: null, branchesHit: null, percent: null, appliedFloor, status: 'no-coverage-data' };
    }
    const percent = rec.linesFound === 0 ? 100 : (100 * rec.linesHit) / rec.linesFound;
    return { module, ...rec, percent, appliedFloor, status: percent < appliedFloor ? 'below-floor' : 'ok' };
  });

  const measured = results.filter((r) => r.linesFound !== null);
  const sum = (k) => measured.reduce((n, r) => n + r[k], 0);
  const linesFound = sum('linesFound');
  const linesHit = sum('linesHit');
  const branchesFound = sum('branchesFound');
  const branchesHit = sum('branchesHit');
  const total = {
    linesFound, linesHit, branchesFound, branchesHit,
    percent: linesFound === 0 ? 100 : (100 * linesHit) / linesFound,
    branchPercent: branchesFound === 0 ? 100 : (100 * branchesHit) / branchesFound,
  };
  // Only exceptions can push the total below the floor while every module meets its own floor:
  // a line-weighted total of modules all at or above the floor is itself at or above it.
  if (measured.length > 0 && total.percent < policy.floor) {
    failures.push(`total ${pct(total.percent)} lines is below the floor of ${policy.floor}%: exceptions may not add up to a project below the rule`);
  }
  const ok = failures.length === 0 && results.every((r) => r.status === 'ok');
  return { ok, floor: policy.floor, modules: results, total, failures, warnings };
}

/** The verdict as output lines. The SUMMARY IS LAST, so the CI digest's tail is the verdict (research R8). */
export function formatVerdict(v) {
  const lines = v.warnings.map((w) => `[coverage] ⚠ ${w}`);
  const failing = v.modules.filter((m) => m.status !== 'ok')
    .sort((a, b) => (a.percent ?? -1) - (b.percent ?? -1) || a.module.localeCompare(b.module));
  for (const m of failing) {
    lines.push(m.status === 'no-coverage-data'
      ? `[coverage] ✗ ${m.module} — no coverage data (no test loads it; a module no test loads is uncovered, not skipped)`
      : `[coverage] ✗ ${m.module} — ${pct(m.percent)} lines, floor ${m.appliedFloor}%`);
  }
  for (const f of v.failures) lines.push(`[coverage] ✗ ${f}`);
  const total = `total ${pct(v.total.percent)} lines`;
  if (v.ok) {
    const lowest = [...v.modules].sort((a, b) => a.percent - b.percent || a.module.localeCompare(b.module))[0];
    lines.push(`[coverage] ✅ ${v.modules.length} modules ≥ ${v.floor}% lines; ${total} (${pct(v.total.branchPercent)} branches, not gated); lowest: ${lowest.module} ${pct(lowest.percent)}`);
  } else {
    lines.push(`[coverage] ❌ ${failing.length} of ${v.modules.length} modules below the floor; ${total} (floor ${v.floor}%). Add tests, or delete code nobody needs. Never lower the floor to pass`);
  }
  return lines;
}

// ── --selftest ──────────────────────────────────────────────────────────────────────────────────
// Judges synthetic reports against a synthetic policy, with no test run, before CI trusts a real
// measurement. A gate that has silently stopped failing anything would otherwise read as a pass.
// `deps` lets the tests break one stage and watch the selftest name it.

const ST_TODAY = '2026-11-24';
const ST_POLICY = { version: 1, floor: 70, include: ['scripts/*.mjs'], exceptions: [] };
const ST_EXCEPTION = { module: 'scripts/thin.mjs', floor: 55, reason: 'selftest', addedBy: 'selftest', expiry: '2027-06-30' };
const stRec = (path, found, hit) => `SF:${path}\nLF:${found}\nLH:${hit}\nend_of_record\n`;

export function coverageSelftest(deps = {}) {
  const d = { parseLcov, validatePolicy, judgeCoverage, ...deps };
  const failures = [];
  const judgeOf = (lcov, modules, policy = ST_POLICY) =>
    d.judgeCoverage({ records: d.parseLcov(lcov), modules, policy: d.validatePolicy(policy, { modules }), today: ST_TODAY });
  const expect = (name, lcov, modules, policy, check) => {
    try {
      const v = judgeOf(lcov, modules, policy);
      const problem = check(v);
      if (problem) failures.push(`${name}: ${problem}`);
    } catch (e) {
      failures.push(`${name}: threw ${e.message}`);
    }
  };
  const expectRefused = (name, policy, modules) => {
    try {
      d.validatePolicy(policy, { modules });
      failures.push(`${name}: the policy was accepted, expected a refusal (exit 2)`);
    } catch (e) {
      if (e.exitCode !== 2) failures.push(`${name}: refused with exit ${e.exitCode}, expected 2`);
    }
  };
  const statusOf = (v, module) => v.modules.find((m) => m.module === module)?.status;

  expect('a passing report', stRec('scripts/a.mjs', 10, 8), ['scripts/a.mjs'], ST_POLICY,
    (v) => (v.ok ? null : 'judged as failing'));
  expect('a module below the floor', stRec('scripts/a.mjs', 10, 6) + stRec('scripts/b.mjs', 10, 10), ['scripts/a.mjs', 'scripts/b.mjs'], ST_POLICY,
    (v) => (!v.ok && statusOf(v, 'scripts/a.mjs') === 'below-floor' ? null : 'a module below the floor passed'));
  expect('a source module missing from the report', stRec('scripts/a.mjs', 10, 10), ['scripts/a.mjs', 'scripts/new.mjs'], ST_POLICY,
    (v) => (!v.ok && statusOf(v, 'scripts/new.mjs') === 'no-coverage-data' ? null : 'a module with no coverage data passed'));
  expect('a total below the floor through an exception', stRec('scripts/thin.mjs', 100, 56) + stRec('scripts/a.mjs', 10, 10),
    ['scripts/thin.mjs', 'scripts/a.mjs'], { ...ST_POLICY, exceptions: [ST_EXCEPTION] },
    (v) => (!v.ok && v.failures.some((f) => f.startsWith('total ')) ? null : 'a total below the floor passed'));
  expect('an empty report', '', ['scripts/a.mjs'], ST_POLICY,
    (v) => (!v.ok && v.failures.length > 0 ? null : 'an empty report passed (it must fail closed)'));
  expect('an active exception', stRec('scripts/thin.mjs', 10, 6) + stRec('scripts/a.mjs', 90, 90),
    ['scripts/thin.mjs', 'scripts/a.mjs'], { ...ST_POLICY, exceptions: [ST_EXCEPTION] },
    (v) => (v.ok ? null : 'a module at its exception floor failed'));
  expect('an expired exception', stRec('scripts/thin.mjs', 10, 6) + stRec('scripts/a.mjs', 90, 90),
    ['scripts/thin.mjs', 'scripts/a.mjs'], { ...ST_POLICY, exceptions: [{ ...ST_EXCEPTION, expiry: '2026-11-01' }] },
    (v) => (!v.ok && statusOf(v, 'scripts/thin.mjs') === 'below-floor' ? null : 'an expired exception still applied'));
  expect('a record outside the include set', stRec('scripts/a.mjs', 10, 10) + stRec('scripts/__tests__/a.test.mjs', 100, 0),
    ['scripts/a.mjs'], ST_POLICY,
    (v) => (v.ok ? null : 'a test-file record was judged'));
  expectRefused('an exception floor below 50', { ...ST_POLICY, exceptions: [{ ...ST_EXCEPTION, floor: 40 }] }, ['scripts/thin.mjs']);
  expectRefused('an exception for a missing module', { ...ST_POLICY, exceptions: [ST_EXCEPTION] }, ['scripts/a.mjs']);
  return { failures };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

export const POLICY_PATH = 'scripts/coverage-policy.yaml';
export const REPORT_PATH = 'coverage/scripts.lcov';
const TEST_GLOB = 'scripts/__tests__/*.test.mjs';
const USAGE = `Usage: check-coverage.mjs --run | [--policy <file>] [--report <lcov>] | --selftest | --help
  --run              delete the report, run ${TEST_GLOB} under coverage, then gate (scripts:test)
  --report <lcov>    gate an existing report only (default ${REPORT_PATH})
  --policy <file>    judge with this policy instead of ${POLICY_PATH}, for another Nx project that runs
                     its own tests under coverage (pdlc:test uses mcp-servers/pdlc/coverage-policy.yaml)
  --selftest         judge synthetic reports; no test run (scripts:lint)
Exit: 0 pass · 1 below the floor, no data, or a missing/malformed report · 2 bad arguments or policy
      · under --run, the test runner's own code when tests failed`;

// Research R10 (measured): a child that inherits NODE_TEST_CONTEXT behaves as a WORKER of an outer
// test runner, never runs its own reporters, writes NO report, and exits 0: a silent false green.
// So these are always removed, wherever --run is started from (Nx, a shell, or a test).
const INHERITED_TEST_RUNNER_VARS = ['NODE_TEST_CONTEXT', 'NODE_TEST_WORKER_ID', 'NODE_V8_COVERAGE'];

function parseArgs(argv) {
  const args = { run: false, selftest: false, help: false, report: REPORT_PATH, policy: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') args.run = true;
    else if (a === '--selftest') args.selftest = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--report') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new CoverageUsageError(`--report needs a path\n${USAGE}`);
      args.report = v;
    } else if (a === '--policy') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new CoverageUsageError(`--policy needs a path\n${USAGE}`);
      args.policy = v;
    } else throw new CoverageUsageError(`unknown argument ${a}\n${USAGE}`);
  }
  if (args.run && args.selftest) throw new CoverageUsageError(`--run and --selftest are separate modes\n${USAGE}`);
  // --run runs THIS project's suite (${TEST_GLOB}); judging it against another project's policy
  // would measure one module set and judge another.
  if (args.run && args.policy) throw new CoverageUsageError(`--policy gates an existing --report; it cannot be combined with --run\n${USAGE}`);
  return args;
}

async function loadPolicy(root, policyPath = POLICY_PATH) {
  const { parse } = await import('yaml');
  const path = resolve(root, policyPath);
  if (!existsSync(path)) throw new CoverageUsageError(`invalid coverage policy: ${policyPath} is missing`);
  let raw;
  try { raw = parse(readFileSync(path, 'utf8')); } catch (e) { throw new CoverageUsageError(`invalid coverage policy: ${policyPath} is not readable YAML (${e.message})`); }
  const modules = listSourceModules(Array.isArray(raw?.include) ? raw.include.filter((p) => typeof p === 'string') : [], root);
  return { policy: validatePolicy(raw, { modules }), modules };
}

function gate({ root, reportPath, policy, modules, today }) {
  // resolve, not join: an absolute --report path is used as given (found by quickstart §2).
  const full = resolve(root, reportPath);
  if (!existsSync(full)) throw new CoverageReportError(`coverage report ${reportPath} is missing: nothing was measured, so nothing passes`);
  const text = readFileSync(full, 'utf8');
  const verdict = judgeCoverage({ records: parseLcov(text), modules, policy, today });
  for (const line of formatVerdict(verdict)) console.log(line);
  return verdict.ok ? 0 : 1;
}

function runTests({ root, policy, reportPath }) {
  rmSync(join(root, reportPath), { force: true });
  mkdirSync(dirname(join(root, reportPath)), { recursive: true });
  const env = { ...process.env };
  for (const k of INHERITED_TEST_RUNNER_VARS) delete env[k];
  const args = [
    '--test', '--experimental-test-coverage',
    ...policy.include.map((p) => `--test-coverage-include=${p}`),
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=lcov', `--test-reporter-destination=${reportPath}`,
    TEST_GLOB,
  ];
  const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

export async function main(argv, { root = process.cwd(), today = new Date().toISOString().slice(0, 10) } = {}) {
  try {
    const args = parseArgs(argv);
    if (args.help) { console.log(USAGE); return 0; }
    if (args.selftest) {
      const { failures } = coverageSelftest();
      for (const f of failures) console.error(`✗ check-coverage --selftest: ${f}`);
      if (failures.length) return 1;
      console.log('✓ check-coverage --selftest passed (pass, below floor, no coverage data, total below floor through an exception, empty report fails closed, active and expired exceptions, out-of-scope record ignored, exception floor below 50 and stale exception refused)');
      return 0;
    }
    const { policy, modules } = await loadPolicy(root, args.policy ?? POLICY_PATH);
    if (!args.run) return gate({ root, reportPath: args.report, policy, modules, today });
    const testStatus = runTests({ root, policy, reportPath: REPORT_PATH });
    let gateStatus;
    try {
      gateStatus = gate({ root, reportPath: REPORT_PATH, policy, modules, today });
    } catch (e) {
      if (!(e instanceof CoverageReportError)) throw e;
      console.log(`[coverage] ✗ ${e.message}`);
      gateStatus = e.exitCode;
    }
    if (testStatus !== 0) {
      // A failing test is never masked by a passing gate, nor the reverse.
      console.log(`[coverage] ❌ tests failed: the coverage verdict above is for information only (test runner exit ${testStatus})`);
      return testStatus;
    }
    return gateStatus;
  } catch (e) {
    if (e instanceof CoverageUsageError || e instanceof CoverageReportError) {
      console.error(`[coverage] ${e.exitCode === 2 ? '' : '✗ '}${e.message}`);
      return e.exitCode;
    }
    throw e;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));

export { WARNING_WINDOW_DAYS };
