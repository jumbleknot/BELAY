// Tests for scripts/sast-scan.mjs — the SAST/SCA scan orchestrator (feature 006, stage 1).
// Contract: specs/006-sast-stage1/contracts/sast-cli.md and data-model.md, which take MCM feature
// 033's orchestrator contract as their baseline.
//
// Ported from MovieCollectionManager (MCM). Item numbers in the comments (#224, #426, #449, #721, …)
// are MCM's backlog, kept because they carry the measurements the behaviour was learned from.
//
// Unit-level tests over the orchestrator's exported functions; no scanner subprocess runs:
//   - severity normalization applies severity-map.yaml; an unmapped native value fails fast;
//   - `blocking` is derived: severity in {High, Critical} AND (kind == sast OR scope == runtime);
//   - SCA scope (runtime vs dev) from the ecosystem's runtime set; an unknown set means runtime;
//   - a missing toolchain fails fast, naming the scanner (FR-015);
//   - the built report keeps the findings contract the gate reads;
//   - the enabled-scanner list (security/sast/scan.yaml, research R1): unknown and empty lists are
//     refused, `--only` only narrows, and a scanner that is not enabled reads "not enabled", never clean;
//   - lockfile and Python-project discovery from git, so a new surface cannot be silently skipped;
//   - the CLI exits 2 on bad arguments.
//
// Runs in CI under `pnpm nx run scripts:test`: offline, token-free, node built-ins plus `yaml`.
// Discovery runs against throwaway git repositories (fixture monorepos).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  ALL_SCANNERS,
  SCAN_CONFIG,
  SastUsageError,
  loadSeverityMap,
  loadEnabledScanners,
  selectScanners,
  runScanners,
  summarize,
  normalizeSeverity,
  deriveBlocking,
  classifyScope,
  assertToolchain,
  buildFindingsReport,
  summarizeBlindedRules,
  isScanTarget,
  pipAuditCacheArgs,
  ruleFixturePairs,
  scrubSecretsInText,
  discoverPythonProjects,
  pythonSurfaces,
  assertPythonSurfacesAuditable,
  assertPipAuditAllowlistShape,
  normalizePipAudit,
  pnpmAuditSet,
  pnpmAuditArgs,
  normalizePnpmAudit,
  cargoAuditSet,
  cargoFindingLocation,
} from '../sast-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const ORCH = resolve(REPO_ROOT, 'scripts', 'sast-scan.mjs');
const cli = (...args) => spawnSync(process.execPath, [ORCH, ...args], { encoding: 'utf8', cwd: REPO_ROOT });

const MAP = loadSeverityMap(); // default: security/sast/severity-map.yaml

