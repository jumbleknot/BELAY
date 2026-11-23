// Guard for .forgejo/workflows/devcontainer-image.yml (feature 004, T014).
//
// This workflow is the ONE job in BELAY that does not run on BELAY's own containerized runner: it
// needs a Docker daemon, so it runs on the shared host runner (`kvm`), which has the host's Docker.
// That makes the trigger set load-bearing for security: PULL-REQUEST CODE MUST NEVER RUN HERE, or a
// PR could reach the host's Docker. Research R7.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, '.forgejo', 'workflows', 'devcontainer-image.yml');
const raw = () => readFileSync(FILE, 'utf8');
const wf = () => parse(raw());

test('triggers are dispatch, push and schedule only: never pull_request', () => {
  const on = wf().on;
  assert.deepEqual(Object.keys(on).sort(), ['push', 'schedule', 'workflow_dispatch']);
  assert.equal('pull_request' in on, false);
  assert.equal('pull_request_target' in on, false);
  assert.deepEqual(on.schedule.map((s) => s.cron), ['0 6 * * 5']);
});

test('push is filtered on the image inputs and package.json', () => {
  const paths = wf().on.push.paths;
  for (const p of ['.devcontainer/toolchain.Dockerfile', '.devcontainer/Dockerfile', '.forgejo/workflows/devcontainer-image.yml',
    'scripts/install-pnpm.sh', 'scripts/devcontainer-image-gate.mjs', 'package.json']) {
    assert.ok(paths.includes(p), `push.paths lacks ${p}`);
  }
});

test('one job, build-publish, on the host runner with a timeout', () => {
  const jobs = wf().jobs;
  assert.deepEqual(Object.keys(jobs), ['build-publish']);
  assert.equal(jobs['build-publish']['runs-on'], 'kvm');
  assert.ok(Number(jobs['build-publish']['timeout-minutes']) > 0);
});

test('publishes belay-devcontainer and reports the digest-pinned reference', () => {
  const text = raw();
  assert.match(text, /\/belay-devcontainer:\$\{GITHUB_SHA\}/);
  const push = wf().jobs['build-publish'].steps.find((s) => /docker push/.test(s.run ?? ''));
  assert.ok(push, 'a push step exists');
  assert.match(push.run, /belay-devcontainer@\$\{?DIGEST\}?/);
  assert.match(push.run, /GITHUB_STEP_SUMMARY/, 'the pinned reference is written to the step summary (FR-018)');
});

test('every run: step goes through ci-log-step.sh, and the job ends with the failure digest', () => {
  const steps = wf().jobs['build-publish'].steps;
  const last = steps[steps.length - 1];
  assert.match(last.run ?? '', /ci-failure-digest\.mjs/);
  assert.equal(last.if, 'always()');
  assert.equal(last['continue-on-error'], true);
  for (const s of steps.slice(0, -1)) {
    if (!s.run) continue;
    assert.match(s.run, /bash scripts\/ci-log-step\.sh /, `step "${s.name}" must run through ci-log-step.sh`);
  }
});

test('the workflow never names the upstream project', () => {
  assert.doesNotMatch(raw(), /mcm/i);
});
