// Tests for scripts/lib/extensions-yml.mjs, the dependency-free reader of the extensions.yml
// layout Spec Kit generates. Run: node --test scripts/__tests__/extensions-yml.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtensionsYml } from '../lib/extensions-yml.mjs';

const SAMPLE = `installed:
- agent-context
- git
settings:
  auto_execute_hooks: true
hooks:
  before_specify:
  - extension: git
    command: speckit.git.feature
    enabled: true
    optional: false
    priority: 10
    prompt: Execute speckit.git.feature?
    description: Create feature branch before specification
    condition: null
  after_plan:
  - extension: git
    command: speckit.git.commit
    enabled: true
    optional: true
    priority: 10
    prompt: Commit plan changes?
    description: Auto-commit after implementation planning
    condition: null
  - extension: agent-context
    command: speckit.agent-context.update
    enabled: false
    optional: true
    condition: null
`;

test('parses installed list and hooks', () => {
  const r = parseExtensionsYml(SAMPLE);
  assert.deepEqual(r.installed, ['agent-context', 'git']);
  assert.deepEqual(r.hooks.before_specify, [
    { extension: 'git', command: 'speckit.git.feature', enabled: true, optional: false },
  ]);
  assert.equal(r.hooks.after_plan.length, 2);
  assert.equal(r.hooks.after_plan[1].enabled, false);
});

test('missing enabled defaults to true', () => {
  const r = parseExtensionsYml('installed:\n- git\nhooks:\n  after_tasks:\n  - extension: git\n    command: speckit.git.commit\n    optional: true\n');
  assert.deepEqual(r.hooks.after_tasks, [
    { extension: 'git', command: 'speckit.git.commit', enabled: true, optional: true },
  ]);
});

test('parses CRLF input', () => {
  assert.deepEqual(parseExtensionsYml(SAMPLE.replace(/\n/g, '\r\n')), parseExtensionsYml(SAMPLE));
});

test('quoted scalars', () => {
  const r = parseExtensionsYml(`installed:\n- "git"\nhooks:\n  after_tasks:\n  - extension: 'git'\n    command: "speckit.git.commit"\n    optional: 'true'\n`);
  assert.deepEqual(r.installed, ['git']);
  assert.deepEqual(r.hooks.after_tasks[0], { extension: 'git', command: 'speckit.git.commit', enabled: true, optional: true });
});

test('rejects a hook item outside hooks', () => {
  assert.throws(
    () => parseExtensionsYml('installed:\n- git\nsettings:\n  - extension: x\n    command: y\n'),
    /^Error: extensions\.yml:\d+/,
  );
});

test('wrapped long values (PyYAML continuation lines) are folded into their field', () => {
  // yaml.dump wraps plain scalars past column 80 onto lines indented under the field.
  const r = parseExtensionsYml(`installed:
- git
hooks:
  after_converge:
  - extension: git
    command: speckit.git.commit
    enabled: true
    optional: true
    priority: 10
    prompt: Commit after convergence?
    description: Auto-commit after convergence (BELAY local hook, see docs/runbooks/spec-kit.md
      and the upgrade procedure for how to re-add it after an extension reinstall)
    condition: null
`);
  assert.deepEqual(r.hooks.after_converge, [
    { extension: 'git', command: 'speckit.git.commit', enabled: true, optional: true },
  ]);
});

test('empty hooks', () => {
  assert.deepEqual(parseExtensionsYml('installed: []\nhooks: {}\n'), { installed: [], hooks: {} });
});

// Feature 014: the real file carries the hand-added close-proposal hook, mandatory.
import { readFileSync as readFileSync014 } from 'node:fs';
test('close-proposal: the real .specify/extensions.yml has after_specify → belay speckit.belay.close-proposal, optional false', () => {
  const real = parseExtensionsYml(readFileSync014(new URL('../../.specify/extensions.yml', import.meta.url), 'utf8'));
  const h = (real.hooks.after_specify ?? []).find((x) => x.extension === 'belay' && x.command === 'speckit.belay.close-proposal');
  assert.ok(h, 'the close-proposal hook is missing');
  assert.equal(h.optional, false);
  assert.equal(h.enabled, true);
});