const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A throwaway directory, removed after the run. */
function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** A fixture monorepo whose `files` (path → text) are all tracked by git. */
function fixtureRepo(files) {
  const dir = scratch('sast-scan-repo-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

/** A scan.yaml with this body, in a throwaway directory. */
function scanConfig(text) {
  const path = join(scratch('sast-scan-config-'), 'scan.yaml');
  writeFileSync(path, text);
  return path;
}

// ── Severity normalization ────────────────────────────────────────────────────

test('normalizeSeverity applies severity-map.yaml for each scanner', () => {
  assert.equal(normalizeSeverity('semgrep', 'ERROR', MAP), 'High');
  assert.equal(normalizeSeverity('semgrep', 'WARNING', MAP), 'Medium');
  assert.equal(normalizeSeverity('semgrep', 'INFO', MAP), 'Low');

  // CVSS bands (cargo-audit / pip-audit).
  assert.equal(normalizeSeverity('cargo-audit', 9.8, MAP), 'Critical');
  assert.equal(normalizeSeverity('cargo-audit', 7.5, MAP), 'High');
  assert.equal(normalizeSeverity('cargo-audit', 5.0, MAP), 'Medium');
  assert.equal(normalizeSeverity('pip-audit', 2.1, MAP), 'Low');

  // pnpm named levels.
  assert.equal(normalizeSeverity('pnpm-audit', 'critical', MAP), 'Critical');
  assert.equal(normalizeSeverity('pnpm-audit', 'moderate', MAP), 'Medium');

  // Conservative defaults (spec edge cases).
  assert.equal(normalizeSeverity('cargo-audit', 'unscored', MAP), 'High');
  assert.equal(normalizeSeverity('pip-audit', 'unscored', MAP), 'High');
  assert.equal(normalizeSeverity('cargo-audit', 'informational', MAP), 'Low');
});

test('normalizeSeverity FAILS FAST on an unmapped native severity (no silent Low)', () => {
  assert.throws(() => normalizeSeverity('semgrep', 'CATASTROPHE', MAP), /unmapped|unknown|severity/i);
  assert.throws(() => normalizeSeverity('pnpm-audit', 'spicy', MAP), /unmapped|unknown|severity/i);
});

// ── blocking derivation (data-model) ─────────────────────────────────────────

test('deriveBlocking: SAST High/Critical always blocks; Medium/Low never', () => {
  assert.equal(deriveBlocking({ kind: 'sast', severity: 'High', scope: null }), true);
  assert.equal(deriveBlocking({ kind: 'sast', severity: 'Critical', scope: null }), true);
  assert.equal(deriveBlocking({ kind: 'sast', severity: 'Medium', scope: null }), false);
  assert.equal(deriveBlocking({ kind: 'sast', severity: 'Low', scope: null }), false);
});

test('deriveBlocking: SCA blocks only when High/Critical AND runtime scope', () => {
  assert.equal(deriveBlocking({ kind: 'sca', severity: 'High', scope: 'runtime' }), true);
  assert.equal(deriveBlocking({ kind: 'sca', severity: 'Critical', scope: 'runtime' }), true);
  assert.equal(deriveBlocking({ kind: 'sca', severity: 'High', scope: 'dev' }), false);
  assert.equal(deriveBlocking({ kind: 'sca', severity: 'Medium', scope: 'runtime' }), false);
});

// ── scope classification ─────────────────────────────────────────────────────

test('classifyScope: package in the runtime set is runtime, otherwise dev', () => {
  const runtime = new Set(['serde', 'tokio']);
  assert.equal(classifyScope('serde', runtime), 'runtime');
  assert.equal(classifyScope('mockall', runtime), 'dev');
});

test('classifyScope: an unclassifiable finding (null runtime set) defaults to runtime (conservative)', () => {
  assert.equal(classifyScope('anything', null), 'runtime');
});

// ── fail-fast on a missing toolchain (FR-015) ────────────────────────────────

test('assertToolchain throws (naming the scanner) when the command is absent', () => {
  assert.throws(() => assertToolchain('belay-definitely-not-a-real-binary-xyz', 'faketool'), /faketool/);
});

test('assertToolchain does not throw for a present command (node)', () => {
  assert.doesNotThrow(() => assertToolchain('node', 'node'));
});

// ── the built report keeps the findings contract (the gate's input) ─────────
//
// MCM validated this against its JSON Schema with `ajv`. BELAY adds no npm dependency for it
// (research R6), so the contract's required fields and enums are asserted directly here.

const SCANNER_STATUSES = ['ran', 'failed', 'not-enabled', 'not-selected', 'not-run'];

function assertReportContract(report) {
  assert.equal(report.schemaVersion, 1);
  assert.ok(['full', 'changed'].includes(report.generatedAtScope), `generatedAtScope: ${report.generatedAtScope}`);
  assert.ok(Array.isArray(report.findings), 'findings must be an array');
  for (const s of report.scanners ?? []) {
    assert.ok(ALL_SCANNERS.includes(s.scanner), `unknown scanner ${s.scanner}`);
    assert.equal(typeof s.ran, 'boolean', `${s.scanner}.ran`);
    assert.ok(Number.isInteger(s.findingCount) && s.findingCount >= 0, `${s.scanner}.findingCount`);
    assert.ok(SCANNER_STATUSES.includes(s.status), `${s.scanner}.status: ${s.status}`);
    assert.equal(s.ran, s.status === 'ran', `${s.scanner}: ran must agree with status`);
    for (const b of s.blindedRules ?? []) {
      assert.ok(typeof b.ruleId === 'string' && b.ruleId.length > 0);
      assert.ok(Number.isInteger(b.errorCount) && b.errorCount >= 1);
      assert.ok(Number.isInteger(b.fileCount) && b.fileCount >= 0);
    }
  }
  for (const f of report.findings) {
    for (const k of ['scanner', 'kind', 'id', 'title', 'location', 'nativeSeverity', 'severity', 'blocking']) {
      assert.ok(k in f, `finding is missing ${k}`);
    }
    assert.ok(ALL_SCANNERS.includes(f.scanner));
    assert.ok(['sast', 'sca'].includes(f.kind));
    assert.ok(['Critical', 'High', 'Medium', 'Low'].includes(f.severity));
    assert.ok([null, 'runtime', 'dev'].includes(f.scope ?? null));
    assert.ok(['npm', 'cargo', 'pypi', null].includes(f.ecosystem ?? null));
    assert.equal(typeof f.blocking, 'boolean');
    assert.ok(f.id.length > 0 && f.location.length > 0);
  }
}

const SAMPLE_FINDINGS = [
  {
    scanner: 'semgrep', kind: 'sast', id: 'belay-no-token-logging',
    title: 'Raw token logged', location: 'backend/example-service/src/auth.ts:42',
    ecosystem: null, nativeSeverity: 'ERROR', severity: 'High', scope: null,
    blocking: true, fixAvailable: null,
  },
  {
    scanner: 'pnpm-audit', kind: 'sca', id: 'GHSA-xxxx-yyyy-zzzz',
    title: 'Vuln in foo', location: 'foo@1.2.3',
    ecosystem: 'npm', nativeSeverity: 'high', severity: 'High', scope: 'runtime',
    blocking: true, fixAvailable: '>=1.2.4',
  },
];

test('buildFindingsReport output keeps the findings contract', () => {
  const report = buildFindingsReport({
    scope: 'full',
    scanners: [
      { scanner: 'semgrep', status: 'ran', ran: true, findingCount: 1, error: null },
      { scanner: 'cargo-audit', status: 'not-enabled', ran: false, findingCount: 0, error: null },
      { scanner: 'pnpm-audit', status: 'ran', ran: true, findingCount: 1, error: null },
      { scanner: 'pip-audit', status: 'not-enabled', ran: false, findingCount: 0, error: null },
    ],
    findings: SAMPLE_FINDINGS,
  });
  assertReportContract(report);
  assert.equal(report.generatedAtScope, 'full');
});

// ── The enabled-scanner list (security/sast/scan.yaml, research R1) ─────────

test('the committed scan.yaml is a valid, non-empty subset that enables stage 1', () => {
  const enabled = loadEnabledScanners();
  assert.ok(enabled.length > 0);
  for (const s of enabled) assert.ok(ALL_SCANNERS.includes(s), s);
  for (const s of ['semgrep', 'pnpm-audit']) assert.ok(enabled.includes(s), `stage 1 enables ${s}`);
});

test('scan.yaml naming an unknown scanner is refused as a usage error (exit 2), naming it', () => {
  const path = scanConfig('scanners: [semgrep, trivy]\n');
  assert.throws(
    () => loadEnabledScanners(path),
    (e) => e instanceof SastUsageError && e.exitCode === 2 && /trivy/.test(e.message),
  );
});

test('an EMPTY scan.yaml list is refused: a scan of nothing must not read as clean', () => {
  for (const body of ['scanners: []\n', 'scanners:\n', '{}\n', '']) {
    const path = scanConfig(body);
    assert.throws(
      () => loadEnabledScanners(path),
      (e) => e instanceof SastUsageError && e.exitCode === 2 && /empty|no scanner/i.test(e.message),
      `body ${JSON.stringify(body)} must be refused`,
    );
  }
});

test('scan.yaml listing a scanner twice is refused, so the list reads as what it does', () => {
  const path = scanConfig('scanners: [semgrep, semgrep]\n');
  assert.throws(() => loadEnabledScanners(path), (e) => e instanceof SastUsageError && /semgrep/.test(e.message));
});

test('scan.yaml entries are returned in the fixed scanner order', () => {
  assert.deepEqual(loadEnabledScanners(scanConfig('scanners: [pnpm-audit, semgrep]\n')), ['semgrep', 'pnpm-audit']);
});

test('without --only, every enabled scanner is selected', () => {
  assert.deepEqual(selectScanners({ enabled: ['semgrep', 'pnpm-audit'], only: null }), ['semgrep', 'pnpm-audit']);
});

test('--only may NARROW the enabled list', () => {
  assert.deepEqual(selectScanners({ enabled: ['semgrep', 'pnpm-audit'], only: ['pnpm-audit'] }), ['pnpm-audit']);
});

test('--only can never ADD a scanner the config does not enable: exit 2, naming the config', () => {
  assert.throws(
    () => selectScanners({ enabled: ['semgrep', 'pnpm-audit'], only: ['cargo-audit'] }),
    (e) => e instanceof SastUsageError && e.exitCode === 2
      && /cargo-audit/.test(e.message) && e.message.includes(SCAN_CONFIG),
  );
});

test('--only naming an unknown scanner is a usage error (exit 2)', () => {
  assert.throws(
    () => selectScanners({ enabled: ['semgrep'], only: ['nonsense'] }),
    (e) => e instanceof SastUsageError && e.exitCode === 2 && /nonsense/.test(e.message),
  );
});

/** Runners that record their calls; `throws` names a scanner whose runner fails. */
function fakeRunners({ throws = null, findings = {} } = {}) {
  const calls = [];
  const runners = {};
  for (const name of ALL_SCANNERS) {
    runners[name] = () => {
      calls.push(name);
      if (name === throws) throw new Error(`[${name}] could not run`);
      return { native: { name }, findings: findings[name] ?? [] };
    };
  }
  return { runners, calls };
}

test('a scanner that is not enabled is never invoked, and is reported not-enabled, never clean', () => {
  // pip-audit's runner would assert the Python surfaces (FR-015 fail-fast). It must not run at all
  // while pip-audit is not enabled, or a repository with no Python project could never scan.
  const { runners, calls } = fakeRunners({ throws: 'pip-audit' });
  const out = runScanners({ enabled: ['semgrep', 'pnpm-audit'], selected: ['semgrep', 'pnpm-audit'], runners, log: () => {} });
  assert.deepEqual(calls, ['semgrep', 'pnpm-audit']);
  assert.equal(out.failed, null);
  const byName = Object.fromEntries(out.scanners.map((s) => [s.scanner, s]));
  assert.deepEqual(Object.keys(byName).sort(), [...ALL_SCANNERS].sort(), 'every known scanner is listed');
  for (const name of ['cargo-audit', 'pip-audit']) {
    assert.equal(byName[name].status, 'not-enabled');
    assert.equal(byName[name].ran, false);
  }
  for (const name of ['semgrep', 'pnpm-audit']) assert.equal(byName[name].status, 'ran');

  const report = buildFindingsReport({ scope: 'full', scanners: out.scanners, findings: out.findings });
  assertReportContract(report);
  const text = summarize(report);
  for (const name of ['cargo-audit', 'pip-audit']) {
    const line = text.split('\n').find((l) => l.trim().startsWith(`${name}:`));
    assert.ok(line, `the summary must list ${name}`);
    assert.match(line, /not enabled/);
    assert.doesNotMatch(line, /\b0 finding|clean/i, 'a scanner that did not run must never read as clean');
  }
});

test('an enabled scanner narrowed out by --only is not invoked and reads not-selected', () => {
  const { runners, calls } = fakeRunners();
  const out = runScanners({ enabled: ['semgrep', 'pnpm-audit'], selected: ['pnpm-audit'], runners, log: () => {} });
  assert.deepEqual(calls, ['pnpm-audit']);
  const semgrep = out.scanners.find((s) => s.scanner === 'semgrep');
  assert.equal(semgrep.status, 'not-selected');
  assert.match(summarize(buildFindingsReport({ scope: 'full', scanners: out.scanners, findings: [] })), /semgrep: not selected/);
});

test('FR-015: an enabled scanner that cannot run fails the scan, recording its error', () => {
  const { runners, calls } = fakeRunners({ throws: 'semgrep' });
  const out = runScanners({ enabled: ['semgrep', 'pnpm-audit'], selected: ['semgrep', 'pnpm-audit'], runners, log: () => {} });
  assert.ok(out.failed, 'the failure must be returned so the CLI exits non-zero');
  assert.deepEqual(calls, ['semgrep'], 'fail-fast: nothing runs after the failure');
  const byName = Object.fromEntries(out.scanners.map((s) => [s.scanner, s]));
  assert.equal(byName.semgrep.status, 'failed');
  assert.match(byName.semgrep.error, /could not run/);
  assert.equal(byName['pnpm-audit'].status, 'not-run');
  const text = summarize(buildFindingsReport({ scope: 'full', scanners: out.scanners, findings: [] }));
  assert.match(text, /semgrep: FAILED/);
  assert.match(text, /pnpm-audit: not run/);
});

test('findings from every scanner that ran are collected, with natives kept per scanner', () => {
  const { runners } = fakeRunners({ findings: { semgrep: [SAMPLE_FINDINGS[0]], 'pnpm-audit': [SAMPLE_FINDINGS[1]] } });
  const out = runScanners({ enabled: ['semgrep', 'pnpm-audit'], selected: ['semgrep', 'pnpm-audit'], runners, log: () => {} });
  assert.deepEqual(out.findings, SAMPLE_FINDINGS);
  assert.deepEqual(Object.keys(out.natives).sort(), ['pnpm-audit', 'semgrep']);
  assert.equal(out.scanners.find((s) => s.scanner === 'semgrep').findingCount, 1);
});

// ── CLI process-level: usage errors exit 2 before anything is scanned ────────

test('the CLI exits 2 on an unknown argument', () => {
  assert.equal(cli('--nonsense-flag').status, 2);
});

test('the CLI exits 2 on a bad --scope', () => {
  assert.equal(cli('--scope', 'everything').status, 2);
});

test('the CLI exits 2 on --only naming an unknown scanner', () => {
  const r = cli('--only', 'nonsense');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /nonsense/);
});

test('the CLI exits 2 on --only naming a scanner the committed config does not enable, naming the config', () => {
  const enabled = loadEnabledScanners();
  const disabled = ALL_SCANNERS.find((s) => !enabled.includes(s));
  assert.ok(disabled, 'instrument check: the committed config must leave at least one scanner disabled for this test to prove anything');
  const r = cli('--only', disabled);
  assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes(SCAN_CONFIG), `stderr must name ${SCAN_CONFIG}: ${r.stderr}`);
  assert.match(r.stderr, new RegExp(disabled));
});

