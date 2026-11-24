// Pins .forgejo/workflows/guardrails.yml to its contract
// (specs/001-guardrails-ci/contracts/guardrails-workflow.md). The workflow is what branch
// protection on `main` requires, so a quiet change to its triggers, runner, Node version or
// steps would weaken every merge without anyone noticing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const WORKFLOW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.forgejo', 'workflows', 'guardrails.yml');
const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE = 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1';
const NODE_VERSION = '26.13.1';

const load = () => parse(readFileSync(WORKFLOW, 'utf8'));

test('triggers: pull_request on any branch, push only to main, manual dispatch', () => {
  // YAML 1.2 keeps the `on` key as the string "on".
  const on = load().on;
  assert.deepEqual(Object.keys(on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(on.push.branches, ['main'], 'push must be scoped to main, or one push to a PR branch runs twice');
  assert.ok(on.pull_request === null || Object.keys(on.pull_request).length === 0, 'pull_request must stay unscoped');
});

test('concurrency: one run per ref, a newer run cancels an older one', () => {
  const { concurrency } = load();
  assert.equal(concurrency.group, 'guardrails-${{ github.ref }}');
  assert.equal(concurrency['cancel-in-progress'], true);
});

test('two jobs, guardrails and sast, each on the belay runner label with a timeout', () => {
  const { jobs } = load();
  assert.deepEqual(Object.keys(jobs), ['guardrails', 'sast'], 'sast is a separate job so guardrails keeps its run time');
  assert.equal(jobs.guardrails['runs-on'], 'belay', 'BELAY jobs run on its own repository runner (ci-belay), never the shared global one');
  assert.equal(jobs.guardrails['timeout-minutes'], 10);
});

test('steps run in contract order with pinned actions, Node 26 and the Nx targets', () => {
  const steps = load().jobs.guardrails.steps;
  assert.equal(steps.length, 7, 'the contract defines exactly seven steps');
  assert.equal(steps[0].uses, CHECKOUT);
  assert.equal(steps[1].uses, SETUP_NODE);
  assert.equal(String(steps[1].with['node-version']), NODE_VERSION);
  // Every run step goes through ci-log-step.sh, so an install failure still reaches the digest
  // with its output and a failing-step marker (enforced by check-ci-digest-coverage.mjs).
  assert.equal(steps[2].run.trim(), 'bash scripts/ci-log-step.sh guardrails-install-pnpm bash scripts/install-pnpm.sh');
  assert.equal(steps[3].run.trim(), 'bash scripts/ci-log-step.sh guardrails-install-deps pnpm install --frozen-lockfile');
  assert.equal(steps[4].run.trim(), 'bash scripts/ci-log-step.sh guardrails-lint pnpm nx run scripts:lint');
  assert.equal(steps[5].run.trim(), 'bash scripts/ci-log-step.sh guardrails-test pnpm nx run scripts:test');
});

test('the last step publishes the failure digest and can never change the job outcome', () => {
  const digest = load().jobs.guardrails.steps.at(-1);
  assert.equal(digest.if, 'always()');
  assert.equal(digest['continue-on-error'], true);
  assert.equal(digest.run.trim(), 'node scripts/ci-failure-digest.mjs');
  assert.equal(digest.env.CI_DIGEST_TOKEN, '${{ secrets.CI_DIGEST_TOKEN }}');
  assert.equal(digest.env.GITHUB_TOKEN, '${{ github.token }}');
  assert.equal(digest.env.CI_DIGEST_JOB_STATUS, '${{ job.status }}');
});

// ── The sast job (feature 006, SAST stage 1). MCM's feature-033 job is the baseline; Rust and the
// Python env syncs are stages 2 and 3, so they must not appear here until those stages land.
const UPLOAD_ARTIFACT = 'actions/upload-artifact@ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5';
const sastJob = () => load().jobs.sast;
const stepNamed = (re) => sastJob().steps.find((st) => re.test(st.name ?? ''));

test('sast runs on the belay runner, keyless, with a bounded timeout', () => {
  const job = sastJob();
  assert.equal(job['runs-on'], 'belay');
  assert.equal(job['timeout-minutes'], 15);
  const secrets = JSON.stringify(job).match(/secrets\.[A-Z_]+/g) ?? [];
  assert.deepEqual([...new Set(secrets)], ['secrets.CI_DIGEST_TOKEN'], 'the scan itself needs no secret; only the digest step reads one');
});

test('sast checks out full history and pins Node before any Node use', () => {
  const steps = sastJob().steps;
  assert.equal(steps[0].uses, CHECKOUT);
  assert.equal(steps[0].with['fetch-depth'], 0, 'the changed-files scope diffs against the PR base');
  assert.equal(steps[1].uses, SETUP_NODE);
  assert.equal(String(steps[1].with['node-version']), NODE_VERSION);
});

test('uv is installed from a PINNED installer URL, never an unversioned one', () => {
  const run = stepNamed(/install uv/i).run;
  assert.match(run, /https:\/\/astral\.sh\/uv\/\d+\.\d+\.\d+\/install\.sh/);
  assert.doesNotMatch(run, /astral\.sh\/uv\/install\.sh/);
});

test('sast proves its instruments before the scan, then gates on the report', () => {
  const runs = sastJob().steps.map((st) => (st.run ?? '').trim());
  const at = (needle) => runs.findIndex((r) => r.includes(needle));
  const selftest = at('node scripts/check-sast-findings.mjs --selftest');
  const rules = at('node scripts/sast-scan.mjs --test-rules');
  const scan = at('node scripts/sast-scan.mjs --scope');
  const gate = runs.findIndex((r) => /check-sast-findings\.mjs\s*$/.test(r));
  assert.ok(selftest > 0 && rules > selftest && scan > rules && gate > scan, `order: selftest ${selftest}, rules ${rules}, scan ${scan}, gate ${gate}`);
  assert.match(runs[scan], /--scope changed --base "origin\/\$BASE_REF"/);
  assert.match(runs[scan], /--scope full/);
});

// Feature 007 (item #43): a PR must not move a package INTO a known advisory, in any scope. The check
// reads the pnpm-audit native report the scan writes, so it must run after the scan; it runs after the
// gate so a plain blocking finding is reported first. PR-only: a push has no base to regress from.
// A gate that is never invoked is indistinguishable from no gate.
test('the dependency-downgrade check runs on PRs only, after the gate, against the PR base', () => {
  const steps = sastJob().steps;
  const runs = steps.map((st) => (st.run ?? '').trim());
  const scan = runs.findIndex((r) => r.includes('node scripts/sast-scan.mjs --scope'));
  const gate = runs.findIndex((r) => /check-sast-findings\.mjs\s*$/.test(r));
  const at = runs.findIndex((r) => r.includes('node scripts/check-dependency-downgrade.mjs'));
  assert.ok(at > 0, 'the downgrade step is gone — update this guard rather than deleting it');
  assert.ok(scan > 0 && gate > scan && at === gate + 1, `order: scan ${scan}, gate ${gate}, downgrade ${at} (must follow the gate directly)`);
  const step = steps[at];
  assert.equal(step.if, "${{ github.event_name == 'pull_request' }}", 'the check needs a PR base, so it must be PR-scoped');
  assert.equal(step.env?.BASE_REF, '${{ github.base_ref }}');
  assert.equal(
    runs[at],
    'bash scripts/ci-log-step.sh sast-downgrade-gate node scripts/check-dependency-downgrade.mjs --base "origin/$BASE_REF"',
  );
});

test('the reports are uploaded whatever the outcome, and the digest is the last step', () => {
  const steps = sastJob().steps;
  const upload = steps.find((st) => st.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.uses, UPLOAD_ARTIFACT);
  assert.equal(upload.if, '${{ always() }}');
  assert.equal(upload.with.path, 'security/sast/reports/');
  const digest = steps.at(-1);
  assert.equal(digest.run.trim(), 'node scripts/ci-failure-digest.mjs');
  assert.equal(digest.if, 'always()');
  assert.equal(digest['continue-on-error'], true);
});

// Feature 008 updated this guard at the cause. Its premise was "stage 1 only: no Rust toolchain,
// cargo-audit or Python env sync in the job". The stage-2/3 toolchains are now IN the job, dormant,
// behind scripts/sast-prepare.mjs, which installs only from pinned, digest-verified files when a
// lockfile is tracked. So the new premise: the job itself still never compiles cargo-audit, never pipes
// rustup, and never syncs Python inline. Every one of those lives in the prepare script, or nowhere.
test('Rust and Python toolchains arrive only through sast-prepare.mjs, never inline in the job', () => {
  const text = JSON.stringify(sastJob());
  assert.doesNotMatch(text, /rustup|sh\.rustup\.rs|cargo install|uv sync/);
});

test('the dormant stage-2/3 prepare steps run through ci-log-step.sh, after uv, before the scan', () => {
  const runs = sastJob().steps.map((st) => (st.run ?? '').trim());
  const uv = runs.findIndex((r) => r.includes('ci-log-step.sh sast-install-uv'));
  const rust = runs.indexOf('bash scripts/ci-log-step.sh sast-prepare-rust node scripts/sast-prepare.mjs rust');
  const python = runs.indexOf('bash scripts/ci-log-step.sh sast-prepare-python node scripts/sast-prepare.mjs python');
  const scan = runs.findIndex((r) => r.includes('node scripts/sast-scan.mjs --scope'));
  assert.ok(rust > 0 && python > 0, 'a prepare step is gone — update this guard rather than deleting it');
  assert.ok(uv > 0 && rust > uv && python > uv, `uv ${uv} must precede both prepare steps (rust ${rust}, python ${python}): python needs uv`);
  assert.ok(rust < scan && python < scan, `both must precede the scan (${scan}), which needs what they install`);
  // Unconditional on purpose: each step decides from the TRACKED lockfiles, which a workflow `if:`
  // cannot see. A condition here would be a second, drifting copy of that decision.
  for (const at of [rust, python]) assert.equal(sastJob().steps[at].if, undefined);
});

// ── feature 011: the dependency bot's two PR checks, in the supply-chain (sast) job ──────────────

const sastSteps = () => load().jobs.sast.steps;
const sastIdx = (re) => sastSteps().findIndex((s) => re.test(`${s.name ?? ''} ${s.run ?? ''}`));

test('validate renovate: sast runs the strict validator at the pinned version, after the install', () => {
  const at = sastIdx(/renovate-config-validator --strict --no-global renovate\.json/);
  assert.ok(at >= 0, 'no Validate renovate.json step');
  const run = sastSteps()[at].run;
  assert.match(run, /^bash scripts\/ci-log-step\.sh /);
  assert.match(run, /\$\(node scripts\/check-renovate-config\.mjs --print-renovate-version\)/);
  assert.match(run, /--before=/);
  assert.ok(at > sastIdx(/pnpm install --frozen-lockfile/), 'after the dependency install');
});

test('checksum pairs: sast verifies every version-and-checksum pair that moved against the PR base', () => {
  const at = sastIdx(/refresh-pin-checksum\.mjs --verify-changed/);
  assert.ok(at >= 0, 'no Verify version-and-checksum pairs step');
  const run = sastSteps()[at].run;
  assert.match(run, /^bash scripts\/ci-log-step\.sh /);
  assert.match(run, /--base origin\/\$\{\{ github\.base_ref \|\| 'main' \}\}/);
  assert.ok(at > sastIdx(/PR base ref is available/), 'after the base ref is fetched');
});
