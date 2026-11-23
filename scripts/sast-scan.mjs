#!/usr/bin/env node
// SAST/SCA scan orchestrator (feature 006, stage 1). Ported from MovieCollectionManager (MCM)
// feature 033. Contract: specs/006-sast-stage1/contracts/sast-cli.md and data-model.md, which take
// MCM 033's orchestrator contract as their baseline.
//
// Item numbers in the comments below (#224, #426, #449, #495, #721, …) are MCM's backlog, kept
// because they carry the measurements each behaviour was learned from.
//
// Implements four keyless scanners: Semgrep (code SAST: TS/JS, Python, workflow YAML, Dockerfiles),
// cargo audit (Rust deps), pnpm audit (JS deps) and pip-audit (Python deps). Only the scanners
// security/sast/scan.yaml enables run (research R1); the rest are reported `not-enabled`, never clean.
// It normalizes their output onto one Critical/High/Medium/Low scale via
// security/sast/severity-map.yaml, derives the SCA runtime-vs-dev scope and the `blocking` flag, and
// writes a consolidated findings.json (the gate's input contract) plus SARIF, a human summary, and
// each scanner's secret-scrubbed native output to security/sast/reports/.
//
// Does NOT decide pass/fail: that is the gate's job (check-sast-findings.mjs). Fails fast (exit 1) if
// an ENABLED scanner's toolchain is missing, its advisory or rule data is unreachable, or a native
// severity is unmapped (FR-015), recording scanners[].error, rather than silently dropping a surface.
// Exits 2 on a usage error: a bad argument, or an invalid enabled-scanner list.
//
// Usage:
//   node scripts/sast-scan.mjs [--scope full|changed] [--base <ref>] [--only <scanner,...>]
//                              [--emit-allowlist] [--out <dir>]
//   node scripts/sast-scan.mjs --test-rules

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { isMain } from './lib/is-main.mjs';
// ONE retry mechanism for every network-dependent scanner (MCM items #449, #495): see below, and the
// shared module's header for why it is shared rather than copied.
import {
  isTransientScannerFailure,
  TransientScannerError,
  transientOr as classifyTransient,
  retryTransient as retryTransientShared,
} from './lib/scanner-retry.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
// The Semgrep version every scan and `--test-rules` run (FR-023). One home on purpose: a second copy
// of the version in workflow YAML is the half-bump shape MCM was bitten by three times.
export const SEMGREP_PIN = '1.185.0';
export const ALL_SCANNERS = ['semgrep', 'cargo-audit', 'pnpm-audit', 'pip-audit'];
/** The committed enabled-scanner list, repo-relative (research R1). */
export const SCAN_CONFIG = 'security/sast/scan.yaml';
/** The runbook every actionable failure points at. */
const RUNBOOK = 'docs/runbooks/sast.md';
const CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/i;
// Workflow definitions are scanned too, but ONLY under the two workflow trees (item #224). The rule
// `belay-ci-curl-pipe-shell` is scoped there, and a rule can only fire on a file `--scope changed`
// actually hands to Semgrep — so without this a pull request ADDING a `curl … | sh` to a workflow is
// gated on nothing, and the finding first appears on the post-merge full scan. Deliberately not
// `\.ya?ml$` tree-wide: that would drag compose files and this security config tree into a PR-scoped
// scan against packs written for TS/JS/Python code.
const WORKFLOW_PATH_RE = /^\.(?:forgejo|github)\/workflows\/[^/]+\.ya?ml$/i;
// Dockerfiles, for the same reason and by the same measurement (item #426). A Dockerfile has NO
// EXTENSION, so it matched neither pattern above and a pull request ADDING one was gated on nothing.
// Observed in MCM, not reasoned: a PR added a Dockerfile, its `guardrails / sast` was a real 3m30s
// run that PASSED, and the post-merge full scan on main then failed on
// `dockerfile.security.missing-user-entrypoint`. main stayed red until an accepted-risk entry landed.
// A genuinely unwanted finding would have merged just as silently.
//
// BOTH HALVES WERE MEASURED FIRST (MCM, 2026-09-12), because the warning above says not to widen
// blindly:
//   1. The rule fires under the packs ALREADY configured: `dockerfile.*` arrives with the existing
//      five, so this needed no new --config. Handing Semgrep the file was the whole gap.
//   2. Noise is nil. The five packs over MCM's eight first-party Dockerfiles produced exactly ONE
//      finding (an already-accepted one) and zero Medium/Low, so this class gates without a
//      warning tax.
//
// Matches `Dockerfile`, `Dockerfile.prod`, `toolchain.Dockerfile`: the conventional spellings. NOT a
// substring match: `.dockerignore` is a different format no dockerfile.* rule can parse, and a prose
// page about Dockerfiles is prose.
const DOCKERFILE_PATH_RE = /(?:^|\/)(?:[^/]+\.)?Dockerfile(?:\.[^/]+)?$/i;

// ── THE ENUMERATION (MCM item #426, measured there 2026-09-12) ──────────────────────────────────
//
// #224 closed workflow YAML, #426 closed Dockerfiles, and each found its class only after that class
// had already reddened `main`. Closing them one at a time, reactively, is the pattern worth breaking,
// so MCM's whole surface was enumerated once rather than waiting for the third instance.
//
// METHOD: run a `--scope full` scan (what a push gates on), then test every finding's path against
// `isScanTarget` (what a pull request can see). The criterion is the `blocking` flag, NOT raw
// severity: a Medium finding is report-only at BOTH scopes, so it cannot create a push-vs-PR gating
// asymmetry however invisible it is on a PR.
//
//   class (MCM)                 PR scope     findings   blocking
//   Dockerfile (no extension)   visible *          2          2    * after #426; was INVISIBLE
//   .ts                         visible           20         17
//   .py                         visible            1          0
//   .yml (workflow trees)       visible            2          0
//   .json (renovate.json)       INVISIBLE         19          0    renovate-missing-minimum-release-age
//   .yaml (pnpm-workspace)      INVISIBLE          3          0    pnpm-* supply-chain advisories
//
// RESULT: ZERO blocking findings sat on a file class a pull request cannot see. The two remaining
// invisible classes are RECORDED, NOT CLOSED, and the reason is measured rather than assumed: every
// finding on both was Medium, so it is report-only on a push too. Adding them to the changed set
// would import warnings onto every PR that touches them and gate nothing.
//
// THE RESIDUAL IS A SNAPSHOT, AND IS NAMED: this holds for the rules configured today. A pack update
// that raises `renovate-missing-minimum-release-age` (or any pnpm-workspace rule) to ERROR would
// reopen the gap silently — the finding would block on `main` and be invisible on the PR that caused
// it, exactly the #224/#426 shape a third time. Re-run the method above when the pack set changes.

// ── Shared spawn helper ──────────────────────────────────────────────────────
// shell:false everywhere (avoids the DEP0190 shell+args warning and its escaping pitfall). Windows
// CreateProcess resolves bare .exe tools (cargo/uvx/uv/git/where) by appending .exe; pnpm ships a
// .cmd shim that CreateProcess can't launch directly, so route it through `cmd /c` on Windows.
function run(cmd, args, opts = {}) {
  let c = cmd;
  let a = args;
  if (IS_WIN && cmd === 'pnpm') { c = 'cmd'; a = ['/c', 'pnpm', ...args]; }
  // NO_COLOR: some tools (notably `uv`) colorize even when stdout is a pipe, injecting ANSI escapes
  // that corrupt the machine-readable output we parse (e.g. pip-audit rejects the requirements file).
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...(opts.env || {}) };
  return spawnSync(c, a, { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 1 << 28, ...opts, env });
}