// ── Secret scrubbing (FR-018) ────────────────────────────────────────────────

test('report text is scrubbed of token shapes before it is written', () => {
  // Built from fragments so the secret-scan gate never sees a credential-shaped literal here.
  const jwt = ['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTYifQ', '.', 'c2lnbmF0dXJlLXBhcnQ'].join('');
  const bearer = `Bearer ${'A'.repeat(12)}${'b'.repeat(12)}`;
  const providerKey = ['sk', 'ant', 'api03', 'x'.repeat(24)].join('-');
  const cookie = ['access', '_token=', 'Zm9vYmFy', 'cXV1eA'].join('');
  const out = scrubSecretsInText(`a ${jwt} b ${bearer} c ${providerKey} d ${cookie}`);
  assert.ok(!out.includes(jwt));
  assert.ok(!out.includes(bearer));
  assert.ok(!out.includes(providerKey));
  assert.ok(!out.includes('Zm9vYmFycXV1eA'));
  assert.match(out, /access_token=<redacted>/);
});

// ── Blinded rules (MCM item #224) ────────────────────────────────────────────
//
// Semgrep reports a rule it could not RUN in `errors[]`, never in `results[]`, so a rule that has
// gone blind contributes exactly zero findings and is indistinguishable, from the gate's input,
// from a rule that found nothing because the code is clean. MCM measured it on 2026-09-06:
// `gha-curl-pipe-shell` produced 36 such errors and 0 findings while six `curl … | sh` lines sat in
// the workflows. Carrying the counts into the report is what lets the gate say which it was.

