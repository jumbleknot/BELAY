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
import { execFileSync } from 'node:child_process';
import { createLocalCopy } from '../../src/local-copy.mjs';
import { createGitRunner } from '../../src/git-runner.mjs';
import { createSpecKitRunner } from '../../src/spec-kit-runner.mjs';
import { createSpecWorktree } from '../../src/spec-worktree.mjs';
import { createSpecFiles } from '../../src/spec-files.mjs';
import { fillTemplate } from '../../src/spec-lifecycle.mjs';
import { createSpecApproval } from '../../src/spec-approval.mjs';
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

test('approve for real: one commit touching only the spec folder, on the published feature branch; main untouched; a fresh instance resumes the same files (T032)', async () => {
  const repo = { name: 'target', default_branch: 'main' };
  const copyPath = join(forge.cloneRoot, 'target');
  const bare = forge.originUrlFor('target');
  const mainBefore = sh(forge.root, 'ls-remote', bare, 'refs/heads/main');
  // the workstation's identity: the operator's own (research R4); the test sets one in the copy's config
  sh(copyPath, 'config', 'user.name', 'pdlc-test');
  sh(copyPath, 'config', 'user.email', 'pdlc-test@example.invalid');

  const state = await worktree.resume({ repo, copyPath, number: 91 });
  const spec = '# Feature Specification: Int probe\n\n## Clarifications\n\n### Session 2026-11-28\n\n- No questions: no critical ambiguity found.\n\n## Requirements\n\n- **FR-001**: x\n';
  await files.write({ worktree: state.worktree_path, specDir: 'specs/003-int-probe', path: 'spec.md', content: spec });
  await files.write({ worktree: state.worktree_path, specDir: 'specs/003-int-probe', path: 'checklists/requirements.md', content: '- [x] ok\n' });

  const approval = createSpecApproval({ git });
  approval.check({ spec, state });
  const ctx = { cloneRoot: forge.cloneRoot, repo: 'target', copyPath, defaultBranch: 'main', featureBranch: state.branch, specDir: 'specs/003-int-probe', recordedRemoteTip: null };
  const { commit, committed } = await approval.publish({ state, ctx });
  assert.equal(committed, true);

  // the bare remote has the branch at that commit, one commit ahead of main, touching only specs/003-int-probe/
  assert.equal(sh(forge.root, 'ls-remote', bare, 'refs/heads/003-int-probe').split(/\s+/)[0], commit);
  const work = join(forge.root, 'verify');
  sh(forge.root, 'clone', '--quiet', bare, work);
  assert.equal(sh(work, 'rev-list', '--count', 'origin/main..origin/003-int-probe'), '1');
  const touched = sh(work, 'diff', '--name-only', 'origin/main', 'origin/003-int-probe').split('\n');
  assert.deepEqual(touched.sort(), ['specs/003-int-probe/checklists/requirements.md', 'specs/003-int-probe/spec.md']);
  assert.equal(sh(work, 'log', '-1', '--format=%s', 'origin/003-int-probe'), 'docs(003): approve spec for proposal item #91');
  assert.equal(sh(work, 'log', '-1', '--format=%an', 'origin/003-int-probe'), 'pdlc-test');

  // SC-007: main on the forge is unchanged, the copy is still on main, and nothing but the feature branch was published
  assert.equal(sh(forge.root, 'ls-remote', bare, 'refs/heads/main'), mainBefore);
  assert.equal(sh(copyPath, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.deepEqual(sh(forge.root, 'ls-remote', '--heads', bare).split('\n').map((l) => l.split('refs/heads/')[1]).sort(), ['002-other-feature', '003-int-probe', 'main']);

  // US2-AC3: a fresh server instance (new modules, nothing in memory) resumes the spec exactly as it was left
  const fresh = createSpecWorktree({ cloneRoot: forge.cloneRoot, git: createGitRunner({ token: TOKEN }) });
  const again = await fresh.resume({ repo, copyPath, number: 91 });
  const read = await createSpecFiles().read({ worktree: again.worktree_path, specDir: 'specs/003-int-probe' });
  assert.deepEqual(read.files.map((f) => f.path), ['checklists/requirements.md', 'spec.md']);
  assert.equal(read.files.find((f) => f.path === 'spec.md').content, spec);
});

test('the published branch plans with no fix-up: setup-plan.ps1 resolves the spec folder from the branch, with no feature.json (T042; SC-002, FR-028)', async () => {
  const bare = forge.originUrlFor('target');
  const architect = join(forge.root, 'architect');
  sh(forge.root, 'clone', '--quiet', '--branch', '003-int-probe', bare, architect);
  assert.equal(existsSync(join(architect, '.specify', 'feature.json')), false, 'nothing but the spec folder was published');
  const pwsh = specKit.interpreterPath('ps');
  const setupPlan = () => execFileSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', join(architect, '.specify', 'scripts', 'powershell', 'setup-plan.ps1'), '-Json'],
    { cwd: architect, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_TERMINAL_PROMPT: '0' } });
  // Measured (research R5, T042): Spec Kit 1.4.2 cannot find the spec on a fresh checkout. If this ever passes, Spec
  // Kit gained a branch fallback and BELAY's before_plan feature-dir hook can be retired.
  assert.throws(setupPlan, /Feature directory not found/);
  // The mandatory before_plan hook (speckit.belay.feature-dir) runs BELAY's scripts/feature-dir.mjs first.
  execFileSync(process.execPath, [join(BELAY, 'scripts', 'feature-dir.mjs')], { cwd: architect, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(sh(architect, 'status', '--porcelain'), '', 'the hook writes only the gitignored .specify/feature.json');
  const out = setupPlan();
  const json = JSON.parse(out.trim().split('\n').filter((l) => l.trim().startsWith('{')).at(-1));
  assert.equal(json.FEATURE_SPEC.replace(/\\/g, '/').endsWith('specs/003-int-probe/spec.md'), true, JSON.stringify(json));
  assert.equal(String(json.BRANCH), '003-int-probe');
  assert.ok(existsSync(join(architect, 'specs', '003-int-probe', 'plan.md')), 'the plan template landed in the spec folder');
});

test('the branch changed on the forge: detected, the latest taken with one conflict and one clean edit kept, then published again (T045; US8-AC4, SC-011)', async () => {
  const repo = { name: 'target', default_branch: 'main' };
  const copyPath = join(forge.cloneRoot, 'target');
  const bare = forge.originUrlFor('target');
  const specDir = 'specs/003-int-probe';
  let state = await worktree.resume({ repo, copyPath, number: 91 });
  // what the approve tool records after a publish (T032 published through the module directly)
  const published = sh(forge.root, 'ls-remote', bare, 'refs/heads/003-int-probe').split(/\s+/)[0];
  await worktree.update({ repo, specDir }, { recorded_remote_tip: published });
  state = await worktree.resume({ repo, copyPath, number: 91 });
  assert.deepEqual(await worktree.remoteCheck({ repo, copyPath, state }), { changed: false });

  // someone else edits FR-001 on the forge
  const other = join(forge.root, 'other');
  sh(forge.root, 'clone', '--quiet', '--branch', '003-int-probe', bare, other);
  const remoteSpec = readFileSync(join(other, specDir, 'spec.md'), 'utf8').replace('- **FR-001**: x', '- **FR-001**: changed on the forge');
  writeFileSync(join(other, specDir, 'spec.md'), remoteSpec);
  sh(other, 'commit', '--quiet', '-am', 'docs: edit FR-001 on the forge');
  sh(other, 'push', '--quiet', 'origin', 'HEAD:refs/heads/003-int-probe');
  const remoteTip = sh(other, 'rev-parse', 'HEAD');

  // the author, unpublished: the same line (a conflict) and a checklist line (clean)
  const folder = join(state.worktree_path, specDir);
  writeFileSync(join(folder, 'spec.md'), readFileSync(join(folder, 'spec.md'), 'utf8').replace('- **FR-001**: x', '- **FR-001**: changed by the author'));
  writeFileSync(join(folder, 'checklists', 'requirements.md'), '- [x] ok\n- [x] the author adds this\n');

  const check = await worktree.remoteCheck({ repo, copyPath, state });
  assert.equal(check.changed, true);
  assert.equal(check.remote_tip, remoteTip);
  assert.deepEqual(check.commits.map((c) => c.subject), ['docs: edit FR-001 on the forge']);
  assert.match(check.diffstat, /spec\.md/);
  // nothing was published by the check, and main is untouched
  assert.equal(sh(forge.root, 'ls-remote', bare, 'refs/heads/003-int-probe').split(/\s+/)[0], remoteTip);

  const r = await worktree.takeLatest({ repo, copyPath, state });
  assert.deepEqual(r.conflicts, ['spec.md']);
  assert.deepEqual(r.merged, ['checklists/requirements.md']);
  const merged = readFileSync(join(folder, 'spec.md'), 'utf8');
  assert.match(merged, /<<<<<<< .*\n- \*\*FR-001\*\*: changed by the author\n=======\n- \*\*FR-001\*\*: changed on the forge\n>>>>>>> /);
  assert.equal(readFileSync(join(folder, 'checklists', 'requirements.md'), 'utf8'), '- [x] ok\n- [x] the author adds this\n', 'the clean edit is kept');
  assert.equal(sh(state.worktree_path, 'rev-parse', 'HEAD'), remoteTip, 'fast-forwarded to the published branch');
  assert.match(readFileSync(join(r.backup_path, 'spec.md'), 'utf8'), /changed by the author/, 'the author\'s file was backed up first');
  assert.equal(sh(forge.root, 'ls-remote', bare, 'refs/heads/003-int-probe').split(/\s+/)[0], remoteTip, 'take-latest publishes nothing');

  // the author resolves the conflict and approves again: published on top, nothing rewritten
  writeFileSync(join(folder, 'spec.md'), merged.replace(/<<<<<<< [^\n]*\n[^\n]*\n=======\n([^\n]*)\n>>>>>>> [^\n]*\n/, '$1\n- **FR-002**: and the author\'s point\n'));
  state = await worktree.resume({ repo, copyPath, number: 91 });
  assert.equal(state.recorded_remote_tip, remoteTip);
  assert.deepEqual(await worktree.remoteCheck({ repo, copyPath, state }), { changed: false });
  const ctx = { cloneRoot: forge.cloneRoot, repo: 'target', copyPath, defaultBranch: 'main', featureBranch: state.branch, specDir, recordedRemoteTip: state.recorded_remote_tip };
  const { commit } = await createSpecApproval({ git }).publish({ state, ctx });
  assert.equal(sh(forge.root, 'ls-remote', bare, 'refs/heads/003-int-probe').split(/\s+/)[0], commit);
  const verify = join(forge.root, 'verify2');
  sh(forge.root, 'clone', '--quiet', '--branch', '003-int-probe', bare, verify);
  assert.equal(sh(verify, 'merge-base', '--is-ancestor', remoteTip, 'HEAD') === '' ? 'ancestor' : 'no', 'ancestor', 'the forge\'s commit is kept, not rewritten');
  assert.match(readFileSync(join(verify, specDir, 'checklists', 'requirements.md'), 'utf8'), /the author adds this/);
  assert.match(readFileSync(join(verify, specDir, 'spec.md'), 'utf8'), /changed on the forge[\s\S]*and the author's point/);
});

test('a push straight to the default branch is refused by the server, even in a valid shape (push_target_refused)', async () => {
  const copyPath = join(forge.cloneRoot, 'target');
  const state = await worktree.resume({ repo: { name: 'target', default_branch: 'main' }, copyPath, number: 91 });
  const ctx = { cloneRoot: forge.cloneRoot, repo: 'target', copyPath, defaultBranch: 'main', featureBranch: 'main', specDir: 'specs/003-int-probe' };
  await assert.rejects(git.run(['push', 'origin', 'refs/heads/main:refs/heads/main'], { cwd: state.worktree_path, spec: ctx }), (e) => e.code === 'push_target_refused');
});

test('US7, SC-005: a repository without Spec Kit is reported as not set up, and gains no branch, commit or file (T057)', async () => {
  forge.createRepo('plain', { files: { 'README.md': '# no spec kit here\n' } });
  const repo = { name: 'plain', default_branch: 'main' };
  assert.equal((await lc.sync(repo)).action, 'cloned');
  const copyPath = join(forge.cloneRoot, 'plain');
  const heads = sh(forge.root, 'ls-remote', '--heads', forge.originUrlFor('plain'));
  const before = copyState(copyPath);
  const kit = await specKit.inspect({ copyPath });
  assert.deepEqual([kit.initialised, kit.ok], [false, false]);
  assert.match(kit.reason, /not set up for Spec Kit/);
  assert.equal(sh(forge.root, 'ls-remote', '--heads', forge.originUrlFor('plain')), heads, 'no new branch on the forge');
  assert.deepEqual(copyState(copyPath), before, 'the copy is byte-identical');
  assert.equal(existsSync(join(forge.cloneRoot, '.pdlc-specs', 'plain')), false);
});
