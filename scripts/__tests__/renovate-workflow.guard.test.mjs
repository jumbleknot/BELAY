// Guard for .forgejo/workflows/renovate.yml (feature 011, contracts/workflow.md).
//
// The bot holds a token that can push branches, so its workflow's shape is load-bearing. MCM measured
// most of these failures on real runs:
//   - a job on the wrong Node version;
//   - a dispatch that created PRs by accident;
//   - Docker Hub paging past page 10;
//   - a verdict that a scheduled run could not report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, '.forgejo', 'workflows', 'renovate.yml');
const raw = () => readFileSync(FILE, 'utf8');
const wf = () => parse(raw());
const job = () => wf().jobs.renovate;
const steps = () => job().steps;
const idx = (re) => steps().findIndex((s) => re.test(`${s.name ?? ''} ${s.uses ?? ''} ${s.run ?? ''}`));
const stepEnv = (re) => ({ ...(job().env ?? {}), ...(steps()[idx(re)]?.env ?? {}) });

test('triggers: the two crons and dispatch, never a pull request', () => {
  const on = wf().on;
  assert.deepEqual(Object.keys(on).sort(), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(on.schedule.map((s) => s.cron), ['17 1,7,13,19 * * *', '0 5 * * 3']);
});

test('a dispatch defaults to a dry run (FR-016)', () => {
  const input = wf().on.workflow_dispatch.inputs.dryRun;
  assert.deepEqual([input.type, input.default], ['boolean', true]);
  assert.match(job().env.RENOVATE_DRY_RUN, /workflow_dispatch.*inputs\.dryRun.*'full'/);
});

test('runs on the belay runner, never kvm, one run at a time', () => {
  assert.equal(job()['runs-on'], 'belay');
  assert.deepEqual(wf().concurrency, { group: 'renovate', 'cancel-in-progress': false });
});

test('setup-node pins 26.13.1 and comes before the pnpm install', () => {
  const node = idx(/actions\/setup-node@[0-9a-f]{40}/);
  assert.ok(node >= 0);
  assert.equal(String(steps()[node].with['node-version']), '26.13.1');
  assert.ok(node < idx(/install-pnpm\.sh/), 'setup-node must precede install-pnpm.sh');
});

test('the preflight checks RENOVATE_TOKEN from the environment, never on argv, before Renovate runs', () => {
  const at = idx(/--preflight/);
  assert.ok(at >= 0, 'no preflight step');
  const pre = steps()[at];
  assert.equal(pre.env.RENOVATE_TOKEN, '${{ secrets.RENOVATE_TOKEN }}');
  assert.doesNotMatch(pre.run, /curl|RENOVATE_TOKEN/, 'the token must not be on a command line');
  assert.ok(at < idx(/^Run Renovate /), 'the preflight must precede the run');
});

test('the validator and the run use the same version expression, installed --before', () => {
  const version = /\$\(node scripts\/check-renovate-config\.mjs --print-renovate-version\)/;
  for (const re of [/renovate-config-validator --strict --no-global renovate\.json/, /^Run Renovate /]) {
    const s = steps()[idx(re)];
    assert.ok(s, String(re));
    assert.match(s.run, version);
    assert.match(s.run, /--before=/);
  }
});

test('the run environment: platform, endpoint, no autodiscover, no onboarding, docker pages, allowed commands, JSON log', () => {
  const env = stepEnv(/^Run Renovate /);
  assert.equal(env.RENOVATE_PLATFORM, 'gitea');
  assert.equal(env.RENOVATE_ENDPOINT, '${{ github.server_url }}/api/v1/');
  assert.equal(env.RENOVATE_REPOSITORIES, '${{ github.repository }}');
  assert.equal(String(env.RENOVATE_AUTODISCOVER), 'false');
  assert.equal(String(env.RENOVATE_ONBOARDING), 'false');
  assert.equal(env.RENOVATE_REQUIRE_CONFIG, 'required');
  assert.ok(Number(env.RENOVATE_DOCKER_MAX_PAGES) <= 10, 'Docker Hub refuses page 11');
  assert.match(env.RENOVATE_ALLOWED_COMMANDS, /refresh-pin-checksum/);
  assert.equal(env.LOG_FORMAT, 'json');
  assert.ok(env.RENOVATE_LOG_FILE);
  assert.equal(env.RENOVATE_TOKEN, '${{ secrets.RENOVATE_TOKEN }}');
});

test('the verdict runs always() and publishes renovate/verdict', () => {
  const v = steps()[idx(/--run-verdict/)];
  assert.ok(v, 'no verdict step');
  assert.match(String(v.if), /always\(\)/);
  assert.match(v.run, /--publish-verdict/);
  assert.equal(v.env.GITHUB_TOKEN, '${{ github.token }}');
});

test('a dispatch publishes its resolved mode as renovate/mode, never failing the run', () => {
  const m = steps()[idx(/renovate\/mode/)];
  assert.ok(m, 'no mode step');
  assert.match(String(m.if), /always\(\).*workflow_dispatch/);
  assert.match(m.run, /check-renovate-config\.mjs --publish-mode/);
  assert.equal(m.env.GITHUB_TOKEN, '${{ github.token }}');
  assert.equal(m['continue-on-error'], true);
});

test('every run: step goes through ci-log-step.sh, and the failure digest is last', () => {
  const all = steps();
  const last = all.at(-1);
  assert.match(last.run, /ci-failure-digest\.mjs/);
  assert.match(String(last.if), /always\(\)/);
  for (const s of all.slice(0, -1).filter((x) => x.run)) assert.match(s.run, /^bash scripts\/ci-log-step\.sh /, s.name);
});

test('no ANTHROPIC_API_KEY and no tailnet host literal', () => {
  assert.doesNotMatch(raw(), /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(raw(), /\.ts\.net/);
});