test('blinded-rule summary groups the scanner\'s own errors by rule, counting distinct files', () => {
  const errors = [
    { type: ['PartialParsing', [{}]], rule_id: 'r.blind', path: '.forgejo/workflows/app-ci.yml', level: 'warn' },
    { type: ['PartialParsing', [{}]], rule_id: 'r.blind', path: '.forgejo/workflows/app-ci.yml', level: 'warn' },
    { type: ['PartialParsing', [{}]], rule_id: 'r.blind', path: '.forgejo/workflows/guardrails.yml', level: 'warn' },
    { type: 'Internal matching error', rule_id: 'r.blind', path: '.forgejo/workflows/cd-deploy.yml', level: 'warn' },
    { type: ['PartialParsing', [{}]], rule_id: 'r.other', path: '.forgejo/workflows/renovate.yml', level: 'warn' },
  ];
  assert.deepEqual(summarizeBlindedRules(errors), [
    { ruleId: 'r.blind', errorCount: 4, fileCount: 3 },
    { ruleId: 'r.other', errorCount: 1, fileCount: 1 },
  ]);
});

// MEASURED in MCM, not assumed. In semgrep 1.169.0's JSON, a `PartialParsing` error carries the rule
// name ONLY inside its message prose; the structured `rule_id` field is absent. On the run that
// prompted MCM item #224, 36 of 39 errors were of that shape: reading `rule_id` alone reports 3.
test('the rule name is recovered from the message when the structured rule_id is absent', () => {
  const errors = [
    {
      code: 3,
      level: 'warn',
      type: ['PartialParsing', [{}]],
      path: '.forgejo/workflows/app-ci.yml',
      message: "Syntax error at line .forgejo/workflows/app-ci.yml:291:\n When parsing a snippet as Bash for metavariable-pattern in rule 'yaml.gha.gha-curl-pipe-shell', `bash scripts/ci-log-step.sh x bash -e /dev/stdin <<'CI` was unexpected",
    },
    {
      code: 2,
      level: 'warn',
      type: 'Internal matching error',
      rule_id: 'yaml.gha.gha-curl-pipe-shell',
      path: '.forgejo/workflows/cd-deploy.yml',
      message: 'Internal matching error when running yaml.gha.gha-curl-pipe-shell on .forgejo/workflows/cd-deploy.yml',
    },
  ];
  // Both forms are the SAME blinded rule and must aggregate into one row, not two.
  assert.deepEqual(summarizeBlindedRules(errors), [
    { ruleId: 'yaml.gha.gha-curl-pipe-shell', errorCount: 2, fileCount: 2 },
  ]);
});