// ── Usage errors (exit 2) ────────────────────────────────────────────────────

/** A bad argument or an invalid enabled-scanner list: exit 2, before anything is scanned. */
export class SastUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SastUsageError';
    this.exitCode = 2;
  }
}

// ── Transient-failure retry for network-dependent scanners (MCM item #449) ───
//
// Every scanner reaches a THIRD PARTY over the network on the gate's critical path: pip-audit queries
// osv.dev, cargo-audit fetches the RustSec advisory DB, `pnpm audit` queries the npm registry's
// advisory endpoint, and Semgrep fetches its rule packs from its registry. Any of them can fail for a
// reason that has nothing to do with this repository's code.
//
// MEASURED in MCM, 2026-09-13: a REQUIRED `guardrails / sast` context went red on
//
//   [pip-audit] <python project> produced non-JSON output:
//     File ".../pip_audit/_service/osv.py", line 79, in query
//       raise ServiceError from http_error
//   pip_audit._service.interface.ServiceError
//
// The scan had otherwise completed (`scope=changed findings=16 blocking=0`, semgrep 0, cargo-audit 0).
// No security finding was involved; osv.dev answered 200 minutes later and the identical path passed on
// two other PRs the same day. One blip redded the gate for every PR open at that moment, and the only
// remedy was a re-run.
//
// FAILING CLOSED ON A SCANNER ERROR IS CORRECT AND IS NOT CHANGED HERE: a scanner that could not run
// must never report clean. What is added is a bounded retry BEFORE that verdict, and an output that
// distinguishes "the advisory service was unreachable" from "the scanner ran and found something".
//
// MCM retried the three audit scanners only. BELAY also wraps Semgrep, because this feature's spec
// names the rule registry being briefly unreachable as an edge case that is retried (spec, Edge Cases).
//
// THE MECHANISM LIVES IN scripts/lib/scanner-retry.mjs, so the next network-dependent scanner shares
// it rather than copying it: the hard part is the signature list, and a signature learned from one
// scanner's outage is the one the other needs next.
export { isTransientScannerFailure, TransientScannerError };

/** Classify a failed scanner invocation from what the scanner actually printed. */
function transientOr(message, output) {
  return classifyTransient(message, output);
}

/** `retryTransient`, with this orchestrator's name on the retry report. See the shared module. */
export function retryTransient(scanner, fn, opts = {}) {
  return retryTransientShared(scanner, fn, { logPrefix: 'sast-scan', ...opts });
}

// ── Config loaders ───────────────────────────────────────────────────────────
export function loadSeverityMap(path = resolve(REPO_ROOT, 'security/sast/severity-map.yaml')) {
  return parseYaml(readFileSync(path, 'utf8'));
}

function loadSemgrepConfigs(path = resolve(REPO_ROOT, 'security/sast/semgrep.yaml')) {
  const doc = parseYaml(readFileSync(path, 'utf8')) ?? {};
  return Array.isArray(doc.configs) ? doc.configs : [];
}

function loadSemgrepExcludes(path = resolve(REPO_ROOT, 'security/sast/.semgrepignore')) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/\/+$/, ''));
}

// ── The enabled-scanner list (security/sast/scan.yaml, research R1) ─────────
//
// All four scanners are implemented, so stage 2 (cargo-audit) and stage 3 (pip-audit) are a list
// entry plus a toolchain step, not a second port (FR-022). A scanner the list does not name never
// runs, and the report says so: `status: not-enabled`, never a clean zero.

/**
 * The scanners security/sast/scan.yaml enables, in the fixed ALL_SCANNERS order.
 * Throws SastUsageError (exit 2) on an unreadable file, an unknown or repeated name, or an empty list.
 */
export function loadEnabledScanners(path = resolve(REPO_ROOT, SCAN_CONFIG)) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new SastUsageError(`${SCAN_CONFIG}: cannot read the enabled-scanner list (${e.code ?? e.message}).`);
  }
  let doc;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new SastUsageError(`${SCAN_CONFIG}: not valid YAML — ${e.message}`);
  }
  const list = doc?.scanners ?? null;
  if (list !== null && !Array.isArray(list)) {
    throw new SastUsageError(`${SCAN_CONFIG}: \`scanners\` must be a list (got ${typeof list}).`);
  }
  if (!list || list.length === 0) {
    throw new SastUsageError(
      `${SCAN_CONFIG}: the enabled-scanner list is empty. A scan of nothing must not read as clean — ` +
      `enable at least one of: ${ALL_SCANNERS.join(', ')}.`,
    );
  }
  const unknown = list.filter((s) => !ALL_SCANNERS.includes(s));
  if (unknown.length) {
    throw new SastUsageError(
      `${SCAN_CONFIG}: unknown scanner(s) ${unknown.map(String).join(', ')} (valid: ${ALL_SCANNERS.join(', ')}).`,
    );
  }
  const repeated = list.filter((s, i) => list.indexOf(s) !== i);
  if (repeated.length) {
    throw new SastUsageError(`${SCAN_CONFIG}: scanner(s) listed more than once: ${[...new Set(repeated)].join(', ')}.`);
  }
  return ALL_SCANNERS.filter((s) => list.includes(s));
}

/**
 * The scanners this run executes. `--only` may NARROW the enabled list, never add to it: a name the
 * config does not enable is a usage error naming the config, so a local `--only cargo-audit` cannot
 * quietly produce a report the committed configuration would never produce.
 */
export function selectScanners({ enabled, only }) {
  if (!only) return [...enabled];
  const unknown = only.filter((s) => !ALL_SCANNERS.includes(s));
  if (unknown.length) {
    throw new SastUsageError(`--only: unknown scanner(s) ${unknown.join(', ')} (valid: ${ALL_SCANNERS.join(', ')}).`);
  }
  const disabled = only.filter((s) => !enabled.includes(s));
  if (disabled.length) {
    throw new SastUsageError(
      `--only: ${disabled.join(', ')} not enabled in ${SCAN_CONFIG} (enabled: ${enabled.join(', ')}). ` +
      '--only can narrow the enabled list, never add to it; enable a scanner in that file instead.',
    );
  }
  return ALL_SCANNERS.filter((s) => only.includes(s));
}

/** One scanners[] row. `ran` is kept beside `status` for the gate's MCM-shaped report contract. */
function scannerRecord(scanner, status, extra = {}) {
  return { scanner, status, ran: status === 'ran', findingCount: 0, error: null, ...extra };
}

/**
 * Run the selected scanners in the fixed order and account for EVERY known scanner.
 *
 *   ran          — ran to completion (findingCount may be 0: that is a clean result)
 *   failed       — enabled, selected, and could not run; FR-015 fail-fast stops the run here
 *   not-enabled  — not in security/sast/scan.yaml; its runner is never called, so none of its
 *                  toolchain or surface assertions run either
 *   not-selected — enabled, but narrowed out by --only
 *   not-run      — enabled and selected, but an earlier scanner failed first
 *
 * Only `ran` is a result. Every other status says the surface was NOT scanned.
 */
