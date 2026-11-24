// Guard: a workflow job that runs a script needing a third-party package installs dependencies
// FIRST.
//
// Why this exists: devcontainer-image.yml ran `node scripts/image-scan.mjs` on the kvm host runner
// without `pnpm install`. The script imports `yaml`, so it died with ERR_MODULE_NOT_FOUND before
// it scanned anything. The push was still skipped, but only because the step crashed, so the gate
// LOOKED like it worked while it had never judged an image. Every unit test passed, because they
// run with node_modules present. The bug sits in how the workflow wires a script to its
// dependencies, so this guard checks that wiring for every job in every workflow.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF_DIR = join(ROOT, '.forgejo', 'workflows');
const BUILTINS = new Set(builtinModules);
const INSTALL = /pnpm install --frozen-lockfile/;
const SCRIPT_RUN = /\bnode\s+(scripts\/[\w./-]+\.mjs)/g;

const SPECIFIERS = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

// The third-party packages a script needs, following its relative imports transitively.
export function bareImports(entry, seen = new Set()) {
  const file = resolve(ROOT, entry);
  if (seen.has(file) || !existsSync(file)) return new Set();
  seen.add(file);
  const found = new Set();
  for (const m of readFileSync(file, 'utf8').matchAll(SPECIFIERS)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec.startsWith('.') || spec.startsWith('/')) {
      for (const b of bareImports(resolve(dirname(file), spec), seen)) found.add(b);
    } else if (!spec.startsWith('node:') && !BUILTINS.has(spec)) {
      found.add(spec);
    }
  }
  return found;
}

// [{ workflow, job, step, script, packages }] for every script step that runs before any install.
export function uninstalledScriptSteps(workflows) {
  const problems = [];
  for (const [name, wf] of workflows) {
    for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
      let installed = false;
      for (const step of job.steps ?? []) {
        const run = typeof step.run === 'string' ? step.run : '';
        for (const [, script] of run.matchAll(SCRIPT_RUN)) {
          const packages = [...bareImports(script)];
          if (!installed && packages.length) {
            problems.push({ workflow: name, job: jobId, step: step.name ?? run.slice(0, 60), script, packages });
          }
        }
        if (INSTALL.test(run)) installed = true;
      }
    }
  }
  return problems;
}

const loadWorkflows = () => readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => [f, parse(readFileSync(join(WF_DIR, f), 'utf8'))]);

test('bareImports follows relative imports and ignores builtins', () => {
  // image-scan.mjs imports yaml directly: the package this bug was about.
  assert.ok(bareImports('scripts/image-scan.mjs').has('yaml'));
  // install-trivy.mjs uses only node builtins, so a job may run it before installing.
  assert.deepEqual([...bareImports('scripts/install-trivy.mjs')], []);
});

test('uninstalledScriptSteps flags a script step that runs before pnpm install, and only then', () => {
  const step = { name: 'scan', run: 'node scripts/image-scan.mjs --image x' };
  const install = { run: 'pnpm install --frozen-lockfile' };
  assert.equal(uninstalledScriptSteps([['w.yml', { jobs: { j: { steps: [step] } } }]]).length, 1);
  assert.equal(uninstalledScriptSteps([['w.yml', { jobs: { j: { steps: [install, step] } } }]]).length, 0);
});

test('every workflow job installs dependencies before running a script that needs a package', () => {
  const problems = uninstalledScriptSteps(loadWorkflows());
  assert.deepEqual(problems, [], problems.map((p) =>
    `${p.workflow} job "${p.job}" step "${p.step}" runs ${p.script} (needs ${p.packages.join(', ')}) before any \`pnpm install --frozen-lockfile\``).join('\n'));
});