test('an error carrying no rule_id is not attributed to a rule', () => {
  // A target that simply failed to parse is the SCANNER'S problem with a file, not a blinded rule.
  const errors = [
    { type: 'SyntaxError', path: 'src/broken.ts', level: 'warn' },
    { type: ['PartialParsing', [{}]], rule_id: null, path: 'src/other.ts', level: 'warn' },
  ];
  assert.deepEqual(summarizeBlindedRules(errors), []);
});

test('no errors, or a missing errors array, summarizes to nothing', () => {
  assert.deepEqual(summarizeBlindedRules([]), []);
  assert.deepEqual(summarizeBlindedRules(undefined), []);
});

test('a report carrying blindedRules still keeps the findings contract', () => {
  const report = buildFindingsReport({
    scope: 'full',
    scanners: [
      {
        scanner: 'semgrep', status: 'ran', ran: true, findingCount: 0, error: null,
        blindedRules: [{ ruleId: 'r.blind', errorCount: 36, fileCount: 7 }],
      },
    ],
    findings: [],
  });
  assertReportContract(report);
});

// ── What --scope changed actually hands to Semgrep (MCM items #224, #426) ────
//
// On a pull request CI runs `--scope changed`, which passes an explicit target list. A rule can only
// fire on a file that is IN that list, so the target filter, not the rule, decides what a PR is gated
// on. MCM found workflow YAML (#224) and Dockerfiles (#426) missing from it, each only after a
// post-merge full scan reddened `main`.

test('a changed workflow file is scanned, so a PR adding curl-pipe-shell is gated before merge', () => {
  assert.equal(isScanTarget('.forgejo/workflows/guardrails.yml'), true);
  assert.equal(isScanTarget('.forgejo/workflows/app-ci.yaml'), true);
  assert.equal(isScanTarget('.github/workflows/release.yml'), true);
});

