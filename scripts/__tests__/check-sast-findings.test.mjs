// Guards the SAST/SCA gate (scripts/check-sast-findings.mjs) — BELAY feature 006, T015.
//
// Ported from MovieCollectionManager (MCM) at fc2b953 (its feature 033). Contract:
// specs/006-sast-stage1/contracts/sast-cli.md (unchanged from MCM's check-sast-findings.cli.md).
//
// Feeds synthetic normalized findings.json reports through the gate CLI as a subprocess and asserts
// exit codes:
//   (a) un-allowlisted blocking High → exit 1, finding named.
//   (b) same finding allowlisted → exit 0.
//   (c) High with scope: dev (blocking:false) → exit 0 (warned, not failed).
//   (d) clean report (no blocking) → exit 0.
//   (e) allowlist entry with blank justification → exit 2 (GateError).
//   (f) allowlist entry with a PAST expiry does NOT suppress → exit 1; future/absent → exit 0 (US3).
//   --selftest → exit 0 ; unparseable report → exit 2 ; unknown argument → exit 2.
//
// BELAY additions: the committed allowlist (comments only at first) is valid; the expiry warning
// tier is visible through the CLI, not only the selftest; and no secret value carried in a finding's
// free-text fields ever reaches the gate's output (FR-018).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(HERE, '..', 'check-sast-findings.mjs');
const COMMITTED_ALLOWLIST = resolve(HERE, '..', '..', 'security/sast/allowlist.yaml');

function finding(over = {}) {
  return {
    scanner: 'semgrep', kind: 'sast', id: 'belay-no-token-logging',
    title: 'Raw token logged', location: 'scripts/forge-client.mjs:42',
    ecosystem: null, nativeSeverity: 'ERROR', severity: 'High', scope: null,
    blocking: true, fixAvailable: null, ...over,
  };
}

function report(findings) {
  return { schemaVersion: 1, generatedAtScope: 'full', scanners: [], findings };
}

