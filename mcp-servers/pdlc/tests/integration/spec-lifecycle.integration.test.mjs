// Starting a spec for real (feature 016, T022; US1-AC1, SC-007): real git against a local bare repository seeded with
// BELAY's own .specify/, and the REAL Spec Kit scripts run by the REAL pwsh in a scratch clone. No doubles (constitution
// Test Type Integrity). This is the git-and-scripts half of start_spec: the copy, the scratch clone, the repository's
// own numbering, the worktree, and the spec written from the repository's own template. The forge half (the stage move
// and its comment) is covered by the unit tier; this tier has no forge.
//
// pwsh is required: CI installs a pinned one (research M9), the dev container ships one. Missing, this test FAILS; it
// never skips (AGENTS.md: a skip is not a pass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalCopy } from '../../src/local-copy.mjs';
import { createGitRunner } from '../../src/git-runner.mjs';
import { createSpecKitRunner } from '../../src/spec-kit-runner.mjs';
import { createSpecWorktree } from '../../src/spec-worktree.mjs';
import { createSpecFiles } from '../../src/spec-files.mjs';
import { fillTemplate } from '../../src/spec-lifecycle.mjs';
import { bareForge, sh, copyState } from './helpers/bare-forge.mjs';

const TOKEN = 'canary-integration-0123456789abcdef';
const BELAY = new URL('../../../../', import.meta.url).pathname;
const forge = bareForge();
test.after(() => forge.cleanup());

const git = createGitRunner({ token: TOKEN });
const lc = createLocalCopy({ cloneRoot: forge.cloneRoot, originUrlFor: forge.originUrlFor, git });
const specKit = createSpecKitRunner({ cloneRoot: forge.cloneRoot, git, baseEnv: { ...process.env, PDLC_FORGE_TOKEN: TOKEN } });
const worktree = createSpecWorktree({ cloneRoot: forge.cloneRoot, git });
const files = createSpecFiles();

function seedRepo() {
  const src = forge.createRepo('target', { files: { 'README.md': '# target\n', 'specs/001-first-thing/spec.md': '# Feature Specification: first\n' } });
  // BELAY's own Spec Kit: its scripts, templates, init-options and extensions.yml, and the two prompts.
  cpSync(join(BELAY, '.specify'), join(src.work, '.specify'), { recursive: true, filter: (p) => !p.includes(`${join('.specify', 'memory')}`) });
  // Until T040 replaces BELAY's after_specify close-proposal hook with spec-stage (which the server handles natively),
  // BELAY's own extensions.yml would be refused spec_hook_unsupported: correctly. Seed it as it will be after T040.
  // T040 removes this rewrite (its task says so).
  const ext = join(src.work, '.specify', 'extensions.yml');
  const extText = readFileSync(ext, 'utf8');
  if (extText.includes('speckit.belay.close-proposal')) writeFileSync(ext, extText.replaceAll('speckit.belay.close-proposal', 'speckit.belay.spec-stage'));
  for (const skill of ['speckit-specify', 'speckit-clarify']) {
    cpSync(join(BELAY, '.claude', 'skills', skill), join(src.work, '.claude', 'skills', skill), { recursive: true });
  }
  sh(src.work, 'add', '-A');
  sh(src.work, 'commit', '-m', 'add Spec Kit');
  sh(src.work, 'push', 'origin', 'HEAD:refs/heads/main');
  // Someone else's feature branch, number 002, on the forge only: the number-clash case (research R1).
  sh(src.work, 'checkout', '-b', '002-other-feature');
  sh(src.work, 'commit', '--allow-empty', '-m', 'another session\'s feature');
  sh(src.work, 'push', 'origin', 'HEAD:refs/heads/002-other-feature');
  sh(src.work, 'checkout', 'main');
  return src;
}

test('pwsh is on the PATH (required: the integration tier fails, never skips, without it)', () => {
  const r = specKit.interpreterPath?.('ps');
  assert.ok(r, 'no pwsh on the PATH: install it (CI does, through scripts/install-pwsh.mjs; research M9)');
});

test('start a spec for real: the repository\'s own dry run numbers past the forge\'s branches, the worktree is on that branch, the copy stays on main', async () => {
  seedRepo();
  const repo = { name: 'target', default_branch: 'main' };
  const copyPath = join(forge.cloneRoot, 'target');
  assert.equal((await lc.sync(repo)).action, 'cloned');

  const kit = await specKit.inspect({ copyPath });
  assert.equal(kit.ok, true, kit.reason);
  const prep = await specKit.prepare({ repo, copyPath, shortName: 'int-probe', script: kit.script });
  // 001 is a spec on main, 002 a branch only on the forge: the repository's own numbering gives 003
  assert.equal(prep.branch, '003-int-probe');
  assert.equal(prep.feature_num, '003');
  assert.match(prep.template, /^# Feature Specification: \[FEATURE NAME\]/m, 'the repository\'s own resolved template');
  assert.deepEqual(existsSync(join(forge.cloneRoot, '.pdlc-scratch')) ? readdirSync(join(forge.cloneRoot, '.pdlc-scratch')) : [], [], 'the scratch clone is deleted');

  const before = copyState(copyPath);
  const state = await worktree.create({ repo, copyPath, number: 91, branch: prep.branch, specDir: 'specs/003-int-probe', withdrawn: [], proposalUpdatedAt: 'x' });
  const content = fillTemplate(prep.template, { number: 91, title: 'Proposal: Int probe', body: '### Problem\n\nA problem.', branch: prep.branch, date: '2026-11-28' });
  await files.write({ worktree: state.worktree_path, specDir: 'specs/003-int-probe', path: 'spec.md', content });

  // the worktree is on the feature branch, holding the spec as an uncommitted file
  assert.equal(sh(state.worktree_path, 'symbolic-ref', '--short', 'HEAD'), '003-int-probe');
  assert.match(readFileSync(join(state.worktree_path, 'specs', '003-int-probe', 'spec.md'), 'utf8'), /Proposal #91: Proposal: Int probe/);
  assert.match(sh(state.worktree_path, 'status', '--porcelain'), /\?\? specs\/003-int-probe\//);

  // SC-007: the copy is still on main, clean, at the same commit; the branch exists only locally, unpublished
  const after = copyState(copyPath);
  assert.equal(sh(copyPath, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal(after.status, '');
  assert.equal(after.head, before.head);
  assert.equal(sh(forge.root, 'ls-remote', '--heads', forge.originUrlFor('target')).includes('003-int-probe'), false, 'nothing was published');
  assert.equal(readFileSync(join(copyPath, '.git', 'config'), 'utf8').includes(TOKEN), false, 'the token is in no git config');

  // resume finds it again from disk
  assert.equal((await worktree.resume({ repo, copyPath, number: 91 })).branch, '003-int-probe');
});

test('a second spec on this workstation takes the next number even though the first branch is not published', async () => {
  const repo = { name: 'target', default_branch: 'main' };
  const copyPath = join(forge.cloneRoot, 'target');
  const prep = await specKit.prepare({ repo, copyPath, shortName: 'second-probe' });
  assert.equal(prep.branch, '004-second-probe', 'the unpublished 003 branch in the copy counts (its local heads are the scratch clone\'s origin)');
});