test('the first-party code surfaces are scan targets', () => {
  for (const p of [
    'backend/example-service/src/logger.ts',
    'frontend/example-app/app/index.tsx',
    'agents/example-agent/src/graph.py',
    'scripts/sast-scan.mjs',
    'scripts/lib/scanner-retry.mjs',
  ]) assert.equal(isScanTarget(p), true, p);
});

test('YAML outside the workflow trees stays out of the changed set', () => {
  // Widening the filter to every .yml would pull compose files and the security config tree into a
  // PR-scoped scan against packs written for TS/JS/Python code.
  for (const p of [
    'infrastructure-as-code/docker-compose.yml',
    'security/sast/allowlist.yaml',
    '.forgejo/workflows/nested/deep.yml',
    'renovate.json',
    'backend/example-service/src/main.rs',
    'README.md',
  ]) assert.equal(isScanTarget(p), false, p);
});

test('a changed Dockerfile is scanned, so a PR adding a USER-less one is gated before merge', () => {
  for (const p of [
    'infrastructure-as-code/docker/example/Dockerfile',
    'backend/example-service/Dockerfile',
    '.devcontainer/Dockerfile',
    '.devcontainer/toolchain.Dockerfile',
    'frontend/example-app/Dockerfile.prod',
    'Dockerfile',
  ]) assert.equal(isScanTarget(p), true, p);
});

test('the Dockerfile pattern does not drag in neighbours that merely mention the name', () => {
  for (const p of [
    '.dockerignore',
    'frontend/example-app/.dockerignore',
    'docs/runbooks/dockerfile-conventions.md',
    'infrastructure-as-code/docker/example/README.md',
  ]) assert.equal(isScanTarget(p), false, p);
});

// ── Custom-rule fixtures (MCM item #224) ─────────────────────────────────────
//
// `semgrep --test` SKIPS a rule with no fixture rather than failing on it. MCM measured "4/4 ✓ All
// tests passed" while five rule files sat in the directory. A green tick over a silently-skipped rule
// is the same false assurance as a blinded rule.

test('every custom rule is paired with a fixture semgrep --test will actually run', () => {
  const pairs = ruleFixturePairs();
  assert.ok(pairs.length >= 3, `expected the custom rules to be found (got ${pairs.length})`);
  const unfixtured = pairs.filter((p) => p.fixtures.length === 0).map((p) => p.rule);
  assert.deepEqual(
    unfixtured,
    [],
    'a rule with no fixture is SKIPPED by `semgrep --test`, not failed. Add a same-stem fixture: ' +
      '`<rule>.ts` / `<rule>.py` for a code rule, `<rule>.test.yml` for a YAML one.',
  );
});

test('a fixture file is never mistaken for a rule file', () => {
  // `--config security/sast/rules/` loads every .yaml/.yml in the directory as RULES, so the YAML
  // rule's fixture is named `.test.yml`.
  const pairs = ruleFixturePairs();
  assert.ok(!pairs.some((p) => /\.test\.ya?ml$/.test(p.rule)), 'a *.test.yml fixture must not be enumerated as a rule');
  const yamlRule = pairs.find((p) => p.rule === 'belay-ci-curl-pipe-shell.yaml');
  assert.ok(yamlRule, 'the YAML rule must be enumerated');
  assert.deepEqual(yamlRule.fixtures, ['belay-ci-curl-pipe-shell.test.yml']);
});

test('a rule directory with a rule but no fixture is reported unfixtured', () => {
  const dir = scratch('sast-rules-');
  writeFileSync(join(dir, 'belay-example.yaml'), 'rules: []\n');
  writeFileSync(join(dir, 'belay-paired.yaml'), 'rules: []\n');
  writeFileSync(join(dir, 'belay-paired.ts'), '// fixture\n');
  const pairs = ruleFixturePairs(dir);
  assert.deepEqual(pairs.filter((p) => !p.fixtures.length).map((p) => p.rule), ['belay-example.yaml']);
});

test('the MCM-bound rules are not ported (research R3)', () => {
  const rules = ruleFixturePairs().map((p) => p.rule);
  for (const r of rules) assert.match(r, /^belay-/, `custom rule ids are belay-*: ${r}`);
  for (const deferred of ['no-console-in-bff', 'auth-before-authz']) {
    assert.ok(!rules.some((r) => r.includes(deferred)), `${deferred} is deferred until BELAY has that surface`);
  }
});

// ── pip-audit surfaces: derived from git, never a hard-coded list ────────────
//
// MCM's list named its own four Python projects. BELAY derives the surfaces from tracked lockfiles
// under the monorepo project directories, so a new project is scanned by committing its `uv.lock`.
// A `pyproject.toml` with no `uv.lock` covering it cannot be audited frozen, and FAILS the scan
// rather than being silently skipped (MCM FR-021). These only run while pip-audit is enabled.

