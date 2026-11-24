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
import { globSync } from 'node:fs';
import { matchesGlob } from 'node:path';
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

// ── not yet implemented (their tests come first: T011, T015) ────────────────────────────────────

export function coverageSelftest() {
  throw new Error('not implemented');
}

if (isMain(import.meta.url)) {
  console.error('[coverage] not implemented');
  process.exitCode = 1;
}

export { WARNING_WINDOW_DAYS };
