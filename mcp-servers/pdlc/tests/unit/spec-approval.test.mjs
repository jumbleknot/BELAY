// Approval (feature 016; research R4, R15; FR-008, FR-009). The checks that must pass before anything is written, then
// the publish in its fixed order: stage exactly the feature folder, commit with the one message shape, push exactly the
// feature branch onto itself. The stage move is the caller's, and happens only after the push succeeded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpecApproval, approvalMessage } from '../../src/spec-approval.mjs';
import { Refusal } from '../../src/refusal.mjs';
import { fakeGit } from './helpers/fake-git.mjs';

const refusedWith = (code) => (e) => e instanceof Refusal && e.code === code;
const SPEC = (clar) => `# Feature Specification: Pane probe\n\n**Input**: x\n\n${clar}\n## User Scenarios & Testing\n\nbody\n`;
const CLARIFIED = SPEC('## Clarifications\n\n### Session 2026-11-28\n\n- Q: a? → A: b.\n');
const state = (over = {}) => ({ repo: 'BELAY', number: 91, branch: '017-pane-probe', spec_dir: 'specs/017-pane-probe/', recorded_remote_tip: null,
  sessions_at_start_or_reopen: 0, worktree_path: '/clones/.pdlc-specs/BELAY/017-pane-probe', ...over });

// ── checks (R15) ─────────────────────────────────────────────────────────────────────────────────────────────

const approval = createSpecApproval({ git: fakeGit().git });

test('spec_has_markers lists each [NEEDS CLARIFICATION] marker, in order', () => {
  const spec = CLARIFIED.replace('body', 'body [NEEDS CLARIFICATION: who?] and [NEEDS CLARIFICATION: when?]');
  assert.throws(() => approval.check({ spec, state: state() }), (e) => refusedWith('spec_has_markers')(e)
    && JSON.stringify(e.details.markers) === JSON.stringify(['[NEEDS CLARIFICATION: who?]', '[NEEDS CLARIFICATION: when?]']));
});

test('spec_not_clarified without a ## Clarifications session added since the start', () => {
  assert.throws(() => approval.check({ spec: SPEC(''), state: state() }), refusedWith('spec_not_clarified'));
});

test('spec_not_clarified on a same-day reopen: the count must GROW past the one recorded at the reopen, not just exist', () => {
  assert.throws(() => approval.check({ spec: CLARIFIED, state: state({ sessions_at_start_or_reopen: 1 }) }), refusedWith('spec_not_clarified'));
  const twice = CLARIFIED.replace('- Q: a? → A: b.\n', '- Q: a? → A: b.\n\n### Session 2026-11-28\n\n- Q: c? → A: d.\n');
  assert.doesNotThrow(() => approval.check({ spec: twice, state: state({ sessions_at_start_or_reopen: 1 }) }));
});

test('the "No questions" session line counts as a session (clarify found nothing to ask)', () => {
  const none = SPEC('## Clarifications\n\n### Session 2026-11-28\n\n- No questions: no critical ambiguity found.\n');
  assert.doesNotThrow(() => approval.check({ spec: none, state: state() }));
});

test('the clarify step\'s exact heading shape is accepted; a near-miss is not (US2-AC1)', () => {
  assert.doesNotThrow(() => approval.check({ spec: CLARIFIED, state: state() }));
  for (const nearMiss of [
    SPEC('## Clarification\n\n### Session 2026-11-28\n\n- Q: a? → A: b.\n'),
    SPEC('## Clarifications\n\n#### Session 2026-11-28\n\n- Q: a? → A: b.\n'),
    SPEC('### Clarifications\n\n### Session 2026-11-28\n\n- Q: a? → A: b.\n'),
    SPEC('## Clarifications\n\n### Sessions 2026-11-28\n\n- Q: a? → A: b.\n'),
  ]) assert.throws(() => approval.check({ spec: nearMiss, state: state() }), refusedWith('spec_not_clarified'), nearMiss);
});

test('a session under another ## section does not count', () => {
  const elsewhere = `${CLARIFIED.replace('### Session 2026-11-28\n\n- Q: a? → A: b.\n', '')}\n## Notes\n\n### Session 2026-11-28\n`;
  assert.throws(() => approval.check({ spec: elsewhere, state: state() }), refusedWith('spec_not_clarified'));
});

// ── publish (R4) ─────────────────────────────────────────────────────────────────────────────────────────────