const pipNative = (name, version, id = 'PYSEC-2099-0001') => ({
  dependencies: [{ name, version, vulns: [{ id, aliases: [`CVE-2099-${id.slice(-4)}`], fix_versions: [] }] }],
});

test('Python projects are discovered from tracked lockfiles under the project directories', () => {
  const root = fixtureRepo({
    'agents/example-agent/pyproject.toml': '[project]\nname = "x"\n',
    'agents/example-agent/uv.lock': 'version = 1\n',
    'mcp-servers/example-mcp/pyproject.toml': '[project]\nname = "y"\n',
    'mcp-servers/example-mcp/uv.lock': 'version = 1\n',
    'scripts/fixtures/uv.lock': 'version = 1\n', // not a project directory: ignored
  });
  const found = discoverPythonProjects(root);
  assert.deepEqual(pythonSurfaces(found).map((s) => s.project), ['agents/example-agent', 'mcp-servers/example-mcp']);
  assert.doesNotThrow(() => assertPythonSurfacesAuditable(found));
});

test('a workspace member covered by an ancestor uv.lock is not reported unlocked', () => {
  const root = fixtureRepo({
    'tools/py-workspace/pyproject.toml': '[tool.uv.workspace]\n',
    'tools/py-workspace/uv.lock': 'version = 1\n',
    'tools/py-workspace/members/a/pyproject.toml': '[project]\nname = "a"\n',
  });
  const found = discoverPythonProjects(root);
  assert.deepEqual(found.unlocked, []);
  assert.deepEqual(pythonSurfaces(found).map((s) => s.project), ['tools/py-workspace']);
});

test('a Python project with no uv.lock FAILS the scan, naming it, rather than being skipped', () => {
  const root = fixtureRepo({
    'agents/locked/pyproject.toml': '[project]\nname = "a"\n',
    'agents/locked/uv.lock': 'version = 1\n',
    'backend/unlocked-service/pyproject.toml': '[project]\nname = "b"\n',
  });
  assert.throws(() => assertPythonSurfacesAuditable(discoverPythonProjects(root)), /backend\/unlocked-service/);
});

test('pip-audit enabled with NO Python project fails rather than reporting a clean audit', () => {
  const root = fixtureRepo({ 'README.md': 'x\n' });
  assert.throws(() => assertPythonSurfacesAuditable(discoverPythonProjects(root)), /no Python project|refusing/i);
});

test('a pip-audit finding location is project-qualified', () => {
  const [f] = normalizePipAudit(pipNative('click', '8.5.0'), null, null, MAP, 'mcp-servers/example-mcp');
  assert.equal(f.location, 'mcp-servers/example-mcp:click@8.5.0');
});

test('the same advisory in two projects yields separately suppressible findings', () => {
  const [a] = normalizePipAudit(pipNative('click', '8.5.0'), null, null, MAP, 'agents/example-agent');
  const [b] = normalizePipAudit(pipNative('click', '8.5.0'), null, null, MAP, 'mcp-servers/example-mcp');
  assert.notEqual(a.location, b.location);
  const anchored = new RegExp('^agents/example-agent:click@.*');
  assert.ok(anchored.test(a.location));
  assert.ok(!anchored.test(b.location));
});

test('a pip-audit suppression anchored to an UNKNOWN surface fails, naming the entry', () => {
  const surfaces = [{ project: 'mcp-servers/example-mcp', dir: 'mcp-servers/example-mcp' }];
  const entry = (locationPattern) => ({ scanner: 'pip-audit', id: 'PYSEC-2099-0001', locationPattern });
  assert.throws(() => assertPipAuditAllowlistShape([entry('^mcp-servers/ghost-mcp:click@.*')], surfaces), /ghost-mcp/);
  // Unqualified form anchored at a package name can never match a qualified location.
  assert.throws(() => assertPipAuditAllowlistShape([entry('^click@.*')], surfaces), /click/);
  assert.doesNotThrow(() => assertPipAuditAllowlistShape([entry('^mcp-servers/example-mcp:click@.*')], surfaces));
  // A deliberate cross-surface entry stays legitimate.
  assert.doesNotThrow(() => assertPipAuditAllowlistShape([entry('click@.*')], surfaces));
  // Other scanners are not subject to this shape rule.
  assert.doesNotThrow(() =>
    assertPipAuditAllowlistShape([{ scanner: 'cargo-audit', id: 'RUSTSEC-1', locationPattern: '^foo@.*' }], surfaces));
});

test('pip-audit is given its own --cache-dir, so it never asks platformdirs for one', () => {
  // platformdirs >= 4.14.8 refuses a user cache dir under a world-writable ancestor, which is what
  // `/root/.cache` is in a CI container: every MCM pip-audit run died with a PermissionError.
  assert.deepEqual(pipAuditCacheArgs('/tmp/belay-pip-audit-x'), ['--cache-dir', '/tmp/belay-pip-audit-x/pip-audit']);
  const src = readFileSync(ORCH, 'utf8');
  const call = src.split('\n').find((line) => line.includes("'--with', 'pip-audit', 'pip-audit'"));
  assert.ok(call, 'the pip-audit invocation was not found: this guard is reading the wrong thing');
  assert.match(call, /\.\.\.pipAuditCacheArgs\(cacheDir\)/);
  assert.match(src, /mkdtempSync\(join\(tmpdir\(\), 'belay-pip-audit-'\)\)/);
});