function runGate(reportObj, allowlistYaml, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'sast-gate-'));
  try {
    const reportPath = join(dir, 'findings.json');
    writeFileSync(reportPath, typeof reportObj === 'string' ? reportObj : JSON.stringify(reportObj));
    const args = ['--report', reportPath];
    if (allowlistYaml !== undefined) {
      const alPath = join(dir, 'allowlist.yaml');
      writeFileSync(alPath, allowlistYaml);
      args.push('--allowlist', alPath);
    }
    const r = spawnSync(process.execPath, [GATE, ...args, ...extraArgs], { encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** An ISO date `days` from today (UTC), so the CLI's own clock-read classifies it predictably. */
function isoDaysFromToday(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// (a) un-allowlisted blocking High → exit 1
test('(a) un-allowlisted blocking High fails the gate (exit 1) and names the finding', () => {
  const { code, out } = runGate(report([finding()]), '[]\n');
  assert.equal(code, 1);
  assert.match(out, /belay-no-token-logging/);
});

// (b) same finding allowlisted → exit 0
const MATCH_ALLOW = `
- scanner: "semgrep"
  id: "belay-no-token-logging"
  locationPattern: "scripts/forge-client\\\\.mjs:.*"
  justification: "False positive: logs a request id, not a token (triaged)."
  addedBy: "steve"
`;
test('(b) an allowlisted blocking High passes the gate (exit 0)', () => {
  const { code } = runGate(report([finding()]), MATCH_ALLOW);
  assert.equal(code, 0);
});

test('(b2) allowlisted finding stays visible in the printed report (FR-010)', () => {
  const { out } = runGate(report([finding()]), MATCH_ALLOW);
  assert.match(out, /belay-no-token-logging/, 'suppressed finding must still be shown, not hidden');
});

// (c) High but scope:dev (blocking:false) → exit 0 (warned)
test('(c) a High dev-scope (non-blocking) SCA finding does not fail the gate (exit 0)', () => {
  const dev = finding({ scanner: 'pnpm-audit', kind: 'sca', id: 'GHSA-x', location: 'esbuild@0.1.0', ecosystem: 'npm', scope: 'dev', blocking: false });
  const { code } = runGate(report([dev]), '[]\n');
  assert.equal(code, 0);
});

// (d) clean report → exit 0
test('(d) a clean report (no blocking findings) passes (exit 0)', () => {
  const { code } = runGate(report([]), '[]\n');
  assert.equal(code, 0);
});

// (e) blank justification → exit 2
test('(e) an allowlist entry with a blank justification is a gate error (exit 2)', () => {
  const bad = `
- scanner: "semgrep"
  id: "belay-no-token-logging"
  locationPattern: ".*"
  justification: ""
  addedBy: "steve"
`;
  const { code } = runGate(report([finding()]), bad);
  assert.equal(code, 2);
});

test('(e1) an allowlist entry with a blank addedBy is a gate error (exit 2)', () => {
  const bad = `
- scanner: "semgrep"
  id: "belay-no-token-logging"
  locationPattern: ".*"
  justification: "x"
  addedBy: "  "
`;
  const { code } = runGate(report([finding()]), bad);
  assert.equal(code, 2);
});

test('(e2) an allowlist entry with an invalid regex is a gate error (exit 2)', () => {
  const bad = `
- scanner: "semgrep"
  id: "belay-no-token-logging"
  locationPattern: "([unclosed"
  justification: "x"
  addedBy: "steve"
`;
  const { code } = runGate(report([finding()]), bad);
  assert.equal(code, 2);
});

test('(e3) an allowlist that is not a YAML list is a gate error (exit 2)', () => {
  const { code } = runGate(report([]), 'scanner: semgrep\n');
  assert.equal(code, 2);
});

// (f) expiry (US3)
test('(f) an allowlist entry with a PAST expiry does not suppress (exit 1)', () => {
  const expired = MATCH_ALLOW.trimEnd() + '\n  expiry: "2000-01-01"\n';
  const { code } = runGate(report([finding()]), expired);
  assert.equal(code, 1, 'a past-expiry entry must stop suppressing → the finding blocks again');
});

test('(f2) an allowlist entry with a FUTURE expiry still suppresses (exit 0)', () => {
  const future = MATCH_ALLOW.trimEnd() + '\n  expiry: "2999-01-01"\n';
  const { code } = runGate(report([finding()]), future);
  assert.equal(code, 0);
});

// The warning tier, through the CLI (the selftest proves it in-process with a fixed date).

test('(f3) an entry inside the 14-day window still suppresses, and is reported EXPIRING SOON', () => {
  const expiry = isoDaysFromToday(5);
  const { code, out } = runGate(report([finding()]), MATCH_ALLOW.trimEnd() + `\n  expiry: "${expiry}"\n`);
  assert.equal(code, 0, 'the warning tier must not move the exit code');
  assert.match(out, /EXPIRING SOON/);
  assert.match(out, new RegExp(`expires ${expiry}`));
  assert.match(out, /addedBy: steve/);
});

test('(f4) an expired entry re-blocks, and the failure says what used to cover it', () => {
  const expiry = isoDaysFromToday(-3);
  const { code, out } = runGate(report([finding()]), MATCH_ALLOW.trimEnd() + `\n  expiry: "${expiry}"\n`);
  assert.equal(code, 1);
  assert.match(out, /EXPIRED/);
  assert.match(out, new RegExp(`suppressed until ${expiry} by an entry added by steve`));
});

test('(f5) an entry matching nothing, while its scanner produced findings, is reported UNMATCHED', () => {
  const stale = `
- scanner: "semgrep"
  id: "belay-rule-that-no-longer-fires"
  locationPattern: ".*"
  justification: "x"
  addedBy: "steve"
`;
  const { code, out } = runGate(report([finding({ severity: 'Medium', blocking: false })]), stale);
  assert.equal(code, 0, 'allowlist hygiene is advisory on a normal run');
  assert.match(out, /UNMATCHED ENTRIES/);
  assert.match(out, /belay-rule-that-no-longer-fires/);
});

test('(f6) an unmatched entry whose scanner produced NO findings is not reported', () => {
  // cargo-audit and pip-audit are not enabled in stage 1: their entries must not read as stale.
  const notEnabled = `
- scanner: "pip-audit"
  id: "PYSEC-2026-0001"
  locationPattern: ".*"
  justification: "x"
  addedBy: "steve"
`;
  const { code, out } = runGate(report([finding({ severity: 'Medium', blocking: false })]), notEnabled);
  assert.equal(code, 0);
  assert.doesNotMatch(out, /UNMATCHED ENTRIES/);
});

// different un-allowlisted blocking finding still fails despite an allowlist
test('a blocking finding not covered by the allowlist still fails (exit 1)', () => {
  const other = finding({ id: 'belay-no-jwt-payload-tracing', location: 'scripts/other.mjs:9' });
  const { code, out } = runGate(report([other]), MATCH_ALLOW);
  assert.equal(code, 1);
  assert.match(out, /belay-no-jwt-payload-tracing/);
});

// runtime SCA High blocks
test('a runtime-scope SCA High blocks (exit 1)', () => {
  const rt = finding({ scanner: 'cargo-audit', kind: 'sca', id: 'RUSTSEC-1', location: 'foo@1.0', ecosystem: 'cargo', scope: 'runtime', nativeSeverity: 'unscored' });
  const { code } = runGate(report([rt]), '[]\n');
  assert.equal(code, 1);
});

// --selftest
test('--selftest proves the gate paths (exit 0)', () => {
  const r = spawnSync(process.execPath, [GATE, '--selftest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

// unparseable report → exit 2
test('an unparseable report is a gate error (exit 2)', () => {
  const { code } = runGate('{ not json', '[]\n');
  assert.equal(code, 2);
});

test('a report with no generatedAtScope is an invalid report (exit 2), never a blocking-finding exit 1', () => {
  // The gate-scope symmetry check cannot run without the scope, and refuses rather than skipping.
  // BELAY fix: in MCM that refusal escaped main() as an uncaught throw, exiting 1 — the code that
  // means "un-allowlisted blocking finding" — for what the contract calls an invalid report.
  const { code, out } = runGate({ schemaVersion: 1, scanners: [], findings: [] }, '[]\n');
  assert.equal(code, 2, out);
  assert.match(out, /generatedAtScope/);
});

test('an unknown argument is a usage error (exit 2)', () => {
  const { code, out } = runGate(report([]), '[]\n', ['--no-such-flag']);
  assert.equal(code, 2);
  assert.match(out, /Unknown argument: --no-such-flag/);
});

// ── The committed allowlist ──────────────────────────────────────────────────

test('the committed security/sast/allowlist.yaml loads (a comments-only file is an empty list)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sast-gate-'));
  try {
    const reportPath = join(dir, 'findings.json');
    writeFileSync(reportPath, JSON.stringify(report([])));
    const ok = spawnSync(process.execPath, [GATE, '--report', reportPath, '--allowlist', COMMITTED_ALLOWLIST], { encoding: 'utf8' });
    assert.equal(ok.status, 0, `the committed allowlist must be valid:\n${ok.stdout}${ok.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an allowlist holding only comments suppresses nothing and is not an error', () => {
  const commentsOnly = '# header only\n# - scanner: "semgrep"\n';
  assert.equal(runGate(report([]), commentsOnly).code, 0);
  assert.equal(runGate(report([finding()]), commentsOnly).code, 1);
});

// ── FR-018: the gate never prints a secret value ─────────────────────────────
//
// The gate prints finding METADATA only (scanner, severity, id, location). A scanner's free text —
// the title, or a raw `message` carried through from native output — can quote the matched source
// line, and a matched source line can hold a live credential. Built from fragments so this file is
// not itself a secret-scan hit.

const CREDENTIAL = ['gh', 'p_', 'Zq3', 'x'.repeat(33)].join('');

test('FR-018: a credential in a finding\'s title or message never reaches the gate output', () => {
  const leaky = (over) => finding({
    title: `Raw token logged: Authorization: token ${CREDENTIAL}`,
    message: `console.log("token=${CREDENTIAL}")`,
    ...over,
  });
  // Every section the gate prints a finding in: blocking, warning, allowlisted, and the review.
  const cases = [
    runGate(report([leaky()]), '[]\n'),
    runGate(report([leaky({ severity: 'Medium', blocking: false })]), '[]\n'),
    runGate(report([leaky()]), MATCH_ALLOW),
    runGate(report([leaky()]), MATCH_ALLOW.trimEnd() + `\n  expiry: "${isoDaysFromToday(3)}"\n`),
  ];
  for (const { out } of cases) {
    // The finding WAS printed (by its id and location), so the absence below is evidence.
    assert.match(out, /belay-no-token-logging — scripts\/forge-client\.mjs:42/,
      'the gate did not print the finding at all — the no-secret assertion below would be vacuous');
    assert.ok(!out.includes(CREDENTIAL), `the gate printed a secret value:\n${out}`);
    assert.ok(!out.includes(CREDENTIAL.slice(4, 20)), 'a fragment of the secret value was printed');
  }
});

// ── Blinded rules ────────────────────────────────────────────────────────────
//
// The gate's own diagnostic used to offer exactly two explanations for an allowlist entry that
// suppressed nothing — remediated, or the scanner changed identifier namespace — and a rule that had
// gone BLIND reads as the first. Measured in MCM: `gha-curl-pipe-shell` re-parses a step's `run:`
// block as Bash, cannot read the ci-log-step heredoc wrapping nearly every run-step (BELAY wraps its
// steps the same way), and produced 36 errors with 0 findings while six `curl … | sh` lines sat in
// the workflows. The report carried the evidence in the scanner's errors[]; the gate never read it.

const BLIND = (over = {}) => ({
  schemaVersion: 1,
  generatedAtScope: 'full',
  scanners: [
    {
      scanner: 'semgrep', ran: true, findingCount: 1, error: null,
      blindedRules: [{ ruleId: 'yaml.gha.gha-curl-pipe-shell', errorCount: 36, fileCount: 7 }],
    },
  ],
  findings: [finding()],
  ...over,
});

const BLIND_ALLOW = `
- scanner: "semgrep"
  id: "yaml.gha.gha-curl-pipe-shell"
  locationPattern: "\\\\.forgejo/workflows/.*"
  justification: "Accepted CI bootstrap."
  addedBy: "steve"
- scanner: "semgrep"
  id: "belay-no-token-logging"
  locationPattern: "scripts/forge-client\\\\.mjs:.*"
  justification: "False positive."
  addedBy: "steve"
`;

test('(h) a rule the scanner could not run is reported, and does not change the exit code', () => {
  const r = runGate(BLIND(), MATCH_ALLOW);
  assert.match(r.out, /COULD NOT RUN|BLINDED/i, 'the blinded rule must be surfaced');
  assert.match(r.out, /gha-curl-pipe-shell/);
  assert.match(r.out, /36/, 'the error count is the evidence — print it');
  assert.equal(r.code, 0, 'advisory only: a blinded rule must not move the gate result');
});

test('(h2) an UNMATCHED entry whose rule could not run is told so, in place of the two wrong causes', () => {
  const r = runGate(BLIND(), BLIND_ALLOW);
  assert.match(r.out, /UNMATCHED ENTRIES/);
  const unmatchedBlock = r.out.slice(r.out.indexOf('UNMATCHED ENTRIES'));
  assert.match(
    unmatchedBlock,
    /gha-curl-pipe-shell[\s\S]*?could not run[\s\S]*?36/,
    'the entry must carry the rule\'s own error count, not just the generic three-cause wording',
  );
});

test('(h3) with no blinded rules the report is silent about them', () => {
  const clean = BLIND({
    scanners: [{ scanner: 'semgrep', ran: true, findingCount: 1, error: null, blindedRules: [] }],
  });
  const r = runGate(clean, MATCH_ALLOW);
  assert.doesNotMatch(r.out, /COULD NOT RUN/i);
  assert.equal(r.code, 0);
});

test('(h4) a report from before this field existed is handled, not crashed on', () => {
  // findings.json is written by a separate script and read by this one; a stale report (or an
  // `--only` run of another scanner) simply has no blindedRules. Absence is nothing to say.
  const r = runGate(report([finding()]), MATCH_ALLOW);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /COULD NOT RUN/i);
});
