// Where the SAST gate and its allowlist-expiry tier are WIRED, asserted statically.
//
// Ported from MovieCollectionManager (MCM) at fc2b953 (its features 057 and 058, items #418/#484/
// #485), as part of BELAY feature 006, and ADAPTED: MCM's version pins a weekly `--check-expiring`
// step and its status recorder in an `infra-image-scan` workflow BELAY does not have. What carries
// over is every rule that is about the wiring rather than about that workflow:
//
//   * The SAST gate runs in `guardrails.yml`'s `sast` job (research R2) on pull requests, with its
//     selftest BEFORE the real scan and the real gate AFTER it. An absent step and a passing step
//     look identical from the job's tick, and this forge exposes no jobs/steps endpoint to read a
//     run's step list back — so the wiring is pinned here instead.
//
//   * `--check-expiring` is report-only and fails on allowlist hygiene alone. It must never run on a
//     pull-request trigger: a red expiry check there would block every PR the moment an entry entered
//     the 14-day window — a failure that is scheduled, not immediate. BELAY runs it nowhere yet; the
//     guard keeps any future copy schedule-guarded.
//
//   * Both selftest-then-scan gates that read a security allowlist or override map run in
//     `scripts:lint`, which `guardrails / guardrails` runs on every pull request.
//
//   * Two general rules MCM found by mutation testing: every `steps.<id>` reference resolves, and
//     every failure-digest or status-posting step is `always()` + `continue-on-error`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = resolve(REPO_ROOT, '.forgejo/workflows');

const load = (rel) => parseYaml(readFileSync(resolve(WORKFLOWS, rel), 'utf8'));
const stepsOf = (workflow, job) => workflow?.jobs?.[job]?.steps ?? [];
const runText = (step) => (typeof step?.run === 'string' ? step.run : '');
const workflowFiles = () => readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'));
const lintCommands = () =>
  JSON.parse(readFileSync(resolve(REPO_ROOT, 'scripts/project.json'), 'utf8')).targets.lint.options.commands;

// ── The SAST gate in the `sast` job ───────────────────────────────────────────────────────────────

const GATE_SELFTEST = /check-sast-findings\.mjs --selftest\s*$/;
// The real gate: the script with NO flag, at the end of the command line.
const GATE_REAL = /check-sast-findings\.mjs\s*$/;
const SCAN = /sast-scan\.mjs --scope /;

test('the SAST gate runs in guardrails.yml\'s sast job: selftest, then the scan, then the real gate', () => {
  const guardrails = load('guardrails.yml');
  const steps = stepsOf(guardrails, 'sast');
  assert.ok(steps.length > 0, 'guardrails.yml has no `sast` job (research R2)');

  const indexWhere = (re) => steps.map((s, i) => (re.test(runText(s).trim()) ? i : -1)).filter((i) => i >= 0);
  const selftest = indexWhere(GATE_SELFTEST);
  const gate = steps
    .map((s, i) => (GATE_REAL.test(runText(s).trim()) && !GATE_SELFTEST.test(runText(s).trim()) ? i : -1))
    .filter((i) => i >= 0);
  const scan = steps.map((s, i) => (SCAN.test(runText(s)) ? i : -1)).filter((i) => i >= 0);

  assert.equal(selftest.length, 1, 'expected exactly one `check-sast-findings.mjs --selftest` step in the sast job');
  assert.equal(gate.length, 1, 'expected exactly one un-flagged `check-sast-findings.mjs` gate step in the sast job');
  assert.equal(scan.length, 1, 'expected exactly one `sast-scan.mjs --scope …` step in the sast job');
  assert.ok(selftest[0] < scan[0], 'the gate selftest must run BEFORE the real scan, so a broken gate cannot pass vacuously');
  assert.ok(scan[0] < gate[0], 'the gate must run AFTER the scan that writes its report');
});

test('the SAST gate is not event-guarded, and guardrails serves pull requests', () => {
  const guardrails = load('guardrails.yml');
  const steps = stepsOf(guardrails, 'sast');
  for (const step of steps.filter((s) => /check-sast-findings\.mjs/.test(runText(s)))) {
    assert.equal(
      step.if,
      undefined,
      `"${step.name}" is event-guarded (if: ${JSON.stringify(step.if)}) — blocking a new High/Critical before merge is its purpose`,
    );
  }
  assert.ok(
    Object.prototype.hasOwnProperty.call(guardrails.on ?? {}, 'pull_request'),
    'guardrails no longer runs on pull_request, so the SAST gate would not block a pull request',
  );
});

// ── --check-expiring never on a pull request ──────────────────────────────────────────────────────

