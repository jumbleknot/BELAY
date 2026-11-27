// Guard for .forgejo/workflows/devcontainer-image.yml (feature 004, T014).
//
// This workflow is the ONE job in BELAY that does not run on BELAY's containerized runner: it needs
// a Docker daemon, so it runs on BELAY's host runner (`belay-host`, item #92), directly on the host
// with its Unix user's rootless Docker. That makes the trigger set load-bearing for security:
// PULL-REQUEST CODE MUST NEVER RUN HERE, or a PR could run on the host and reach that Docker. Research R7.

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

test('push runs only for main, the protected branch', () => {
  // Any other pushed branch would otherwise run its own toolchain.Dockerfile on the host runner.
  assert.deepEqual(wf().on.push.branches, ['main']);
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
  assert.equal(jobs['build-publish']['runs-on'], 'belay-host');
  assert.ok(Number(jobs['build-publish']['timeout-minutes']) > 0);
});

// Item #92: the runner moved from one Unix user to another, and a literal `/run/user/<uid>` would
// have pointed the job at the old user's daemon (or none). Derive it from the uid the job runs as.
test('DOCKER_HOST is derived from the job\'s own uid, never a hard-coded one', () => {
  assert.doesNotMatch(raw(), /\/run\/user\/\d+/);
  const job = wf().jobs['build-publish'];
  assert.equal('DOCKER_HOST' in (job.env ?? {}), false, 'a job-level DOCKER_HOST would be a literal');
  const steps = job.steps;
  const at = steps.findIndex((s) => /DOCKER_HOST="unix:\/\/\/run\/user\/\$\(id -u\)\/docker\.sock"/.test(s.run ?? ''));
  assert.ok(at >= 0, 'no step derives DOCKER_HOST from id -u');
  assert.match(steps[at].run, /echo "DOCKER_HOST=\$DOCKER_HOST" >> "\$GITHUB_ENV"/);
  const firstDocker = steps.findIndex((s) => /\bdocker\s+(build|push|login|inspect)\b/.test(s.run ?? ''));
  assert.ok(at < firstDocker, `DOCKER_HOST is set at step ${at}, after the first docker use at ${firstDocker}`);
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

// ── Feature 010: the builder scans the image BEFORE it is pushed (spec clarification, FR-001) ────────
// A blocking finding (an un-allowlisted fixable Critical) fails the scan step, and a failed step stops
// the job, so `Push` never runs and no vulnerable digest exists to re-pin onto.
const steps010 = () => wf().jobs['build-publish'].steps;
const indexOf = (pred) => steps010().findIndex(pred);

test('feature 010: install Trivy, scan and gate, then upload the report, all between Build and Push', () => {
  const build = indexOf((s) => /docker build/.test(s.run ?? ''));
  const install = indexOf((s) => s.name === 'Install Trivy (pinned, sha256-verified)');
  const scan = indexOf((s) => s.name === 'Scan the built image (gates the push)');
  const upload = indexOf((s) => s.name === 'Upload the image-scan report');
  const push = indexOf((s) => /docker push/.test(s.run ?? ''));
  assert.ok(build >= 0 && install > build && scan > install && push > scan, `order: build ${build}, install ${install}, scan ${scan}, push ${push}`);
  assert.ok(upload > scan, 'the report is uploaded after the scan');
});

test('feature 010: the install and scan steps carry the same build gate as Push', () => {
  const gate = steps010().find((s) => /docker push/.test(s.run ?? '')).if;
  for (const name of ['Install Trivy (pinned, sha256-verified)', 'Scan the built image (gates the push)']) {
    assert.equal(steps010().find((s) => s.name === name).if, gate, `${name} if:`);
  }
});

test('feature 010: the scan step scans "$TAG" from the local daemon, then runs the gate', () => {
  const run = steps010().find((s) => s.name === 'Scan the built image (gates the push)').run;
  const scanAt = run.indexOf('node scripts/image-scan.mjs --image "$TAG" --image-src docker');
  const gateAt = run.indexOf('node scripts/check-image-findings.mjs');
  assert.ok(scanAt >= 0 && gateAt > scanAt, run);
});

test('feature 010: the image-scan report is uploaded always() when the image was built, even when the scan fails', () => {
  const s = steps010().find((x) => x.name === 'Upload the image-scan report');
  assert.equal(s.if, "always() && steps.gate.outputs.build == 'true'");
  assert.match(String(s.with?.path), /security\/images\/reports/);
});

// Moved here from T011: it cannot hold until the builder scans. Every image BELAY builds has exactly
// one owner, the builder that scans it before push, so the sweep excluding it leaves no blind spot.
test('feature 010: every name in BUILT_IMAGES is built by a job that scans it before its push', async () => {
  const { BUILT_IMAGES } = await import('../image-scan.mjs');
  for (const name of BUILT_IMAGES) {
    const job = Object.values(wf().jobs).find((j) => (j.steps ?? []).some((s) => (s.run ?? '').includes(`${name}:`) && /docker build/.test(s.run ?? '')));
    assert.ok(job, `${name}: no job builds it`);
    const ix = (pred) => job.steps.findIndex(pred);
    const scan = ix((s) => /image-scan\.mjs --image/.test(s.run ?? ''));
    const push = ix((s) => /docker push/.test(s.run ?? ''));
    assert.ok(scan >= 0 && scan < push, `${name}: scanned at ${scan}, pushed at ${push}`);
  }
});
