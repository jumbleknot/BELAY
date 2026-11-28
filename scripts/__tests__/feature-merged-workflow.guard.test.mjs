// Guards on closing at merge (feature 016; contracts/feature-merged.md "Triggers"; FR-014, FR-039; decision M10):
//   - feature-merged.yml runs only on a push to main (a PR closed without merging never pushes, so never runs it) or
//     by hand with a sha, on BELAY's runner, briefly, never cancelled, and runs no test target;
//   - guardrails attaches the collector to its three test steps and posts the outcomes from its own run on main, in a
//     step that can never change the job's result, inside its unchanged 10-minute budget;
//   - the config's targets are exactly guardrails' test steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const merged = () => parse(read('.forgejo/workflows/feature-merged.yml'));
const guardrails = () => parse(read('.forgejo/workflows/guardrails.yml'));
const config = JSON.parse(read('scripts/feature-merged.config.json'));
const TEST_TARGETS = ['scripts:test', 'pdlc:test', 'pdlc:integration'];

test('the config counts exactly the test targets guardrails runs, each with its own report', () => {
  const steps = guardrails().jobs.guardrails.steps.map((s) => s.run ?? '');
  const run = TEST_TARGETS.filter((t) => steps.some((r) => r.includes(`pnpm nx run ${t} `) || r.endsWith(`pnpm nx run ${t}`)));
  assert.deepEqual(run, TEST_TARGETS, 'guardrails runs the three test targets');
  assert.deepEqual(config.targets.map((t) => t.target), TEST_TARGETS);
  assert.equal(new Set(config.targets.map((t) => t.report)).size, TEST_TARGETS.length);
});

test('feature-merged.yml: push to main and workflow_dispatch(sha) only; runner belay; 5 minutes; fetch-depth 2; never cancelled', () => {
  const wf = merged();
  assert.deepEqual(Object.keys(wf.on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(wf.on.push.branches, ['main']);
  assert.ok(wf.on.workflow_dispatch.inputs.sha, 'a re-run names its sha');
  const jobs = Object.values(wf.jobs);
  assert.equal(jobs.length, 1);
  const [job] = jobs;
  assert.equal(job['runs-on'], 'belay');
  assert.equal(job['timeout-minutes'], 5);
  assert.equal(job.steps[0].with['fetch-depth'], 2, 'the created count reads the parent commit');
  assert.ok(wf.concurrency?.group, 'its own concurrency group');
  assert.notEqual(wf.concurrency['cancel-in-progress'], true, 'a close is never cancelled by a later merge (guardrails\' runs are)');
});

test('feature-merged.yml runs no test target, passes the tokens through env only, and publishes a failure digest', () => {
  const steps = merged().jobs[Object.keys(merged().jobs)[0]].steps;
  const runs = steps.map((s) => s.run ?? '').join('\n');
  for (const t of TEST_TARGETS) assert.doesNotMatch(runs, new RegExp(`nx run ${t}\\b`), t);
  assert.doesNotMatch(runs, /node --test/);
  assert.match(runs, /pnpm nx run scripts:feature-merged/);
  const close = steps.find((s) => /scripts:feature-merged/.test(s.run ?? ''));
  assert.equal(close.env.GITHUB_TOKEN, '${{ github.token }}');
  assert.equal(close.env.CI_DIGEST_TOKEN, '${{ secrets.CI_DIGEST_TOKEN }}');
  assert.doesNotMatch(close.run, /\$\{\{\s*(secrets|github\.token)/, 'no token in the command line');
  const digest = steps.at(-1);
  assert.equal(digest.if, 'always()');
  assert.equal(digest['continue-on-error'], true);
  assert.match(digest.run, /ci-failure-digest\.mjs/);
});

test('guardrails: each test step writes its report; the outcomes step runs on a push to main only, can never fail the job, and the digest stays last', () => {
  const job = guardrails().jobs.guardrails;
  const steps = job.steps;
  for (const { target, report } of config.targets) {
    const s = steps.find((x) => (x.run ?? '').includes(`pnpm nx run ${target} `));
    assert.ok(s, target);
    assert.match(s.run, new RegExp(`--results=target/test-results/${report.replace('.', '\\.')}$`), `${target} writes its report`);
  }
  const outcomes = steps.find((s) => /feature-merged\.mjs --outcomes/.test(s.run ?? ''));
  assert.ok(outcomes, 'an outcomes step');
  assert.equal(outcomes.if, "always() && github.event_name == 'push'");
  assert.equal(outcomes['continue-on-error'], true);
  assert.match(outcomes.run, /--outcomes target\/test-results --job-status "\$JOB_STATUS"/);
  assert.equal(outcomes.env.JOB_STATUS, '${{ job.status }}');
  assert.equal(steps.indexOf(outcomes), steps.length - 2, 'just before the failure digest, which stays the last step');
  assert.equal(job['timeout-minutes'], 10, 'the guardrails budget is unchanged');
});

test('neither new step is a required check: branch protection requires guardrails, and feature-merged is its own workflow (documented)', () => {
  assert.match(read('docs/runbooks/ci.md'), /`feature-merged`[^\n]*not a required check/);
});
