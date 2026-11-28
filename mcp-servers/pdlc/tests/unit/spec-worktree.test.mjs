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

// ── R8: the branch changed on the forge, and taking the latest (FR-022, US8-AC4, SC-011) ───────────────────────────
const TIP = 'a'.repeat(40);
const REMOTE = 'b'.repeat(40);
const published = (over = {}) => ({ repo: 'BELAY', number: 91, branch: BRANCH, spec_dir: `${SPEC_DIR}/`, recorded_remote_tip: TIP, ...over });

test('remoteCheck: unchanged when the forge tip is the recorded one, or when neither exists yet', async () => {
  for (const [recorded, remote] of [[TIP, TIP], [null, null]]) {
    const s = setup({
      [`fetch origin +refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]: {},
      [`rev-parse --verify --quiet refs/remotes/origin/${BRANCH}`]: remote ? { stdout: `${remote}\n` } : { code: 1 },
    });
    try {
      const st = { ...published({ recorded_remote_tip: recorded }), worktree_path: s.wtPath };
      assert.deepEqual(await s.wt.remoteCheck({ repo: REPO, copyPath: s.copyPath, state: st }), { changed: false });
    } finally { s.cleanup(); }
  }
});

test('remoteCheck: changed returns the remote tip, the commits (sha, author, subject) and a diffstat of the spec folder', async () => {
  const s = setup({
    [`fetch origin +refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]: {},
    [`rev-parse --verify --quiet refs/remotes/origin/${BRANCH}`]: { stdout: `${REMOTE}\n` },
    [`log --format=%H%x09%an%x09%s ${TIP}..${REMOTE}`]: { stdout: `${REMOTE}\tAn Architect\tdocs: tighten FR-002\n` },
    [`diff --stat ${TIP} ${REMOTE} -- ${SPEC_DIR}`]: { stdout: ' specs/017-pane-probe/spec.md | 2 +-\n 1 file changed\n' },
  });
  try {
    const st = { ...published(), worktree_path: s.wtPath };
    assert.deepEqual(await s.wt.remoteCheck({ repo: REPO, copyPath: s.copyPath, state: st }), {
      changed: true, remote_tip: REMOTE,
      commits: [{ sha: REMOTE, author: 'An Architect', subject: 'docs: tighten FR-002' }],
      diffstat: ' specs/017-pane-probe/spec.md | 2 +-\n 1 file changed',
    });
  } finally { s.cleanup(); }
});

test('takeLatest: nothing_to_take when the forge has not moved, and nothing is written', async () => {
  const s = setup({
    [`fetch origin +refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]: {},
    [`rev-parse --verify --quiet refs/remotes/origin/${BRANCH}`]: { stdout: `${TIP}\n` },
  });
  try {
    const st = { ...published(), worktree_path: s.wtPath };
    await assert.rejects(s.wt.takeLatest({ repo: REPO, copyPath: s.copyPath, state: st }), refusedWith('nothing_to_take'));
    assert.ok(!existsSync(join(s.root, '.pdlc-backups')));
  } finally { s.cleanup(); }
});

test('takeLatest: backs up first; soft-resets ONLY an unpublished commit, ONLY onto the recorded tip; merges per file; lists conflicts', async () => {
  const s = setup();
  const folder = join(s.wtPath, SPEC_DIR);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'spec.md'), 'mine\n');
  const order = [];
  const g = fakeGit({
    [`fetch origin +refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]: {},
    [`rev-parse --verify --quiet refs/remotes/origin/${BRANCH}`]: { stdout: `${REMOTE}\n` },
    [`log --format=%H%x09%an%x09%s ${TIP}..${REMOTE}`]: { stdout: '' },
    [`diff --stat ${TIP} ${REMOTE} -- ${SPEC_DIR}`]: { stdout: '' },
    [`rev-list --count ${TIP}..HEAD`]: () => { order.push('count'); return { stdout: '1\n' }; },
    [`reset --soft ${TIP}`]: () => { order.push(`reset-soft:${existsSync(join(s.root, '.pdlc-backups')) ? 'after-backup' : 'BEFORE-BACKUP'}`); return {}; },
    [`show ${TIP}:${SPEC_DIR}/spec.md`]: { stdout: 'base\n' },
    [`show ${REMOTE}:${SPEC_DIR}/spec.md`]: { stdout: 'theirs\n' },
    [`reset -- ${SPEC_DIR}`]: () => { order.push('unstage'); return {}; },
    [`merge --ff-only origin/${BRANCH}`]: () => { order.push('ff'); return {}; },
  });
  // merge-file: one conflict (exit 1, the merge with markers on stdout)
  const realRun = g.git.run.bind(g.git);
  g.git.run = async (args, opts) => {
    if (args[0] === 'merge-file') {
      order.push('merge-file');
      const { GitError } = await import('../../src/git-runner.mjs');
      throw new GitError('git merge-file failed (exit 1)', { exitCode: 1, stderr: '', stdout: '<<<<<<< ours\nmine\n=======\ntheirs\n>>>>>>> theirs\n' });
    }
    return realRun(args, opts);
  };
  try {
    const wt = createSpecWorktree({ cloneRoot: s.root, git: g.git, now: () => NOW });
    const st = { ...published(), worktree_path: s.wtPath };
    const r = await wt.takeLatest({ repo: REPO, copyPath: s.copyPath, state: st });
    assert.deepEqual(order, ['count', 'reset-soft:after-backup', 'merge-file', 'unstage', 'ff']);
    assert.deepEqual(r.conflicts, ['spec.md']);
    assert.deepEqual(r.merged, []);
    assert.match(readFileSync(join(folder, 'spec.md'), 'utf8'), /^<<<<<<< ours\nmine\n/);
    assert.equal(readFileSync(join(r.backup_path, 'spec.md'), 'utf8'), 'mine\n', 'the author\'s file is backed up as it was');
    assert.ok(r.backup_path.startsWith(join(s.root, '.pdlc-backups', 'BELAY', '017-pane-probe')));
    // the soft reset named the recorded tip as its only allowed target
    assert.equal(g.calls.find((c) => c.args[0] === 'reset' && c.args[1] === '--soft').spec.recordedRemoteTip, TIP);
  } finally { s.cleanup(); }
});

test('takeLatest: no unpublished commit means no reset at all (no published commit is ever moved)', async () => {
  const s = setup();
  const folder = join(s.wtPath, SPEC_DIR);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'spec.md'), 'base\n');
  const g = fakeGit({
    [`fetch origin +refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]: {},
    [`rev-parse --verify --quiet refs/remotes/origin/${BRANCH}`]: { stdout: `${REMOTE}\n` },
    [`log --format=%H%x09%an%x09%s ${TIP}..${REMOTE}`]: { stdout: '' },
    [`diff --stat ${TIP} ${REMOTE} -- ${SPEC_DIR}`]: { stdout: '' },
    [`rev-list --count ${TIP}..HEAD`]: { stdout: '0\n' },
    [`show ${TIP}:${SPEC_DIR}/spec.md`]: { stdout: 'base\n' },
    [`show ${REMOTE}:${SPEC_DIR}/spec.md`]: { stdout: 'theirs\n' },
    [`reset -- ${SPEC_DIR}`]: {},
    [`merge --ff-only origin/${BRANCH}`]: () => { writeFileSync(join(folder, 'spec.md'), 'theirs\n'); return {}; },
  });
  try {
    const wt = createSpecWorktree({ cloneRoot: s.root, git: g.git, now: () => NOW });
    const r = await wt.takeLatest({ repo: REPO, copyPath: s.copyPath, state: { ...published(), worktree_path: s.wtPath } });
    assert.ok(!g.calls.some((c) => c.args[0] === 'reset' && c.args[1] === '--soft'));
    assert.ok(!g.calls.some((c) => c.args[0] === 'merge-file'), 'an unchanged file needs no merge: the fast-forward brings theirs');
    assert.deepEqual(r.conflicts, []);
    assert.equal(readFileSync(join(folder, 'spec.md'), 'utf8'), 'theirs\n');
  } finally { s.cleanup(); }
});