export function runScanners({ enabled, selected, runners, log = console.log }) {
  const scanners = [];
  const findings = [];
  const natives = {};
  let failed = null;
  for (const name of ALL_SCANNERS) {
    if (!enabled.includes(name)) { scanners.push(scannerRecord(name, 'not-enabled')); continue; }
    if (!selected.includes(name)) { scanners.push(scannerRecord(name, 'not-selected')); continue; }
    if (failed) { scanners.push(scannerRecord(name, 'not-run')); continue; }
    log(`[sast-scan] running ${name} …`);
    try {
      const res = runners[name]();
      natives[name] = res.native ?? {};
      findings.push(...res.findings);
      scanners.push(scannerRecord(name, 'ran', { findingCount: res.findings.length, ...(res.meta ?? {}) }));
    } catch (e) {
      // FAIL-FAST (FR-015): record the error in the report, then stop with a non-zero exit.
      scanners.push(scannerRecord(name, 'failed', { error: String(e.message) }));
      failed = e;
    }
  }
  return { scanners, findings, natives, failed };
}

// ── Pure normalization primitives (unit-tested by sast-scan.guard.test.mjs) ──

/** Map a scanner's native severity onto the normalized scale. Throws (fail-fast) on an unmapped value. */
export function normalizeSeverity(scanner, native, map) {
  if (scanner === 'semgrep') {
    const v = map.semgrep?.[native];
    if (!v) throw new Error(`[semgrep] unmapped native severity "${native}" — add it to severity-map.yaml (no silent default).`);
    return v;
  }
  if (scanner === 'pnpm-audit') {
    const v = map.pnpmAudit?.[String(native).toLowerCase()];
    if (!v) throw new Error(`[pnpm-audit] unmapped native severity "${native}" — add it to severity-map.yaml.`);
    return v;
  }
  if (scanner === 'cargo-audit' || scanner === 'pip-audit') {
    if (native === 'unscored') return map.unscoredAdvisory;
    if (native === 'informational') return map.informationalWarning;
    const score = typeof native === 'number' ? native : Number(native);
    if (!Number.isFinite(score)) {
      throw new Error(`[${scanner}] unmapped native severity "${native}" — expected a CVSS number, 'unscored', or 'informational'.`);
    }
    const b = map.cvssBands ?? {};
    if (score >= b.critical) return 'Critical';
    if (score >= b.high) return 'High';
    if (score >= b.medium) return 'Medium';
    return 'Low';
  }
  throw new Error(`Unknown scanner "${scanner}"`);
}

/** Derived per data-model: block iff High/Critical AND (SAST, or SCA runtime-scoped). */
export function deriveBlocking({ kind, severity, scope }) {
  if (severity !== 'High' && severity !== 'Critical') return false;
  return kind === 'sast' || scope === 'runtime';
}

/** SCA scope: runtime if the package is in the ecosystem runtime set; unknown set → runtime (conservative). */
export function classifyScope(pkgName, runtimeSet) {
  if (!runtimeSet) return 'runtime';
  return runtimeSet.has(pkgName) ? 'runtime' : 'dev';
}

/** Is this repo-relative path (forward slashes) part of the surface Semgrep scans? */
export function isScanTarget(path) {
  return CODE_EXT_RE.test(path) || WORKFLOW_PATH_RE.test(path) || DOCKERFILE_PATH_RE.test(path);
}

/** Fail-fast if a required scanner toolchain is not on PATH (FR-015). */
export function assertToolchain(cmd, scanner) {
  const probe = IS_WIN ? run('where', [cmd], { shell: false }) : run('sh', ['-c', `command -v ${cmd}`]);
  if (!probe || probe.status !== 0) {
    throw new Error(`[${scanner}] required toolchain "${cmd}" not found on PATH — install it (see ${RUNBOOK}). Refusing to skip a language surface (FR-015).`);
  }
}

/**
 * Group Semgrep's own `errors[]` by the rule they were raised against — the BLINDED rules (item #224).
 *
 * Semgrep reports a rule it could not RUN in `errors[]`, never in `results[]`. So a rule that has
 * gone blind contributes exactly zero findings and is, from the gate's input alone, identical to a
 * rule that found nothing because the code is clean. That is not hypothetical: the community rule
 * `gha-curl-pipe-shell` re-parses a step's `run:` block as Bash, cannot read the ci-log-step heredoc
 * MCM (and BELAY) wraps run-steps in, and produced 36 errors and 0 findings on MCM's main (measured
 * 2026-09-06) while six `curl … | sh` lines sat in the workflows unexamined. Its allowlist entry was
 * then reported as UNMATCHED, which reads as "remediated already".
 *
 * Carrying the counts into the report is what lets `check-sast-findings.mjs` tell the two apart.
 *
 * READ THE MESSAGE, NOT JUST THE FIELD. semgrep 1.169.0 populates the structured `rule_id` on an
 * `Internal matching error` but NOT on a `PartialParsing` one, where the rule name appears only in
 * the message prose (`… for metavariable-pattern in rule '<id>' …`). On the run that prompted MCM
 * item #224 that was 36 errors out of 39: keying on the field alone reports 3, understating the
 * blindness by an order of magnitude.
 *
 * An error with neither is a target the scanner could not parse — the scanner's problem with a file,
 * not a blinded rule — and is deliberately not attributed to one.
 */
const RULE_IN_MESSAGE = /\bin rule '([^']+)'/;

export function summarizeBlindedRules(errors) {
  const byRule = new Map();
  for (const e of errors ?? []) {
    const field = typeof e?.rule_id === 'string' && e.rule_id.trim() !== '' ? e.rule_id : null;
    const ruleId = field ?? RULE_IN_MESSAGE.exec(String(e?.message ?? ''))?.[1] ?? null;
    if (!ruleId) continue;
    if (!byRule.has(ruleId)) byRule.set(ruleId, { errorCount: 0, files: new Set() });
    const agg = byRule.get(ruleId);
    agg.errorCount += 1;
    if (typeof e.path === 'string' && e.path !== '') agg.files.add(e.path);
  }
  return [...byRule.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ruleId, agg]) => ({ ruleId, errorCount: agg.errorCount, fileCount: agg.files.size }));
}

/** Assemble the findings report object (the gate's input contract). */
export function buildFindingsReport({ scope, scanners, findings }) {
  return { schemaVersion: 1, generatedAtScope: scope, scanners, findings };
}

