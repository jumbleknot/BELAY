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

test('empty hooks', () => {
  assert.deepEqual(parseExtensionsYml('installed: []\nhooks: {}\n'), { installed: [], hooks: {} });
});