// ── pnpm-audit covers EVERY committed pnpm lockfile (MCM item #721) ──────────
//
// `pnpm audit` run at the repository root reads ONLY the root lockfile: a nested workspace with its
// own pnpm-workspace.yaml is a different project to pnpm. MCM had one such tree audited by nothing.
// The audit set is DISCOVERED from git, and this guard compares it with an independent `git ls-files`.

function committedPnpmLockfiles() {
  const r = spawnSync('git', ['ls-files', '-z', '--', '*pnpm-lock.yaml'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ls-files failed: ${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean).sort();
}

test('every committed pnpm-lock.yaml is in the pnpm-audit set', () => {
  const committed = committedPnpmLockfiles();
  assert.ok(committed.includes('pnpm-lock.yaml'), 'the root lockfile must be committed');
  const audited = pnpmAuditSet().map((w) => w.lockfile).sort();
  const missing = committed.filter((l) => !audited.includes(l));
  assert.deepEqual(missing, [], `committed pnpm lockfile(s) NOT audited by sast-scan: ${missing.join(', ')}`);
});

test('a nested pnpm workspace is discovered and audited with --dir; the root without it', () => {
  const root = fixtureRepo({
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    'tools/nested-tool/pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
  });
  assert.deepEqual(pnpmAuditSet(root), [
    { lockfile: 'pnpm-lock.yaml', workspace: '.' },
    { lockfile: 'tools/nested-tool/pnpm-lock.yaml', workspace: 'tools/nested-tool' },
  ]);
  assert.deepEqual(pnpmAuditArgs('.', []), ['audit', '--json']);
  assert.deepEqual(pnpmAuditArgs('tools/nested-tool', ['--prod']), ['--dir', 'tools/nested-tool', 'audit', '--json', '--prod']);
});

test('no committed pnpm lockfile fails rather than reporting a clean JS audit', () => {
  assert.throws(() => pnpmAuditSet(fixtureRepo({ 'README.md': 'x\n' })), /no committed pnpm-lock\.yaml/);
});

const pnpmNative = (name, version, id = 'GHSA-xxxx-yyyy-zzzz', severity = 'high') => ({
  advisories: { 1: { id: 1, github_advisory_id: id, module_name: name, severity, title: 't', patched_versions: '<0.0.0', findings: [{ version }] } },
});

test('root pnpm-audit locations are bare; nested ones are workspace-qualified', () => {
  const [rootFinding] = normalizePnpmAudit(pnpmNative('braces', '3.0.3'), new Set(['1']), MAP, '.');
  const [nested] = normalizePnpmAudit(pnpmNative('braces', '3.0.3'), new Set(['1']), MAP, 'tools/nested-tool');
  assert.equal(rootFinding.location, 'braces@3.0.3');
  assert.equal(nested.location, 'tools/nested-tool:braces@3.0.3');
  // A root entry anchored at the package name does NOT silently extend to another workspace's tree.
  const rootEntry = new RegExp('^braces@3\\.0\\.3$');
  assert.ok(rootEntry.test(rootFinding.location));
  assert.ok(!rootEntry.test(nested.location));
  assert.equal(nested.scope, 'runtime');
  assert.equal(nested.blocking, true);
});

test('a pnpm advisory absent from the --prod audit is dev scope and does not block', () => {
  const [f] = normalizePnpmAudit(pnpmNative('braces', '3.0.3'), new Set(), MAP, '.');
  assert.equal(f.scope, 'dev');
  assert.equal(f.severity, 'High');
  assert.equal(f.blocking, false);
});

// ── cargo-audit: Rust lockfiles discovered from git (only while enabled) ────

test('every committed Cargo.lock is discovered; a nested one carries its workspace', () => {
  const root = fixtureRepo({
    'backend/example-crate/Cargo.lock': '# lock\n',
    'Cargo.lock': '# lock\n',
  });
  assert.deepEqual(cargoAuditSet(root), [
    { lockfile: 'Cargo.lock', workspace: '.' },
    { lockfile: 'backend/example-crate/Cargo.lock', workspace: 'backend/example-crate' },
  ]);
  assert.equal(cargoFindingLocation('.', 'serde', '1.0.0'), 'serde@1.0.0');
  assert.equal(cargoFindingLocation('backend/example-crate', 'serde', '1.0.0'), 'backend/example-crate:serde@1.0.0');
});

test('cargo-audit enabled with no committed Cargo.lock fails rather than reporting clean', () => {
  assert.throws(() => cargoAuditSet(fixtureRepo({ 'README.md': 'x\n' })), /no committed Cargo\.lock/);
});
