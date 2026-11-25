// Guard (item #79): a job on the shared host runner (`runs-on: kvm`) never writes to shared host state.
// That runner runs as the same Unix user as other projects' runners, so they share its Actions tool
// cache: a global npm install there changes the tools every other project's jobs run. Measured
// 2026-11-25: BELAY's devcontainer-image job installed pnpm 12.22.0 globally into the shared Node,
// and MovieCollectionManager's jobs failed their pnpm version check. Every workflow is scanned, so a
// future host-runner job is held to the same rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), '.forgejo', 'workflows');
const hostJobs = () => readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).flatMap((f) => {
  const wf = parse(readFileSync(join(DIR, f), 'utf8'));
  return Object.entries(wf.jobs ?? {}).filter(([, j]) => [j['runs-on']].flat().includes('kvm')).map(([name, job]) => ({ where: `${f} → ${name}`, job, wf }));
});
const PRIVATE = /^\$\{\{\s*runner\.temp\s*\}\}\//;

test('the scan finds the host-runner job it guards (not vacuous)', () => {
  assert.ok(hostJobs().some((h) => h.where === 'devcontainer-image.yml → build-publish'));
});

test('a host-runner step that runs install-pnpm.sh sets PNPM_PREFIX under runner.temp', () => {
  for (const { where, job, wf } of hostJobs()) {
    for (const step of job.steps ?? []) {
      if (!/install-pnpm\.sh/.test(step.run ?? '')) continue;
      const prefix = step.env?.PNPM_PREFIX ?? job.env?.PNPM_PREFIX ?? wf.env?.PNPM_PREFIX;
      assert.match(String(prefix ?? ''), PRIVATE, `${where}, step "${step.name}": install-pnpm.sh without a job-private PNPM_PREFIX`);
    }
  }
});

test('no host-runner step installs globally itself (npm -g / --global, corepack enable)', () => {
  for (const { where, job } of hostJobs()) {
    for (const step of job.steps ?? []) {
      assert.doesNotMatch(step.run ?? '', /\bnpm\s+(i|install|add)\b[^\n]*\s(-g|--global)\b|\bcorepack\s+enable\b/,
        `${where}, step "${step.name}": a global install writes the shared tool cache`);
    }
  }
});

test('the job-private prefix is removed when the job ends, pass or fail', () => {
  for (const { where, job } of hostJobs()) {
    if (!(job.steps ?? []).some((s) => /install-pnpm\.sh/.test(s.run ?? ''))) continue;
    const cleanup = (job.steps ?? []).find((s) => /rm -rf "\$PNPM_PREFIX"/.test(s.run ?? ''));
    assert.ok(cleanup, `${where}: no step removes "$PNPM_PREFIX"`);
    assert.match(String(cleanup.if ?? ''), /always\(\)/, `${where}: the cleanup step must run on failure too (if: always())`);
    assert.match(String(cleanup.env?.PNPM_PREFIX ?? job.env?.PNPM_PREFIX ?? ''), PRIVATE, `${where}: the cleanup step removes something other than the private prefix`);
  }
});
