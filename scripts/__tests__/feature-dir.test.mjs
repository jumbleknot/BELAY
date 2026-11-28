// feature-dir.mjs: the before_plan hook's one deterministic step (feature 016, research R5 as measured in T042).
// Spec Kit 1.4.2 finds the feature folder only from SPECIFY_FEATURE_DIRECTORY or the gitignored .specify/feature.json,
// which only the specify step writes, so a fresh checkout of a published feature branch cannot run /speckit-plan.
// This writes that local file from the branch, and only when the branch's spec folder really exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFeatureDir, main } from '../feature-dir.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

function repo(branch = '017-pane-probe', { spec = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'feature-dir-'));
  git(root, 'init', '--quiet', '--initial-branch', 'main');
  mkdirSync(join(root, '.specify'), { recursive: true });
  writeFileSync(join(root, 'README.md'), 'x\n');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'init');
  git(root, 'checkout', '--quiet', '-b', branch);
  if (spec) {
    mkdirSync(join(root, 'specs', branch.split('/').pop()), { recursive: true });
    writeFileSync(join(root, 'specs', branch.split('/').pop(), 'spec.md'), '# spec\n');
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const fj = (root) => join(root, '.specify', 'feature.json');

test('no feature.json on a feature branch whose specs/<branch>/spec.md exists: writes Spec Kit\'s compact feature.json', () => {
  const r = repo();
  try {
    const out = resolveFeatureDir({ cwd: r.root, env: {} });
    assert.deepEqual(out, { featureDir: 'specs/017-pane-probe', source: 'branch', wrote: true });
    assert.equal(readFileSync(fj(r.root), 'utf8'), '{"feature_directory":"specs/017-pane-probe"}');
  } finally { r.cleanup(); }
});

test('a feature.json that names an existing spec is left alone (Spec Kit\'s own precedence)', () => {
  const r = repo();
  try {
    mkdirSync(join(r.root, 'specs', '009-other'), { recursive: true });
    writeFileSync(join(r.root, 'specs', '009-other', 'spec.md'), '# other\n');
    writeFileSync(fj(r.root), '{"feature_directory":"specs/009-other"}');
    assert.deepEqual(resolveFeatureDir({ cwd: r.root, env: {} }), { featureDir: 'specs/009-other', source: 'feature.json', wrote: false });
    assert.equal(readFileSync(fj(r.root), 'utf8'), '{"feature_directory":"specs/009-other"}');
  } finally { r.cleanup(); }
});

test('SPECIFY_FEATURE_DIRECTORY set: nothing to do, nothing written', () => {
  const r = repo();
  try {
    assert.deepEqual(resolveFeatureDir({ cwd: r.root, env: { SPECIFY_FEATURE_DIRECTORY: 'specs/017-pane-probe' } }), { featureDir: 'specs/017-pane-probe', source: 'env', wrote: false });
    assert.equal(existsSync(fj(r.root)), false);
  } finally { r.cleanup(); }
});

test('a feature.json naming a folder with no spec.md is stale: replaced from the branch when the branch has a spec', () => {
  const r = repo();
  try {
    writeFileSync(fj(r.root), '{"feature_directory":"specs/001-gone"}');
    assert.deepEqual(resolveFeatureDir({ cwd: r.root, env: {} }), { featureDir: 'specs/017-pane-probe', source: 'branch', wrote: true });
  } finally { r.cleanup(); }
});

test('refuses (exit 2, nothing written) on the default branch, or a branch with no spec folder, naming what to do', async () => {
  for (const [branch, opts] of [['main', { spec: false }], ['017-no-spec', { spec: false }]]) {
    const r = repo(branch === 'main' ? 'feature-x' : branch, opts);
    try {
      if (branch === 'main') git(r.root, 'checkout', '--quiet', 'main');
      const lines = [];
      assert.equal(await main([], { cwd: r.root, env: {}, log: (l) => lines.push(l), error: (l) => lines.push(l) }), 2);
      assert.match(lines.join('\n'), /cannot tell which spec to plan/);
      assert.equal(existsSync(fj(r.root)), false);
    } finally { r.cleanup(); }
  }
});

test('the CLI prints the folder and where it came from, and exits 0', async () => {
  const r = repo();
  try {
    const lines = [];
    assert.equal(await main([], { cwd: r.root, env: {}, log: (l) => lines.push(l), error: (l) => lines.push(l) }), 0);
    assert.match(lines.join('\n'), /feature directory: specs\/017-pane-probe \(from branch 017-pane-probe; wrote \.specify\/feature\.json\)/);
    assert.equal(await main(['--bogus'], { cwd: r.root, env: {}, log: () => {}, error: () => {} }), 2);
  } finally { r.cleanup(); }
});