test('no workflow runs --check-expiring unless the step is guarded to schedule events', () => {
  // A copy without the guard would block every pull request once an entry entered the window.
  const offenders = [];
  for (const file of workflowFiles()) {
    const wf = load(file);
    for (const [jobName, job] of Object.entries(wf?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (!runText(step).includes('--check-expiring')) continue;
        if (!/github\.event_name\s*==\s*'schedule'/.test(String(step.if ?? ''))) {
          offenders.push(`${file}:${jobName} — "${step.name ?? '(unnamed)'}" (if: ${JSON.stringify(step.if)})`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `--check-expiring must be guarded to schedule events:\n  ${offenders.join('\n  ')}`);
});

// ── scripts:lint carries the selftest-then-scan gates ─────────────────────────────────────────────

test('scripts:lint runs the SAST gate selftest (the real gate needs a scan report, so it runs in the sast job)', () => {
  const commands = lintCommands();
  assert.ok(
    commands.includes('node scripts/check-sast-findings.mjs --selftest'),
    'scripts:lint must run `node scripts/check-sast-findings.mjs --selftest` (T016)',
  );
  assert.ok(
    !commands.includes('node scripts/check-sast-findings.mjs'),
    'the un-flagged gate reads security/sast/reports/findings.json, which scripts:lint does not produce',
  );
});

test('the override-consistency gate runs in scripts:lint, selftest-then-scan, on every pull request', () => {
  const commands = lintCommands();
  const selftest = commands.indexOf('node scripts/check-override-consistency.mjs --selftest');
  const scan = commands.indexOf('node scripts/check-override-consistency.mjs');
  assert.ok(selftest >= 0, 'scripts:lint must prove the override-consistency detection');
  assert.ok(scan > selftest, 'scripts:lint must run the real override-consistency scan after its selftest');

  const guardrails = load('guardrails.yml');
  const lintStep = stepsOf(guardrails, 'guardrails').filter((s) => /pnpm nx run scripts:lint\s*$/.test(runText(s).trim()));
  assert.equal(lintStep.length, 1, 'the guardrails job must run scripts:lint');
  assert.equal(lintStep[0].if, undefined, 'scripts:lint must not be event-guarded');
});

// ── General rules: dangling step references, and reporters that go silent ─────────────────────────

test('every steps.<id>.outcome reference resolves to a step that HAS that id', () => {
  // A dangling reference does not error: the runner resolves it to the empty string, so a recorder
  // carrying it publishes `<unset>` for ever. Measured in MCM by mutation: deleting a step's `id:`
  // left every string-matching assertion green.
  const dangling = [];
  for (const file of workflowFiles()) {
    const wf = load(file);
    for (const [jobName, job] of Object.entries(wf?.jobs ?? {})) {
      const steps = job?.steps ?? [];
      const ids = new Set(steps.map((st) => st?.id).filter(Boolean));
      for (const st of steps) {
        const text = `${runText(st)} ${Object.values(st?.env ?? {}).map(String).join(' ')} ${String(st?.if ?? '')}`;
        for (const [, id] of text.matchAll(/steps\.([A-Za-z0-9_-]+)\.(?:outcome|conclusion|outputs)/g)) {
          if (!ids.has(id)) dangling.push(`${file}:${jobName} — "${st.name ?? '(unnamed)'}" references steps.${id}, but no step in that job has id: ${id}`);
        }
      }
    }
  }
  assert.deepEqual(
    dangling,
    [],
    `these references resolve to the EMPTY STRING at runtime rather than erroring:\n  ${dangling.join('\n  ')}`,
  );
});

test('every status-posting / failure-digest step in EVERY workflow is always()-guarded', () => {
  // A reporter ordered after a failable step without `always()` reports nothing on precisely the runs
  // worth reporting. Detected by BEHAVIOUR (the step POSTs a commit status, or runs the failure
  // digest), not by name, so real work that must skip on failure is never swept in.
  const files = workflowFiles();
  assert.ok(files.length >= 3, `expected the workflow set, found ${files.length} — is the path right?`);

  const offenders = [];
  let reporters = 0;
  for (const file of files) {
    const wf = load(file);
    for (const [jobName, job] of Object.entries(wf?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (!/\/statuses\/|ci-failure-digest\.mjs/.test(runText(step))) continue;
        reporters += 1;
        const guarded = /always\(\)/.test(String(step.if ?? '')) && step['continue-on-error'] === true;
        if (!guarded) {
          offenders.push(`${file}:${jobName} — ${step.name ?? '(unnamed)'} (if: ${JSON.stringify(step.if)}, continue-on-error: ${step['continue-on-error']})`);
        }
      }
    }
  }

  // Every BELAY workflow publishes a failure digest. Without this floor the assertion below is
  // vacuously true the moment the detector stops matching.
  assert.ok(reporters >= files.length, `the reporter detector matched only ${reporters} steps across ${files.length} workflows; it has stopped finding them`);
  assert.deepEqual(
    offenders,
    [],
    `these steps POST a status or publish a digest but are not always()-guarded, so they go silent ` +
      `on the runs that matter:\n  ${offenders.join('\n  ')}`,
  );
});
