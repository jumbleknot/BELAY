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

test('a single guardrails job on the ubuntu-latest label with a timeout', () => {
  const { jobs } = load();
  assert.deepEqual(Object.keys(jobs), ['guardrails']);
  assert.equal(jobs.guardrails['runs-on'], 'ubuntu-latest');
  assert.equal(jobs.guardrails['timeout-minutes'], 10);
});

test('steps run in contract order with pinned actions, Node 26 and the Nx targets', () => {
  const steps = load().jobs.guardrails.steps;
  assert.equal(steps.length, 7, 'the contract defines exactly seven steps');
  assert.equal(steps[0].uses, CHECKOUT);
  assert.equal(steps[1].uses, SETUP_NODE);
  assert.equal(String(steps[1].with['node-version']), NODE_VERSION);
  assert.equal(steps[2].run.trim(), 'bash scripts/install-pnpm.sh');
  assert.equal(steps[3].run.trim(), 'pnpm install --frozen-lockfile');
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
