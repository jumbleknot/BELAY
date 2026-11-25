// Guard (items #79 and #84): a job on the shared host runner (`runs-on: kvm`) never writes shared
// host state, and never reads a tool from it.
//
// That runner runs as the same Unix user as MovieCollectionManager's runner, so the two share its home
// folder, its Actions tool cache and its Docker daemon. Measured 2026-11-25:
// - item #79: BELAY's devcontainer-image job installed pnpm 12.22.0 globally into the shared Node,
//   and MCM's jobs failed their pnpm version check;
// - item #84: the same job installed Trivy into the shared ~/.local/bin (which MCM's host jobs also
//   write and run), let Trivy's database default to the shared ~/.cache/trivy, and `docker login`
//   left BELAY's registry token in the shared ~/.docker/config.json.
//
// The rules live in scripts/lib/host-runner-rules.mjs. Each one is proved here against a minimal bad
// workflow (it must fire) and then held against every real workflow (it must not).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { hostJobs, hostRunnerViolations } from '../lib/host-runner-rules.mjs';

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), '.forgejo', 'workflows');
const realWorkflows = () => readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, wf: parse(readFileSync(join(DIR, f), 'utf8')) }));

/** One host job made of `steps`. */
const wf = (steps) => ({ jobs: { j: { 'runs-on': 'kvm', steps } } });
const rules = (w) => hostRunnerViolations(w, 'x.yml').map((v) => v.rule);
const T = '${{ runner.temp }}';

// ── each rule fires on its bad example ───────────────────────────────────────────────────────────

const BAD = {
  'pnpm-prefix': [{ name: 'p', run: 'bash scripts/install-pnpm.sh' }],
  'global-install': [{ name: 'g', run: 'npm install -g pnpm@12' }, { name: 'c', run: 'corepack enable' }],
  'path-outside-temp': [{ name: 'p', run: 'echo "$HOME/.local/bin" >> "$GITHUB_PATH"' }],
  'trivy-install-outside-temp': [{ name: 't', run: 'node scripts/install-trivy.mjs "$HOME/.local/bin"' }],
  'trivy-cache-default': [{ name: 's', run: 'node scripts/image-scan.mjs --image x --image-src docker' }],
  'docker-config-default': [{ name: 'l', run: 'echo "$T" | docker login "$R" -u u --password-stdin' }],
  'pnpm-action-setup': [{ name: 'a', uses: 'pnpm/action-setup@v4' }],
  'setup-node-cache': [{ name: 'n', uses: 'actions/setup-node@v7', with: { 'node-version': '26', cache: 'pnpm' } }],
  'home-write': [{ name: 'h', run: 'mkdir -p "$HOME/.mytool" && cp tool "$HOME/.mytool/"' }],
  'private-not-removed': [{ name: 'p', env: { PNPM_PREFIX: `${T}/belay-pnpm` }, run: 'bash scripts/install-pnpm.sh' }],
};

for (const [rule, steps] of Object.entries(BAD)) {
  test(`rule ${rule} fires on its bad example`, () => {
    assert.ok(rules(wf(steps)).includes(rule), `expected ${rule}, got ${JSON.stringify(rules(wf(steps)))}`);
  });
}

test('a correct host job passes every rule', () => {
  const env = { PNPM_PREFIX: `${T}/belay-pnpm`, BELAY_TRIVY: `${T}/belay-trivy`, DOCKER_CONFIG: `${T}/belay-docker` };
  const good = wf([
    { name: 'node', uses: 'actions/setup-node@v7', with: { 'node-version': '26' } },
    { name: 'pnpm', env: { PNPM_PREFIX: env.PNPM_PREFIX }, run: 'bash scripts/install-pnpm.sh' },
    { name: 'trivy', env: { BELAY_TRIVY: env.BELAY_TRIVY },
      run: 'node scripts/install-trivy.mjs "$BELAY_TRIVY/bin"\necho "$BELAY_TRIVY/bin" >> "$GITHUB_PATH"' },
    { name: 'scan', env: { BELAY_TRIVY: env.BELAY_TRIVY, TRIVY_CACHE_DIR: `${T}/belay-trivy/cache` },
      run: 'node scripts/image-scan.mjs --image x --image-src docker' },
    { name: 'push', env: { DOCKER_CONFIG: env.DOCKER_CONFIG }, run: 'echo "$T" | docker login "$R" -u u --password-stdin\ndocker push x' },
    { name: 'summary', run: 'echo "Set it in the sandbox VM\'s ~/.belay-sandbox-env" >> "$GITHUB_STEP_SUMMARY"' },
    { name: 'clean', if: 'always()', env, run: 'rm -rf "$PNPM_PREFIX" "$BELAY_TRIVY" "$DOCKER_CONFIG"' },
  ]);
  assert.deepEqual(hostRunnerViolations(good, 'good.yml'), []);
});

test('a cleanup that is not always() does not count', () => {
  const w = wf([
    { name: 'p', env: { PNPM_PREFIX: `${T}/p` }, run: 'bash scripts/install-pnpm.sh' },
    { name: 'clean', env: { PNPM_PREFIX: `${T}/p` }, run: 'rm -rf "$PNPM_PREFIX"' },
  ]);
  assert.ok(rules(w).includes('private-not-removed'));
});

test('a container job is not a host job', () => {
  const w = { jobs: { c: { 'runs-on': 'belay', steps: BAD['path-outside-temp'] } } };
  assert.deepEqual(hostRunnerViolations(w, 'c.yml'), []);
});

// ── every real workflow passes, and the scan is not vacuous ──────────────────────────────────────

test('the scan finds the host-runner job it guards, and that job has each guarded kind of step', () => {
  const jobs = realWorkflows().flatMap(({ file, wf: w }) => hostJobs(w, file));
  const build = jobs.find((h) => h.where === 'devcontainer-image.yml → build-publish');
  assert.ok(build, 'devcontainer-image.yml → build-publish is not a kvm job any more');
  const runs = (build.job.steps ?? []).map((s) => s.run ?? '').join('\n');
  for (const needle of ['install-pnpm.sh', 'install-trivy.mjs', 'image-scan.mjs', 'docker login', 'GITHUB_PATH']) {
    assert.ok(runs.includes(needle), `build-publish no longer has "${needle}": update this guard to the new premise`);
  }
});

test('no real workflow breaks a host-runner rule', () => {
  const all = realWorkflows().flatMap(({ file, wf: w }) => hostRunnerViolations(w, file));
  assert.deepEqual(all.map((v) => `${v.where}: [${v.rule}] ${v.message}`), []);
});
