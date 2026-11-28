// One git worktree per spec in progress, and its state file (feature 016; research R2, R8; data-model.md "Spec in
// progress"). The local copy stays on its default branch, fast-forward only, exactly as feature 014 left it: the
// feature branch is created in a worktree of its own at <clone_root>/.pdlc-specs/<Repo>/<NNN-slug>/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpecWorktree } from '../../src/spec-worktree.mjs';
import { Refusal } from '../../src/refusal.mjs';
import { fakeGit } from './helpers/fake-git.mjs';

const refusedWith = (code) => (e) => e instanceof Refusal && e.code === code;
const REPO = { name: 'BELAY', default_branch: 'main' };
const BRANCH = '017-pane-probe';
const SPEC_DIR = 'specs/017-pane-probe';
const NOW = new Date('2026-11-27T23:59:00Z');

function setup(script = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pdlc-wt-'));
  const copyPath = join(root, 'BELAY');
  mkdirSync(copyPath);
  const wtPath = join(root, '.pdlc-specs', 'BELAY', '017-pane-probe');
  const g = fakeGit({
    'fetch origin +refs/heads/*:refs/remotes/origin/*': { stdout: '' },
    [`rev-parse --verify --quiet refs/remotes/origin/${BRANCH}`]: { code: 1 },
    [`rev-parse --verify --quiet refs/heads/${BRANCH}`]: { code: 1 },
    [`worktree add -b ${BRANCH} ${wtPath} origin/main`]: () => { mkdirSync(join(wtPath, SPEC_DIR), { recursive: true }); return { stdout: '' }; },
    'worktree list --porcelain': { stdout: `worktree ${copyPath}\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/main\n\nworktree ${wtPath}\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/${BRANCH}\n\n` },
    ...script,
  });
  const wt = createSpecWorktree({ cloneRoot: root, git: g.git, now: () => NOW });
  return { root, copyPath, wtPath, g, wt, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const create = (s, over = {}) => s.wt.create({ repo: REPO, copyPath: s.copyPath, number: 91, branch: BRANCH, specDir: SPEC_DIR,
  withdrawn: [], proposalUpdatedAt: '2026-11-26T12:27:07Z', sessionsAtStart: 0, ...over });

test('create: fetch every head, check the branch is free locally and on the forge, then worktree add -b from origin/<default>', async () => {
  const s = setup();
  try {
    await create(s);
    assert.deepEqual(s.g.calls.map((c) => [c.args.join(' '), c.cwd]), [
      ['fetch origin +refs/heads/*:refs/remotes/origin/*', s.copyPath],
      [`rev-parse --verify --quiet refs/remotes/origin/${BRANCH}`, s.copyPath],
      [`rev-parse --verify --quiet refs/heads/${BRANCH}`, s.copyPath],
      [`worktree add -b ${BRANCH} ${s.wtPath} origin/main`, s.copyPath],
    ]);
    // the worktree add names its spec, which is what the git allowlist checks the shape against
    assert.deepEqual(s.g.calls.at(-1).spec, { cloneRoot: s.root, repo: 'BELAY', copyPath: s.copyPath, defaultBranch: 'main', featureBranch: BRANCH, specDir: SPEC_DIR });
  } finally { s.cleanup(); }
});

test('create: the state file holds data-model.md\'s fields, and only what git cannot answer', async () => {
  const s = setup();
  try {
    const state = await create(s);
    const file = join(s.root, '.pdlc-specs', 'BELAY', '017-pane-probe.state.json');
    assert.ok(existsSync(file));
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(onDisk, {
      repo: 'BELAY', number: 91, branch: BRANCH, spec_dir: `${SPEC_DIR}/`, recorded_remote_tip: null,
      last_start_or_reopen: '2026-11-27', sessions_at_start_or_reopen: 0, proposal_updated_at_start: '2026-11-26T12:27:07Z',
      withdrawn: false, state_version: 1,
    });
    assert.deepEqual(state, { ...onDisk, worktree_path: s.wtPath });
  } finally { s.cleanup(); }
});

test('branch_exists: the branch is already on the forge, or already a local branch of the copy', async () => {
  for (const which of ['remotes/origin', 'heads']) {
    const s = setup({ [`rev-parse --verify --quiet refs/${which}/${BRANCH}`]: { stdout: 'b'.repeat(40) } });
    try {
      await assert.rejects(create(s), (e) => refusedWith('branch_exists')(e) && e.reason.includes(BRANCH));
      assert.ok(!s.g.calls.some((c) => c.args[0] === 'worktree'), 'no worktree add after the refusal');
      assert.ok(!existsSync(join(s.root, '.pdlc-specs', 'BELAY', '017-pane-probe.state.json')));
    } finally { s.cleanup(); }
  }
});

test('branch_exists: a folder already at the worktree path is never reused', async () => {
  const s = setup();
  try {
    mkdirSync(s.wtPath, { recursive: true });
    await assert.rejects(create(s), refusedWith('branch_exists'));
  } finally { s.cleanup(); }
});

test('a withdrawn branch is never reused (data-model.md Proposal issue.withdrawn_branches), before git runs', async () => {
  const s = setup();
  try {
    await assert.rejects(create(s, { withdrawn: ['016-old', BRANCH] }), (e) => refusedWith('branch_exists')(e) && /withdrawn/.test(e.reason));
    assert.equal(s.g.calls.length, 0);
  } finally { s.cleanup(); }
});

test('resume: the state file for a proposal is found and checked against git worktree list', async () => {
  const s = setup();
  try {
    await create(s);
    const found = await s.wt.resume({ repo: REPO, copyPath: s.copyPath, number: 91 });
    assert.equal(found.branch, BRANCH);
    assert.equal(found.worktree_path, s.wtPath);
    assert.equal(await s.wt.resume({ repo: REPO, copyPath: s.copyPath, number: 92 }), null, 'no spec for another proposal');
  } finally { s.cleanup(); }
});

test('spec_state_inconsistent: a state file whose worktree git does not list, or lists on another branch, writes nothing', async () => {
  const s = setup();
  try {
    await create(s);
    const wrong = fakeGit({ 'worktree list --porcelain': { stdout: `worktree ${s.copyPath}\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/main\n\n` } });
    const other = createSpecWorktree({ cloneRoot: s.root, git: wrong.git, now: () => NOW });
    await assert.rejects(other.resume({ repo: REPO, copyPath: s.copyPath, number: 91 }), refusedWith('spec_state_inconsistent'));
    const onOtherBranch = fakeGit({ 'worktree list --porcelain': { stdout: `worktree ${s.wtPath}\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/main\n\n` } });
    await assert.rejects(createSpecWorktree({ cloneRoot: s.root, git: onOtherBranch.git }).resume({ repo: REPO, copyPath: s.copyPath, number: 91 }),
      refusedWith('spec_state_inconsistent'));
  } finally { s.cleanup(); }
});

test('spec_state_inconsistent: an unreadable state file, or two in-progress state files for one proposal', async () => {
  const s = setup();
  try {
    mkdirSync(join(s.root, '.pdlc-specs', 'BELAY'), { recursive: true });
    writeFileSync(join(s.root, '.pdlc-specs', 'BELAY', '017-pane-probe.state.json'), '{ not json');
    await assert.rejects(s.wt.resume({ repo: REPO, copyPath: s.copyPath, number: 91 }), refusedWith('spec_state_inconsistent'));
    const good = (branch) => JSON.stringify({ repo: 'BELAY', number: 91, branch, spec_dir: `specs/${branch}/`, recorded_remote_tip: null,
      last_start_or_reopen: '2026-11-27', sessions_at_start_or_reopen: 0, proposal_updated_at_start: 'x', withdrawn: false, state_version: 1 });
    writeFileSync(join(s.root, '.pdlc-specs', 'BELAY', '017-pane-probe.state.json'), good('017-pane-probe'));
    writeFileSync(join(s.root, '.pdlc-specs', 'BELAY', '018-again.state.json'), good('018-again'));
    await assert.rejects(s.wt.resume({ repo: REPO, copyPath: s.copyPath, number: 91 }), refusedWith('spec_state_inconsistent'));
  } finally { s.cleanup(); }
});

test('a withdrawn state file is not resumed', async () => {
  const s = setup();
  try {
    await create(s);
    const file = join(s.root, '.pdlc-specs', 'BELAY', '017-pane-probe.state.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), withdrawn: true }));
    assert.equal(await s.wt.resume({ repo: REPO, copyPath: s.copyPath, number: 91 }), null);
  } finally { s.cleanup(); }
});

test('the state is read from disk every time: a second module instance sees the first one\'s spec', async () => {
  const s = setup();
  try {
    await create(s);
    const other = createSpecWorktree({ cloneRoot: s.root, git: s.g.git });
    assert.equal((await other.resume({ repo: REPO, copyPath: s.copyPath, number: 91 })).branch, BRANCH);
  } finally { s.cleanup(); }
});