// ── Secret scrubbing (FR-018) ────────────────────────────────────────────────
// A scanned source snippet can echo a token literal, and Semgrep deliberately includes matched code
// context. MCM's fourth shape was its own session-cookie names; BELAY scrubs the generic
// access/refresh-token and session-id assignments instead.
export function scrubSecretsInText(text) {
  return String(text)
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '<redacted-jwt>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, '$1<redacted>')
    .replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, '<redacted-anthropic-key>')
    .replace(/\b((?:access_token|refresh_token|session_id)=)[^;&"'\s\\]+/g, '$1<redacted>');
}

function writeReport(path, text) {
  writeFileSync(path, scrubSecretsInText(text));
}

/** Every git-tracked file matching `pathspec` under `root`, repo-relative and sorted. */
function trackedFiles(pathspecs, root, scanner) {
  const r = run('git', ['ls-files', '-z', '--', ...pathspecs], { cwd: root });
  if (r.status !== 0) throw new Error(`[${scanner}] git ls-files failed — cannot discover lockfiles: ${(r.stderr || '').slice(-300)}`);
  return (r.stdout || '').split('\0').filter(Boolean).sort();
}

// ── Semgrep runner ───────────────────────────────────────────────────────────
function normalizeSemgrep(native, map) {
  const out = [];
  for (const r of native.results ?? []) {
    const nativeSeverity = r.extra?.severity ?? 'INFO';
    const severity = normalizeSeverity('semgrep', nativeSeverity, map);
    const line = r.start?.line ?? 0;
    const title = String(r.extra?.message ?? r.check_id ?? '').split('\n')[0].trim();
    // Normalize to forward slashes so `location` (and thus allowlist patterns) are portable across
    // a Windows dev host and the Linux CI runner.
    const path = String(r.path).replace(/\\/g, '/');
    out.push({
      scanner: 'semgrep', kind: 'sast', id: String(r.check_id ?? 'semgrep'),
      title, location: `${path}:${line}`, ecosystem: null,
      nativeSeverity: String(nativeSeverity), severity, scope: null,
      blocking: deriveBlocking({ kind: 'sast', severity, scope: null }), fixAvailable: null,
    });
  }
  return out;
}

function runSemgrep({ scope, targets, outDir, map }) {
  assertToolchain('uvx', 'semgrep');
  const nativeOut = resolve(outDir, 'semgrep-native.json');
  const args = [
    `semgrep@${SEMGREP_PIN}`, 'scan', '--metrics=off', '--disable-version-check',
    '--json', '--output', nativeOut,
  ];
  for (const c of loadSemgrepConfigs()) args.push('--config', c);
  args.push('--config', 'security/sast/rules/');
  for (const ex of loadSemgrepExcludes()) args.push('--exclude', ex);

  const scanTargets = scope === 'changed' ? targets : ['.'];
  if (scope === 'changed' && scanTargets.length === 0) {
    // No changed code files → Semgrep is a no-op (SCA still runs). Emit an empty native report.
    console.log('[sast-scan] semgrep: 0 changed scannable files — nothing to scan on this scope (SCA still runs in full).');
    writeReport(nativeOut, JSON.stringify({ results: [], errors: [], skipped: 'no changed code files' }, null, 2));
    return { native: { results: [], errors: [] }, findings: [], meta: { blindedRules: [] } };
  }
  args.push(...scanTargets);

  // The rule packs come from Semgrep's registry over the network: bounded-retried like the audits.
  const native = retryTransient('semgrep', () => {
    // A report left by an earlier run must never be read as this run's output.
    rmSync(nativeOut, { force: true });
    const r = run('uvx', args);
    // semgrep exit: 0 = no findings, 1 = findings present, >=2 = error (registry unreachable, bad rule, …).
    if (r.status !== 0 && r.status !== 1) {
      throw transientOr(
        `[semgrep] scan failed (exit ${r.status}) — rules/registry may be unreachable (fail-closed, FR-015): ${(r.stderr || '').slice(-500)}`,
        r.stderr || '',
      );
    }
    if (!existsSync(nativeOut)) {
      throw new Error(`[semgrep] produced no JSON output (exit ${r.status}) — refusing to report a clean scan.`);
    }
    return JSON.parse(readFileSync(nativeOut, 'utf8'));
  });
  return { native, findings: normalizeSemgrep(native, map), meta: { blindedRules: summarizeBlindedRules(native.errors) } };
}

/**
 * Run the custom rules' own `semgrep --test` fixtures (MCM item #224).
 *
 * In MCM the fixtures under `security/sast/rules/` shipped and NOTHING EVER RAN THEM: `semgrep --test`
 * appeared in no workflow, no Nx target and no script, so four rules' `ruleid:` / `ok:` annotations
 * were decoration for months. A rule that has silently stopped matching is exactly what unrun
 * fixtures hide.
 *
 * It lives HERE rather than in the workflow so the pin has one home (`SEMGREP_PIN` above).
 *
 * A rule with no fixture is SILENTLY SKIPPED by `semgrep --test` — measured in MCM: 4/4 passed while
 * five rule files existed. The unfixtured check below turns that into a failure, because "4/4 ✓" on
 * five rules is exactly the green tick that proves nothing. So does an empty or missing rules
 * directory: "0/0 passed" proves nothing either.
 */
export function ruleFixturePairs(dir = resolve(REPO_ROOT, 'security/sast/rules')) {
  const files = readdirSync(dir);
  const rules = files.filter((f) => /\.ya?ml$/.test(f) && !/\.test\.ya?ml$/.test(f));
  return rules.map((rule) => {
    const stem = rule.replace(/\.ya?ml$/, '');
    // Semgrep pairs a rule with a same-stem file in a language the rule targets — `<stem>.ts` for a
    // TS rule, `<stem>.test.yml` for a YAML one (a bare `<stem>.yaml` would collide with the rule).
    const fixtures = files.filter((f) => f !== rule && (f === `${stem}.test.yml` || f === `${stem}.test.yaml` || new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(ts|tsx|js|jsx|py)$`).test(f)));
    return { rule, fixtures };
  });
}

function testRules() {
  const dir = resolve(REPO_ROOT, 'security/sast/rules');
  let pairs;
  try {
    pairs = ruleFixturePairs(dir);
  } catch (e) {
    console.error(`[semgrep --test] cannot read the custom rules directory security/sast/rules/ (${e.code ?? e.message}).`);
    return 1;
  }
  if (pairs.length === 0) {
    console.error('[semgrep --test] no custom rules found in security/sast/rules/ — "0/0 passed" would prove nothing.');
    return 1;
  }
  const unfixtured = pairs.filter((p) => p.fixtures.length === 0);
  if (unfixtured.length) {
    console.error(`[semgrep --test] ${unfixtured.length} custom rule(s) have NO fixture, and \`semgrep --test\` skips those silently rather than failing:`);
    for (const p of unfixtured) console.error(`  ${p.rule}`);
    console.error('Add a same-stem fixture (`<rule>.ts` / `<rule>.py` for a code rule, `<rule>.test.yml` for a YAML one) with `# ruleid:` and `# ok:` annotations.');
    return 1;
  }
  try {
    assertToolchain('uvx', 'semgrep');
  } catch (e) {
    console.error(e.message);
    return 1;
  }
  const r = run('uvx', [`semgrep@${SEMGREP_PIN}`, '--test', '--metrics=off', '--disable-version-check', 'security/sast/rules/'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[semgrep --test] custom rule fixtures FAILED (exit ${r.status}).`);
    return 1;
  }
  console.log(`✓ semgrep --test passed for all ${pairs.length} custom rule(s), each with a fixture.`);
  return 0;
}

// ── cargo audit runner (stage 2; runs only while enabled) ───────────────────
//
// MCM audited one root Cargo.lock. BELAY discovers every committed Cargo.lock from git, as pnpm-audit
// does below, so a crate added under any project directory is audited without editing this file. A
// nested lockfile's findings are prefixed `<workspace>:`; the root's keep a bare `package@version`.

/** Every committed Cargo.lock, as `{ lockfile, workspace }` (workspace '.' = the repo root). */
export function cargoAuditSet(root = REPO_ROOT) {
  const lockfiles = trackedFiles(['*Cargo.lock'], root, 'cargo-audit');
  if (!lockfiles.length) throw new Error('[cargo-audit] no committed Cargo.lock found — refusing to report a clean Rust audit.');
  return lockfiles.map((lockfile) => ({ lockfile, workspace: dirname(lockfile) }));
}

/** The location a cargo-audit finding is reported under: `[<workspace>:]<crate>@<version>`. */
export function cargoFindingLocation(workspace, crate, version) {
  return `${workspace === '.' ? '' : `${workspace}:`}${crate}@${version}`;
}

function computeCargoRuntimeSet(workspaceDir) {
  const r = run('cargo', ['tree', '--edges', 'no-dev', '--prefix', 'none', '--no-dedupe'], { cwd: workspaceDir });
  if (r.status !== 0) return null; // can't classify → conservative (everything runtime)
  const set = new Set();
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z0-9_-]+)\s+v\d/);
    if (m) set.add(m[1]);
  }
  return set.size ? set : null;
}

// RustSec `cvss` is null, a numeric score, or a CVSS vector string. Only a plain number is scorable;
// a vector string can't be scored without a calculator → treat as unscored (conservative → High).
function cargoCvssNative(cvss) {
  if (cvss == null) return 'unscored';
  if (typeof cvss === 'number') return cvss;
  const n = Number(cvss);
  return Number.isFinite(n) ? n : 'unscored';
}

function normalizeCargoAudit(native, runtimeSet, map, workspace = '.') {
  const out = [];
  for (const v of native.vulnerabilities?.list ?? []) {
    const adv = v.advisory ?? {};
    const pkg = v.package ?? {};
    const nativeSev = cargoCvssNative(adv.cvss);
    const severity = normalizeSeverity('cargo-audit', nativeSev, map);
    const scope = classifyScope(pkg.name, runtimeSet);
    out.push({
      scanner: 'cargo-audit', kind: 'sca', id: String(adv.id ?? 'RUSTSEC-unknown'),
      title: String(adv.title ?? adv.id ?? ''), location: cargoFindingLocation(workspace, pkg.name, pkg.version),
      ecosystem: 'cargo', nativeSeverity: String(adv.cvss ?? 'unscored'), severity, scope,
      blocking: deriveBlocking({ kind: 'sca', severity, scope }),
      fixAvailable: (v.versions?.patched ?? [])[0] ?? null,
    });
  }
  // Informational warnings (unmaintained / yanked / unsound) → Low, never blocking.
  for (const [kind, list] of Object.entries(native.warnings ?? {})) {
    for (const w of list ?? []) {
      const pkg = w.package ?? {};
      const adv = w.advisory ?? null;
      const severity = normalizeSeverity('cargo-audit', 'informational', map);
      const scope = classifyScope(pkg.name, runtimeSet);
      out.push({
        scanner: 'cargo-audit', kind: 'sca', id: String(adv?.id ?? `cargo-${kind}-${pkg.name}`),
        title: String(adv?.title ?? `${kind}: ${pkg.name}`), location: cargoFindingLocation(workspace, pkg.name, pkg.version),
        ecosystem: 'cargo', nativeSeverity: String(kind), severity, scope,
        blocking: false, fixAvailable: null,
      });
    }
  }
  return out;
}

function runCargoAudit({ map }) {
  assertToolchain('cargo', 'cargo-audit');
  const natives = {};
  const findings = [];
  // Any workspace failing fails the WHOLE scan: one-of-two is never a clean report.
  for (const { lockfile, workspace } of cargoAuditSet()) {
    const workspaceDir = resolve(REPO_ROOT, workspace);
    const runtimeSet = computeCargoRuntimeSet(workspaceDir);
    // `cargo audit` git-fetches the RustSec advisory DB, so it is network-dependent like pip-audit
    // (MCM item #449). Fixing only the scanner that happened to bite would leave the same defect twice.
    const native = retryTransient('cargo-audit', () => {
      const r = run('cargo', ['audit', '--file', 'Cargo.lock', '--json'], { cwd: workspaceDir });
      const out = `${r.stderr || ''}\n${r.stdout || ''}`;
      if (r.status !== 0 && r.status !== 1) {
        throw transientOr(`[cargo-audit] ${lockfile} failed (exit ${r.status}) — advisory DB may be unreachable (fail-closed): ${(r.stderr || '').slice(-500)}`, out);
      }
      try {
        return JSON.parse(r.stdout);
      } catch {
        throw transientOr(`[cargo-audit] ${lockfile} non-JSON output — is cargo-audit installed and the advisory DB fetchable? ${(r.stderr || r.stdout || '').slice(-300)}`, out);
      }
    });
    natives[lockfile] = native;
    findings.push(...normalizeCargoAudit(native, runtimeSet, map, workspace));
  }
  return { native: natives, findings };
}

// ── pnpm audit runner (every committed lockfile, MCM item #721) ─────────────
//
// `pnpm audit` reads ONE lockfile: the one belonging to the workspace it is run in. Run at the repo
// root it never sees a NESTED workspace — a directory with its own pnpm-workspace.yaml and lockfile.
// MCM had one such tree, run with a model-provider credential, audited by nothing and nothing said so.
//
// The audit set is therefore DISCOVERED from git (every committed pnpm-lock.yaml), never hard-coded,
// and sast-scan.guard.test.mjs compares it with an independent `git ls-files` so a new nested
// workspace — or an exclusion added here — fails the guard by name.
//
// INVOCATION: a nested workspace is audited as `pnpm --dir <ws> audit --json` from the repo root.
// Without corepack (Node 26), pnpm switches only to the packageManager of the workspace it operates
// on, and `--dir` makes that the nested one (measured in MCM 2026-11-15). The audit is lockfile-only:
// it needs no node_modules in the nested workspace (MCM measured 471 deps audited from a checkout
// with none installed).
//
// LOCATION: root findings keep the bare `package@version`; a nested workspace's findings are prefixed
// `<workspace>:package@version`. So a root allowlist entry never silently covers the same package in
// another workspace's tree — that tree gets its own, separately justified entry or it blocks.

/** Every committed pnpm lockfile, as `{ lockfile, workspace }` (workspace '.' = the repo root). */
export function pnpmAuditSet(root = REPO_ROOT) {
  const lockfiles = trackedFiles(['*pnpm-lock.yaml'], root, 'pnpm-audit');
  if (!lockfiles.length) throw new Error('[pnpm-audit] no committed pnpm-lock.yaml found — refusing to report a clean JS audit.');
  return lockfiles.map((lockfile) => ({ lockfile, workspace: dirname(lockfile) }));
}

/** Arguments for `pnpm audit` on one workspace, run from the repo root (see the header). */
export function pnpmAuditArgs(workspace, extra) {
  return [...(workspace === '.' ? [] : ['--dir', workspace]), 'audit', '--json', ...extra];
}

function pnpmAuditJson(workspace, extra) {
  // Queries the npm registry's advisory endpoint — network-dependent, so bounded-retried.
  return retryTransient('pnpm-audit', () => {
    const r = run('pnpm', pnpmAuditArgs(workspace, extra));
    try {
      return JSON.parse(r.stdout);
    } catch {
      throw transientOr(
        `[pnpm-audit] ${workspace} produced non-JSON output (registry advisories unreachable?): ${(r.stderr || r.stdout || '').slice(-300)}`,
        `${r.stderr || ''}\n${r.stdout || ''}`,
      );
    }
  });
}

/** The id a pnpm-audit finding is reported (and allowlisted) under. */
export function pnpmAdvisoryId(adv, key) {
  return String(adv.github_advisory_id || (adv.cves || [])[0] || adv.id || key);
}

/** The location a pnpm-audit finding is reported under: `[<workspace>:]<module>@<version>`. */
export function pnpmFindingLocation(workspace, moduleName, version) {
  return `${workspace === '.' ? '' : `${workspace}:`}${moduleName}@${version}`;
}

export function normalizePnpmAudit(full, prodKeys, map, workspace = '.') {
  const out = [];
  for (const [key, adv] of Object.entries(full.advisories ?? {})) {
    const id = pnpmAdvisoryId(adv, key);
    const scope = prodKeys.has(String(key)) || prodKeys.has(String(adv.id)) ? 'runtime' : 'dev';
    const severity = normalizeSeverity('pnpm-audit', adv.severity, map);
    const fix = adv.patched_versions && adv.patched_versions !== '<0.0.0' ? String(adv.patched_versions) : null;
    const versions = (adv.findings ?? []).map((f) => f.version).filter(Boolean);
    for (const version of versions.length ? versions : ['*']) {
      out.push({
        scanner: 'pnpm-audit', kind: 'sca', id, title: String(adv.title ?? id),
        location: pnpmFindingLocation(workspace, adv.module_name, version), ecosystem: 'npm',
        nativeSeverity: String(adv.severity), severity, scope,
        blocking: deriveBlocking({ kind: 'sca', severity, scope }), fixAvailable: fix,
      });
    }
  }
  return out;
}

function runPnpmAudit({ map }) {
  assertToolchain('pnpm', 'pnpm-audit');
  const natives = {};
  const findings = [];
  // Any workspace failing fails the WHOLE scan, as for pip-audit: one-of-two is never a clean report.
  for (const { lockfile, workspace } of pnpmAuditSet()) {
    const full = pnpmAuditJson(workspace, []);
    const prod = pnpmAuditJson(workspace, ['--prod']);
    const prodKeys = new Set(Object.keys(prod.advisories ?? {}));
    natives[lockfile] = full;
    findings.push(...normalizePnpmAudit(full, prodKeys, map, workspace));
  }
  return { native: natives, findings };
}

// ── pip-audit runner (stage 3; runs only while enabled) ─────────────────────
const normPyName = (n) => String(n).toLowerCase().replace(/[_.]+/g, '-');

function uvExport(projectDir, extra) {
  // --no-hashes is REQUIRED: a hashed requirements file puts pip-audit into --require-hashes mode,
  // which spins up a virtualenv and runs internal pip to resolve/download all deps (extremely slow —
  // it hangs for many minutes on the full set). Without hashes, pip-audit audits the pins directly
  // against OSV (~1s/package), no venv, no resolution.
  const r = run('uv', ['export', '--frozen', '--no-emit-project', '--no-hashes', ...extra, '--format', 'requirements-txt'], { cwd: projectDir });
  if (r.status !== 0) {
    throw new Error(`[pip-audit] uv export failed (exit ${r.status}): ${(r.stderr || '').slice(-300)}`);
  }
  return r.stdout || '';
}

function parseReqNames(text) {
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z0-9._-]+)==/);
    if (m) set.add(normPyName(m[1]));
  }
  return set.size ? set : null;
}

/**
 * The monorepo project directories Python projects live under (AGENTS.md: code under these needs a
 * spec). MCM hard-coded its four projects; BELAY derives its surfaces from git instead.
 */
export const PROJECT_PARENTS = ['agents', 'backend', 'frontend', 'mcp-servers', 'packages', 'tools'];

const underProjectParent = (p) => PROJECT_PARENTS.some((parent) => p.startsWith(`${parent}/`));

/**
 * Every Python project under the project directories, from TRACKED files:
 *   locked   — directories holding a committed `uv.lock` (each one is a pip-audit surface)
 *   unlocked — directories holding a `pyproject.toml` that no `uv.lock` in it or an ancestor covers
 *
 * Tracked, not on disk: a scratch venv or an untracked checkout must not change what the gate audits.
 */
export function discoverPythonProjects(root = REPO_ROOT) {
  const files = trackedFiles(['*pyproject.toml', '*uv.lock'], root, 'pip-audit').filter(underProjectParent);
  const locked = [...new Set(files.filter((f) => f.endsWith('/uv.lock')).map(dirname))].sort();
  const covered = (dir) => locked.some((l) => dir === l || dir.startsWith(`${l}/`));
  const unlocked = [...new Set(files.filter((f) => f.endsWith('/pyproject.toml')).map(dirname))]
    .filter((d) => !covered(d))
    .sort();
  return { locked, unlocked };
}

/**
 * The Python surfaces pip-audit covers. Each surface derives its OWN dependency and runtime sets,
 * because classifying one project's package against another's graph would call a dev-only package
 * runtime — or drop it entirely, since the project's graph filters unknown names (MCM feature 068).
 */
export function pythonSurfaces(discovered = discoverPythonProjects()) {
  return discovered.locked.map((d) => ({ project: d, dir: d }));
}

/**
 * Refuse a pip-audit run that would silently omit a project, or audit nothing (FR-015).
 *
 * A `pyproject.toml` with no covering `uv.lock` cannot be exported `--frozen`, so it cannot be
 * audited: silent omission would rebuild exactly the blind spot this scanner exists to close (MCM
 * FR-021). And pip-audit enabled with no Python project at all is a misconfiguration, never a clean
 * Python audit.
 */
export function assertPythonSurfacesAuditable(discovered = discoverPythonProjects()) {
  if (discovered.unlocked.length) {
    throw new Error(
      `[pip-audit] ${discovered.unlocked.length} Python project(s) have no committed uv.lock, so they cannot be ` +
      `audited: ${discovered.unlocked.join(', ')}. Commit each project's uv.lock (and a \`uv sync\` step in ` +
      'the sast job) so its dependencies are audited — do not leave them unscanned.',
    );
  }
  if (!discovered.locked.length) {
    throw new Error(
      `[pip-audit] enabled in ${SCAN_CONFIG}, but no Python project (a committed uv.lock under ` +
      `${PROJECT_PARENTS.join('/, ')}/) exists — refusing to report a clean Python audit.`,
    );
  }
}

/**
 * Static shape check on pip-audit suppressions (MCM feature 068, FR-005) — deliberately
 * finding-independent.
 *
 * Runtime "this entry matched nothing" detection exists (selectUnmatched in allowlist-expiry.mjs),
 * but it is report-only and is suppressed when its scanner produced no findings. pip-audit's healthy
 * state is zero findings, so that suppression is active precisely when nothing is wrong. An entry
 * anchored to a surface that does not exist can never match, and that is provable from its own text.
 *
 * An UNANCHORED pattern stays legal: one advisory accepted identically across every surface is a
 * legitimate, deliberate choice.
 */
export function assertPipAuditAllowlistShape(entries = [], surfaces = pythonSurfaces()) {
  const known = new Set(surfaces.map((s) => s.project));
  for (const e of entries) {
    if (e?.scanner !== 'pip-audit') continue;
    const pattern = String(e.locationPattern ?? '');
    if (!pattern.startsWith('^')) continue; // deliberate cross-surface entry
    const surface = pattern.slice(1).split(':')[0];
    if (!known.has(surface)) {
      throw new Error(
        `[pip-audit] allowlist entry ${e.id} has locationPattern "${pattern}", which is anchored to ` +
        `"${surface}" — not one of the scanned surfaces (${[...known].join(', ') || 'none'}). It can never ` +
        `match, so it suppresses nothing. Anchor it to a real surface, or drop the leading "^" if ` +
        `it is meant to apply across all of them.`,
      );
    }
  }
}

export function normalizePipAudit(native, projectSet, runtimeSet, map, project) {
  const out = [];
  for (const dep of native.dependencies ?? []) {
    const name = normPyName(dep.name);
    // Auditing the installed env also surfaces pip-audit's own ephemerally-injected deps; keep only
    // packages that are actually in the project's dependency graph (projectSet). Null set → keep all.
    if (projectSet && !projectSet.has(name)) continue;
    for (const vuln of dep.vulns ?? []) {
      // pip-audit/OSV rarely carries a CVSS score → conservative 'unscored' (→ High).
      const severity = normalizeSeverity('pip-audit', 'unscored', map);
      const scope = classifyScope(name, runtimeSet);
      out.push({
        scanner: 'pip-audit', kind: 'sca', id: String(vuln.id),
        title: String((vuln.aliases || [])[0] || vuln.id),
        // Project-qualified so a suppression can name ONE surface.
        location: `${project}:${dep.name}@${dep.version}`,
        ecosystem: 'pypi', nativeSeverity: 'unscored', severity, scope,
        blocking: deriveBlocking({ kind: 'sca', severity, scope }),
        fixAvailable: (vuln.fix_versions || [])[0] ?? null,
      });
    }
  }
  return out;
}

function auditOnePythonSurface({ project, dir }, map, cacheDir) {
  const surfaceDir = resolve(REPO_ROOT, dir);
  const projectSet = parseReqNames(uvExport(surfaceDir, []));             // this surface's full graph
  const runtimeSet = parseReqNames(uvExport(surfaceDir, ['--no-dev']));   // its OWN runtime subset

  // Audit the INSTALLED venv, NOT a requirements file: pip-audit's `-r` mode resolves the file in an
  // ephemeral venv (downloads every dep — hangs for many minutes on the full lockfile). Auditing the
  // already-synced env queries OSV for the installed distributions directly (~1 min, no download).
  // pip-audit is injected via `uv run --with`; its own deps are filtered out via projectSet.
  // Prereq: this surface's venv is synced (`uv sync` in its directory).
  //
  // Bounded-retried (MCM item #449): this exact call redded MCM's required gate with an osv.dev
  // ServiceError while the scan had otherwise completed clean. The venv-not-synced case in the
  // message below is NOT retried — transientOr classifies it as a real fault, so it still fails on
  // the first attempt rather than after the whole backoff budget.
  const native = retryTransient('pip-audit', () => {
    const r = run('uv', ['run', '--no-sync', '--with', 'pip-audit', 'pip-audit', '--format', 'json', '-s', 'osv', '--progress-spinner', 'off', ...pipAuditCacheArgs(cacheDir)], { cwd: surfaceDir });
    const out = `${r.stderr || ''}\n${r.stdout || ''}`;
    if (r.status !== 0 && r.status !== 1) {
      throw transientOr(`[pip-audit] ${project} failed (exit ${r.status}) — OSV unreachable, or the venv is not synced (run \`uv sync\` in ${dir}): ${(r.stderr || '').slice(-500)}`, out);
    }
    try {
      return JSON.parse(r.stdout);
    } catch {
      throw transientOr(`[pip-audit] ${project} produced non-JSON output: ${(r.stderr || r.stdout || '').slice(-300)}`, out);
    }
  });
  return { native, findings: normalizePipAudit(native, projectSet, runtimeSet, map, project) };
}

/**
 * pip-audit's cache directory, passed explicitly. Without it pip-audit asks platformdirs for the user
 * cache dir, and platformdirs >= 4.14.8 (2026-11-20) refuses one whose nearest existing ancestor is
 * writable by another user. In MCM's CI container that is `/root/.cache`, so every scan failed with
 * `PermissionError: /root/.cache, writable by another user`. The flag skips platformdirs entirely, and
 * mkdtemp creates the directory 0700, so the cache is private as platformdirs intends.
 */
export function pipAuditCacheArgs(cacheDir) {
  return cacheDir ? ['--cache-dir', join(cacheDir, 'pip-audit')] : [];
}

function runPipAudit({ map }) {
  assertToolchain('uv', 'pip-audit');
  // Before scanning anything, refuse to run if a Python project is unauditable or none exists.
  // Ordered first on purpose: a partial scan that silently omits a project is the failure mode this
  // scanner exists to prevent, so it must not be reachable.
  const discovered = discoverPythonProjects();
  assertPythonSurfacesAuditable(discovered);
  const surfaces = pythonSurfaces(discovered);
  // A suppression anchored to a non-existent surface can never match; catch it statically rather
  // than waiting for a run that happens to produce a finding.
  assertPipAuditAllowlistShape(loadAllowlistEntriesForShapeCheck(), surfaces);

  const natives = {};
  const findings = [];
  const cacheDir = mkdtempSync(join(tmpdir(), 'belay-pip-audit-'));
  try {
    for (const surface of surfaces) {
      // Any surface failing fails the WHOLE scan. Three-of-four is never reported as success.
      const out = auditOnePythonSurface(surface, map, cacheDir);
      natives[surface.project] = out.native;
      findings.push(...out.findings);
    }
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
  return { native: natives, findings };
}

/** The allowlist as raw YAML entries, for the static shape check only (the gate owns real parsing). */
function loadAllowlistEntriesForShapeCheck() {
  const path = resolve(REPO_ROOT, 'security/sast/allowlist.yaml');
  if (!existsSync(path)) return [];
  const parsed = parseYaml(readFileSync(path, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

// ── SARIF + summary ──────────────────────────────────────────────────────────
function toSarif(findings) {
  const level = (s) => ({ Critical: 'error', High: 'error', Medium: 'warning', Low: 'note' }[s] || 'note');
  const results = findings.map((f) => {
    const loc = f.kind === 'sast'
      ? { physicalLocation: { artifactLocation: { uri: f.location.replace(/:\d+$/, '') }, region: { startLine: Number(f.location.match(/:(\d+)$/)?.[1] || 1) } } }
      : { logicalLocations: [{ name: f.location, kind: 'package' }] };
    return {
      ruleId: `${f.scanner}:${f.id}`,
      level: level(f.severity),
      message: { text: `[${f.severity}${f.blocking ? '/blocking' : ''}] ${f.title}` },
      locations: [loc],
      properties: { scanner: f.scanner, kind: f.kind, severity: f.severity, scope: f.scope, blocking: f.blocking },
    };
  });
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{ tool: { driver: { name: 'belay-sast-scan', rules: [] } }, results }],
  };
}

const SEV_ORDER = ['Critical', 'High', 'Medium', 'Low'];

// ── --emit-allowlist (FR-012): baseline-seeding aid ──────────────────────────
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Write a proposed allowlist covering every CURRENT finding (one entry per unique
// scanner+id+location). Justification/addedBy are TODO placeholders for the human triager —
// this does NOT modify the committed allowlist and is not consumed by the gate.
function emitProposedAllowlist(findings, outPath) {
  const seen = new Set();
  const lines = [
    '# PROPOSED allowlist — generated by sast-scan.mjs --emit-allowlist (FR-012).',
    '# Baseline-seeding aid only: NOT read by the gate. Triage each entry — replace the TODO',
    '# justification/addedBy with a real decision (false positive vs accepted risk), broaden or',
    '# tighten locationPattern as appropriate, then copy the kept entries into',
    '# security/sast/allowlist.yaml. Delete entries for findings you intend to FIX instead.',
    '',
  ];
  for (const f of findings) {
    // \u0000 as an escape, never a raw NUL byte: a raw one makes grep treat this whole file as
    // binary and silently print no matching lines at all (MCM item #448).
    const key = `${f.scanner}\u0000${f.id}\u0000${f.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const flags = `${f.severity}${f.blocking ? '/blocking' : f.scope === 'dev' ? '/dev-scope' : ''}`;
    lines.push(`- scanner: "${f.scanner}"           # ${flags} — ${String(f.title).replace(/"/g, "'").slice(0, 80)}`);
    lines.push(`  id: "${f.id}"`);
    lines.push(`  locationPattern: "${reEscape(f.location)}"`);
    lines.push('  justification: "TODO: triage — false positive or accepted risk?"');
    lines.push('  addedBy: "TODO"');
    lines.push('');
  }
  writeReport(outPath, lines.join('\n'));
  return seen.size;
}

/** One summary line per scanner. Only `ran` reports a count; every other status says NOT scanned. */
function scannerLine(s) {
  switch (s.status) {
    case 'ran': return `${s.findingCount} finding(s)`;
    case 'failed': return `FAILED — ${s.error}`;
    case 'not-enabled': return `not enabled (${SCAN_CONFIG}) — NOT scanned`;
    case 'not-selected': return 'not selected (--only) — NOT scanned';
    case 'not-run': return 'not run — an earlier scanner failed — NOT scanned';
    default: return s.ran ? `${s.findingCount} finding(s)` : `NOT RUN — ${s.error}`;
  }
}

export function summarize(report) {
  const lines = ['── SAST/SCA scan summary ──────────────────────────────'];
  lines.push(`scope=${report.generatedAtScope}  findings=${report.findings.length}  blocking=${report.findings.filter((f) => f.blocking).length}`);
  for (const s of report.scanners ?? []) lines.push(`  ${s.scanner}: ${scannerLine(s)}`);
  for (const sev of SEV_ORDER) {
    const items = report.findings.filter((f) => f.severity === sev);
    if (!items.length) continue;
    lines.push(`${sev}: ${items.length}${sev === 'High' || sev === 'Critical' ? ` (${items.filter((f) => f.blocking).length} blocking)` : ''}`);
    for (const f of items.slice(0, 40)) {
      lines.push(`  [${f.scanner}${f.blocking ? '/BLOCK' : f.scope === 'dev' ? '/dev' : ''}] ${f.id} — ${f.location}`);
    }
    if (items.length > 40) lines.push(`  … and ${items.length - 40} more`);
  }
  lines.push('───────────────────────────────────────────────────────');
  return lines.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const USAGE = 'Usage: sast-scan.mjs [--scope full|changed] [--base <ref>] [--only <scanner,...>] [--emit-allowlist] [--out <dir>] | --test-rules';

function parseArgs(argv) {
  const args = { scope: 'full', base: 'origin/main', only: null, out: 'security/sast/reports', emitAllowlist: false, testRules: false };
  const value = (i, flag) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new SastUsageError(`${flag} needs a value. ${USAGE}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scope') args.scope = value(++i, a);
    else if (a === '--base') args.base = value(++i, a);
    else if (a === '--only') args.only = value(++i, a).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') args.out = value(++i, a);
    else if (a === '--emit-allowlist') args.emitAllowlist = true;
    else if (a === '--test-rules') args.testRules = true;
    else throw new SastUsageError(`Unknown argument: ${a}. ${USAGE}`);
  }
  if (!['full', 'changed'].includes(args.scope)) throw new SastUsageError(`--scope must be full|changed (got "${args.scope}")`);
  return args;
}

function computeChangedTargets(base) {
  const r = run('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]);
  if (r.status !== 0) {
    // Fail closed: an unresolvable base must not read as "nothing changed" and pass the PR unscanned.
    throw new Error(`[semgrep] git diff vs ${base} failed — cannot compute the changed set (fetch the base ref, or use --scope full): ${(r.stderr || '').slice(-200)}`);
  }
  // Explicit target files bypass Semgrep's --exclude, so apply the .semgrepignore exclusions here too:
  // drop any changed path with an excluded segment (notably security/ — the rule fixtures are
  // intentionally-insecure test data that must never be scanned as product code).
  const excluded = new Set(loadSemgrepExcludes());
  const isExcluded = (p) => p.split('/').some((seg) => excluded.has(seg));
  return (r.stdout || '').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && isScanTarget(l) && !isExcluded(l) && existsSync(resolve(REPO_ROOT, l)));
}

function main(argv) {
  let args;
  let enabled;
  let selected;
  try {
    args = parseArgs(argv);
    // Prove the custom rules still match what they claim BEFORE spending minutes on a real scan.
    if (args.testRules) return testRules();
    // The enabled list is validated before anything is scanned or written.
    enabled = loadEnabledScanners();
    selected = selectScanners({ enabled, only: args.only });
  } catch (e) {
    if (e instanceof SastUsageError) {
      console.error(`[sast-scan] ${e.message}`);
      return e.exitCode;
    }
    throw e;
  }

  const outDir = resolve(REPO_ROOT, args.out);
  mkdirSync(outDir, { recursive: true });
  const map = loadSeverityMap();

  const runners = {
    'semgrep': () => runSemgrep({
      scope: args.scope,
      targets: args.scope === 'changed' ? computeChangedTargets(args.base) : [],
      outDir,
      map,
    }),
    'cargo-audit': () => runCargoAudit({ map }),
    'pnpm-audit': () => runPnpmAudit({ map }),
    'pip-audit': () => runPipAudit({ map }),
  };

  const { scanners, findings, natives, failed } = runScanners({ enabled, selected, runners });
  for (const [name, native] of Object.entries(natives)) {
    writeReport(resolve(outDir, `${name}-native.json`), JSON.stringify(native, null, 2));
  }

  const report = buildFindingsReport({ scope: args.scope, scanners, findings });
  writeReport(resolve(outDir, 'findings.json'), JSON.stringify(report, null, 2));
  writeReport(resolve(outDir, 'findings.sarif'), JSON.stringify(toSarif(findings), null, 2));
  const summary = summarize(report);
  writeReport(resolve(outDir, 'summary.txt'), summary);
  console.log(scrubSecretsInText(summary));

  if (args.emitAllowlist) {
    const proposedPath = resolve(outDir, 'allowlist.proposed.yaml');
    const n = emitProposedAllowlist(findings, proposedPath);
    console.log(`[sast-scan] wrote ${n} proposed allowlist entries → ${args.out}/allowlist.proposed.yaml (triage before committing to security/sast/allowlist.yaml).`);
  }

  if (failed) {
    console.error(`[sast-scan] FAILED fast: ${scrubSecretsInText(failed.message)}`);
    return 1;
  }
  console.log(`[sast-scan] done — reports in ${args.out}/ (${findings.length} findings, ${findings.filter((f) => f.blocking).length} blocking).`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
