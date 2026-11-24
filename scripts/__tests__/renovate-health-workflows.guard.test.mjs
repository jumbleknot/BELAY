// Guards for renovate-health.yml and branch-reaper.yml (feature 012, contracts/workflows.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const WF = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.forgejo', 'workflows');
const load = (f) => ({ raw: readFileSync(join(WF, f), 'utf8'), wf: parse(readFileSync(join(WF, f), 'utf8')) });
const steps = (wf, job) => wf.jobs[job].steps;
const at = (list, re) => list.findIndex((s) => re.test(`${s.name ?? ''} ${s.uses ?? ''} ${s.run ?? ''}`));

function commonRules(file, job, cron) {
  const { raw, wf } = load(file);
  const s = steps(wf, job);
  assert.deepEqual(Object.keys(wf.on).sort(), ['schedule', 'workflow_dispatch'], `${file}: never a pull request`);
  assert.deepEqual(wf.on.schedule.map((x) => x.cron), [cron]);
  assert.equal(wf.jobs[job]['runs-on'], 'belay');
  assert.equal(wf.concurrency['cancel-in-progress'], false);
  assert.equal(String(s[0].with?.['fetch-depth']), '0', `${file}: ancestry needs full history`);
  const last = s.at(-1);
  assert.match(last.run, /ci-failure-digest\.mjs/);
  assert.match(String(last.if), /always\(\)/);
  for (const x of s.slice(0, -1).filter((y) => y.run)) {
    assert.match(x.run, /^bash scripts\/ci-log-step\.sh /, `${file}: ${x.name}`);
    assert.doesNotMatch(x.run, /\$\{\{/, `${file}: ${x.name} interpolates \${{ }} into run:`);
  }
  assert.doesNotMatch(raw, /\.ts\.net|ANTHROPIC_API_KEY/);
  return s;
}

test('renovate-health: Wednesday 08:30 UTC, belay, full history, wrapper steps, digest last', () => {
  commonRules('renovate-health.yml', 'renovate-health', '30 8 * * 3');
});
test('renovate-health: the self-tests run before the real steps, and the report runs always() with both tokens', () => {
  const s = steps(load('renovate-health.yml').wf, 'renovate-health');
  const report = at(s, /renovate-health\.mjs --lockfile-verdict/);
  assert.ok(at(s, /renovate-health\.mjs --selftest/) >= 0 && at(s, /renovate-health\.mjs --selftest/) < report);
  assert.match(String(s[report].if), /always\(\)/);
  assert.equal(s[report].env.GITHUB_TOKEN, '${{ github.token }}');
  assert.equal(s[report].env.CI_DIGEST_TOKEN, '${{ secrets.CI_DIGEST_TOKEN }}');
});
test('renovate-health lock-file: the check runs after its self-test and before the report, writing the verdict file', () => {
  const s = steps(load('renovate-health.yml').wf, 'renovate-health');
  const check = at(s, /check-lockfile-refresh\.mjs --verdict-out lockfile-verdict\.json/);
  assert.ok(check >= 0, 'no lock-file check step');
  assert.ok(at(s, /check-lockfile-refresh\.mjs --selftest/) < check);
  assert.ok(check < at(s, /renovate-health\.mjs --lockfile-verdict lockfile-verdict\.json/));
  assert.equal(s[check].env.GITHUB_TOKEN, '${{ github.token }}');
});
test('reaper: daily 03:30 UTC, belay, full history, wrapper steps, digest last', () => {
  commonRules('branch-reaper.yml', 'branch-reaper', '30 3 * * *');
});
test('reaper: dispatch defaults to a dry run, and the apply decision goes through env', () => {
  const { wf } = load('branch-reaper.yml');
  assert.deepEqual([wf.on.workflow_dispatch.inputs.apply.type, wf.on.workflow_dispatch.inputs.apply.default], ['boolean', false]);
  const s = steps(wf, 'branch-reaper');
  const reap = s[at(s, /reap-merged-branches\.mjs "\$@"|reap-merged-branches\.mjs \$/)];
  assert.ok(reap, 'no reaper step');
  assert.match(reap.env.REAPER_APPLY, /github\.event_name == 'schedule'.*inputs\.apply/);
  assert.match(reap.run, /REAPER_APPLY/);
  assert.ok(at(s, /reap-merged-branches\.mjs --selftest/) < s.indexOf(reap));
});

test('reaper: the reap step carries CI_DIGEST_TOKEN, which reads branch protection (the run token gets 403)', () => {
  const s = steps(load('branch-reaper.yml').wf, 'branch-reaper');
  const reap = s[at(s, /reap-merged-branches\.mjs "\$@"/)];
  assert.equal(reap.env.CI_DIGEST_TOKEN, '${{ secrets.CI_DIGEST_TOKEN }}');
});