const ctxOf = (st) => ({ cloneRoot: '/clones', repo: 'BELAY', copyPath: '/clones/BELAY', defaultBranch: 'main', featureBranch: st.branch,
  specDir: 'specs/017-pane-probe', recordedRemoteTip: st.recorded_remote_tip });
const WT = '/clones/.pdlc-specs/BELAY/017-pane-probe';
const MSG = "docs(017): approve spec for proposal item #91\n\nApproved in Claude Desktop by the spec's author.";

function publishWorld({ push = {}, dirty = ' M specs/017-pane-probe/spec.md\n', unpushed = '0\n', name = 'Op\n', email = 'op@example.invalid\n' } = {}) {
  return fakeGit({
    'config --get user.name': name === null ? { code: 1 } : { stdout: name },
    'config --get user.email': email === null ? { code: 1 } : { stdout: email },
    'status --porcelain=v1 --untracked-files=all -- specs/017-pane-probe': { stdout: dirty },
    'add -- specs/017-pane-probe': {},
    [`commit --no-verify -m ${MSG}`]: {},
    'rev-list --count origin/017-pane-probe..HEAD': (c) => (c.calls.some((x) => x.args[0] === 'push') ? { stdout: '0\n' } : { code: 128, stderr: 'unknown revision' }),
    'rev-list --count origin/main..HEAD': { stdout: unpushed },
    'push origin refs/heads/017-pane-probe:refs/heads/017-pane-probe': push,
    'rev-parse HEAD': { stdout: `${'c'.repeat(40)}\n` },
  });
}

test('the commit message is R4\'s fixed shape, with the feature number and the proposal item', () => {
  assert.equal(approvalMessage({ branch: '017-pane-probe', number: 91 }), MSG);
  assert.equal(approvalMessage({ branch: 'feature/123-x', number: 7 }), "docs(123): approve spec for proposal item #7\n\nApproved in Claude Desktop by the spec's author.");
});

test('publish: identity first, then add exactly the folder, commit --no-verify, push the branch onto itself — in the worktree, naming the spec', async () => {
  const g = publishWorld();
  const a = createSpecApproval({ git: g.git });
  const st = state();
  const r = await a.publish({ state: st, ctx: ctxOf(st) });
  assert.deepEqual(r, { commit: 'c'.repeat(40), committed: true });
  const seq = g.calls.map((c) => c.args.join(' '));
  assert.deepEqual(seq.filter((s) => /^(add|commit|push)/.test(s)), [
    'add -- specs/017-pane-probe', `commit --no-verify -m ${MSG}`, 'push origin refs/heads/017-pane-probe:refs/heads/017-pane-probe']);
  assert.ok(seq.indexOf('config --get user.name') < seq.indexOf('add -- specs/017-pane-probe'));
  for (const c of g.calls.filter((x) => /^(add|commit|push)$/.test(x.args[0]))) {
    assert.equal(c.cwd, WT);
    assert.equal(c.spec.featureBranch, '017-pane-probe');
  }
});

test('git_identity_missing, before anything is staged, when user.name or user.email is not set', async () => {
  for (const missing of [{ name: null }, { email: null }, { name: '\n' }]) {
    const g = publishWorld(missing);
    const st = state();
    await assert.rejects(createSpecApproval({ git: g.git }).publish({ state: st, ctx: ctxOf(st) }), refusedWith('git_identity_missing'));
    assert.ok(!g.calls.some((c) => ['add', 'commit', 'push'].includes(c.args[0])));
  }
});

test('publish_failed when the push fails: the commit is kept, and the caller is told so (the stage must not move)', async () => {
  const g = publishWorld({ push: { code: 1, stderr: 'remote: unable to access' } });
  const st = state();
  await assert.rejects(createSpecApproval({ git: g.git }).publish({ state: st, ctx: ctxOf(st) }),
    (e) => refusedWith('publish_failed')(e) && /kept/.test(e.reason) && e.details.commit === 'c'.repeat(40));
  assert.ok(g.calls.some((c) => c.args[0] === 'commit'), 'the commit happened and is not undone');
});

test('a re-approval with nothing new to commit still publishes an unpublished commit, and does not make an empty one', async () => {
  const g = publishWorld({ dirty: '', unpushed: '1\n' });
  const st = state();
  const r = await createSpecApproval({ git: g.git }).publish({ state: st, ctx: ctxOf(st) });
  assert.equal(r.committed, false);
  assert.ok(!g.calls.some((c) => c.args[0] === 'commit'));
  assert.ok(g.calls.some((c) => c.args[0] === 'push'));
});
