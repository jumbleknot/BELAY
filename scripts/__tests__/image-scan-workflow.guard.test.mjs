// Guard for .forgejo/workflows/image-scan.yml (feature 010; contracts/workflows.md): the sweep of
// every third-party image in the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { TRIVY_PIN } from '../install-trivy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = join(ROOT, '.forgejo', 'workflows');
const FILE = join(WORKFLOWS, 'image-scan.yml');
const raw = () => readFileSync(FILE, 'utf8');
const wf = () => parse(raw());
const steps = () => wf().jobs.sweep.steps;
const stepNamed = (re) => steps().find((s) => re.test(s.name ?? ''));

test('triggers: Tuesday and Friday 04:00 UTC, dispatch, and path-filtered pull_request and push to main', () => {
  const on = wf().on;
  assert.deepEqual(on.schedule.map((s) => s.cron).sort(), ['0 4 * * 2', '0 4 * * 5']);
  assert.ok('workflow_dispatch' in on);
  assert.deepEqual(on.push.branches, ['main']);
  for (const p of ['**/*Dockerfile*', 'infrastructure-as-code/**', 'security/images/**', 'scripts/image-scan.mjs',
    'scripts/check-image-findings.mjs', 'scripts/install-trivy.mjs']) {
    assert.ok(on.pull_request.paths.includes(p), `pull_request.paths lacks ${p}`);
    assert.ok(on.push.paths.includes(p), `push.paths lacks ${p}`);
  }
});

test('one job, sweep, on BELAY\'s containerized runner (never the kvm host runner, which must not run PR code)', () => {
  assert.deepEqual(Object.keys(wf().jobs), ['sweep']);
  assert.equal(wf().jobs.sweep['runs-on'], 'belay');
  assert.ok(Number(wf().jobs.sweep['timeout-minutes']) > 0);
});

test('every run: step goes through ci-log-step.sh, and the job ends with the failure digest', () => {
  const all = steps();
  const last = all.at(-1);
  assert.match(last.run ?? '', /node scripts\/ci-failure-digest\.mjs/);
  assert.equal(last.if, 'always()');
  assert.equal(last['continue-on-error'], true);
  for (const s of all.slice(0, -1)) {
    if (!s.run) continue;
    assert.match(s.run, /bash scripts\/ci-log-step\.sh /, `step "${s.name}" must run through ci-log-step.sh`);
  }
});

test('install, enumerate, sweep, then gate, in that order', () => {
  const runs = steps().map((s) => s.run ?? '');
  const at = (re) => runs.findIndex((r) => re.test(r));
  const install = at(/install-trivy\.mjs/);
  const list = at(/image-scan\.mjs --list/);
  const sweep = runs.findIndex((r) => /image-scan\.mjs(?! --list)(\s|$)/.test(r) && !/--list/.test(r));
  const gate = at(/check-image-findings\.mjs/);
  assert.ok(install >= 0 && list > install && sweep > list && gate > sweep, `order: install ${install}, list ${list}, sweep ${sweep}, gate ${gate}`);
});

test('the verdict status: image-scan / verdict, always(), on schedule, push and dispatch, with the run token', () => {
  const s = stepNamed(/verdict status/i);
  assert.ok(s, 'a verdict-status step exists');
  assert.match(s.if, /always\(\)/);
  for (const ev of ['schedule', 'push', 'workflow_dispatch']) assert.match(s.if, new RegExp(`'${ev}'`), `if: covers ${ev}`);
  assert.doesNotMatch(s.if, /pull_request/);
  assert.equal(s.env?.GITHUB_TOKEN, '${{ github.token }}');
  // The context name (image-scan / verdict) lives in check-image-findings.mjs publishVerdict, tested there.
  assert.match(s.run, /check-image-findings\.mjs --publish-verdict security\/images\/reports\/verdict\.txt/);
  assert.match(s.name, /image-scan \/ verdict/);
});

test('the report is uploaded even when the gate fails', () => {
  const s = steps().find((x) => /upload-artifact/.test(x.uses ?? ''));
  assert.ok(s, 'an upload-artifact step exists');
  assert.equal(s.if, 'always()');
  assert.match(String(s.with?.path), /security\/images\/reports/);
});

test('no step pipes a download into a shell', () => {
  assert.doesNotMatch(raw(), /curl[^\n|]*\|\s*(?:ba)?sh\b/);
});

test('the Trivy version is stated only in install-trivy.mjs: no workflow names it', () => {
  for (const f of readdirSync(WORKFLOWS).filter((x) => /\.ya?ml$/.test(x))) {
    assert.ok(!readFileSync(join(WORKFLOWS, f), 'utf8').includes(TRIVY_PIN.version), `${f} names the Trivy version`);
  }
});
