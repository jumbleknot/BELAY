// The spec tools over the real protocol (feature 016; contracts/tools.md "Spec Kit check" and "Spec lifecycle"):
// check_spec_kit, start_spec, get_spec and write_spec_file, through the real modules (spec-world.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { specWorld, ISO_DAY } from './helpers/spec-world.mjs';

const BRANCH = '017-pane-probe';
const SPEC_DIR = 'specs/017-pane-probe/';
const refused = (r, code) => {
  assert.equal(r.isError, true, JSON.stringify(r.payload));
  assert.equal(r.payload.code, code, JSON.stringify(r.payload));
};
const ok = (r) => assert.notEqual(r.isError, true, JSON.stringify(r.payload));

// ── check_spec_kit ───────────────────────────────────────────────────────────────────────────────────────────────

test('check_spec_kit reports the copy\'s Spec Kit and changes nothing', async () => {
  const w = await specWorld();
  try {
    const r = await w.c.call('check_spec_kit', { repo: 'belay' });
    ok(r);
    assert.equal(r.payload.repo, 'BELAY');
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.version, '1.4.2');
    assert.ok(r.payload.hooks.some((h) => h.command === 'speckit.git.feature' && h.handling === 'server'));
    assert.deepEqual(w.forge.writes(), []);
    assert.ok(!w.calls.some((c) => ['clone', 'worktree', 'fetch'].includes(c.args[0])), 'reads only');
  } finally { await w.close(); }
});

// ── start_spec (US1) ─────────────────────────────────────────────────────────────────────────────────────────────

test('US1-AC4 start_spec refuses not_ready_proposal for a draft proposal and for an issue that is not a proposal, creating nothing', async () => {
  const w = await specWorld();
  try {
    const draft = w.ready({ labels: ['type/proposal', 'status/proposal-draft', 'priority/p2'] });
    const bug = w.forge.addIssue('BELAY', { title: 'A bug', labels: ['type/bug', 'priority/p1'] });
    for (const n of [draft.number, bug.number]) {
      const r = await w.c.call('start_spec', { repo: 'BELAY', number: n, short_name: 'pane-probe' });
      refused(r, 'not_ready_proposal');
    }
    assert.deepEqual(w.forge.writes(), []);
    assert.ok(!existsSync(w.worktreePath));
  } finally { await w.close(); }
});

test('US1-AC1 start_spec creates the branch the repository\'s own dry run named, in a worktree, and returns the contract shape', async () => {
  const w = await specWorld();
  try {
    const p = w.ready();
    const r = await w.c.call('start_spec', { repo: 'belay', number: p.number, short_name: 'pane-probe' });
    ok(r);
    assert.deepEqual(Object.keys(r.payload).sort(), ['branch', 'feature_num', 'hooks', 'number', 'repo', 'revision', 'spec_dir', 'template_resolved', 'worktree_path'].sort());
    assert.equal(r.payload.branch, BRANCH);
    assert.equal(r.payload.feature_num, '017');
    assert.equal(r.payload.spec_dir, SPEC_DIR);
    assert.equal(r.payload.worktree_path, w.worktreePath);
    assert.equal(r.payload.template_resolved, true);
    assert.match(r.payload.revision, /^[0-9a-f]{64}$/);
    assert.ok(w.worktrees.some((x) => x.path === w.worktreePath && x.branch === BRANCH));
    // the copy is never moved off its default branch: no checkout, commit or branch in it (SC-007)
    assert.ok(!w.calls.some((c) => c.cwd === w.copyPath && ['checkout', 'commit', 'add', 'push', 'reset'].includes(c.args[0])));
  } finally { await w.close(); }
});

test('FR-003 spec.md is the repository\'s template with the Input line carrying "Proposal #<n>: <title>" and the body', async () => {
  const w = await specWorld();
  try {
    const p = w.ready();
    ok(await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' }));
    const spec = readFileSync(join(w.worktreePath, 'specs', BRANCH, 'spec.md'), 'utf8');
    assert.match(spec, /^# Feature Specification: \[FEATURE NAME\]/m, 'the template, not one the server holds');
    assert.ok(spec.includes(`**Input**: User description: "Proposal #${p.number}: Proposal: Pane probe\n\n### Feature name\n\nPane probe\n\n### Problem\n\nA problem."`), spec.slice(0, 600));
    assert.ok(spec.includes(`**Feature Branch**: \`${BRANCH}\``));
    assert.ok(spec.includes(`**Created**: ${ISO_DAY}`));
    assert.ok(!spec.includes('$ARGUMENTS'));
  } finally { await w.close(); }
});

test('US1-AC3 the stage moves to spec-in-progress, with a comment naming the branch, via Claude Desktop, and its trailer', async () => {
  const w = await specWorld();
  try {
    const p = w.ready();
    ok(await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' }));
    const labels = w.labelsOf(p.number);
    assert.ok(labels.includes('status/spec-in-progress'));
    assert.ok(!labels.includes('status/needs-spec'));
    assert.ok(labels.includes('type/proposal') && labels.includes('priority/p2'), 'other labels untouched');
    const comments = w.forge.issue('BELAY', p.number).comments;
    assert.equal(comments.length, 1);
    assert.equal(comments[0].body, `Spec started on branch \`${BRANCH}\` in \`${SPEC_DIR}\` (Claude Desktop).\n\n<!-- pdlc-stage: stage=spec-in-progress branch=${BRANCH} spec=${SPEC_DIR} -->`);
    // the comment is posted before the label swap (contracts/backlog-stage-cli.md "Verb" 4)
    const writes = w.forge.writes().map((c) => `${c.method} ${c.path.replace(/\d+/g, 'N')}`);
    assert.ok(writes.indexOf('POST /repos/operator/BELAY/issues/N/comments') < writes.indexOf('DELETE /repos/operator/BELAY/issues/N/labels/N'), writes.join(' | '));
  } finally { await w.close(); }
});

test('US1-AC5 FR-004 a second start_spec for the same proposal refuses spec_already_in_progress with the existing branch, creating nothing', async () => {
  const w = await specWorld();
  try {
    const p = w.ready();
    ok(await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' }));
    const writes = w.forge.writes().length;
    w.scripts.branch = '018-again';
    const r = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'again-please' });
    refused(r, 'spec_already_in_progress');
    assert.equal(r.payload.branch, BRANCH);
    assert.equal(w.forge.writes().length, writes);
    assert.equal(w.worktrees.length, 2, 'no second worktree');
  } finally { await w.close(); }
});

test('start_spec refuses spec_kit_unavailable in a repository without Spec Kit, before any branch or write (US7-AC2)', async () => {
  const w = await specWorld({ fixture: new URL('../fixtures/spec-kit/not-initialised/', import.meta.url).pathname });
  try {
    const p = w.ready();
    const r = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' });
    refused(r, 'spec_kit_unavailable');
    assert.match(r.payload.reason, /not set up for Spec Kit/);
    assert.deepEqual(w.forge.writes(), []);
    // T057: Spec Kit is checked before ANY git call that writes, not even a fetch (US7-AC2, SC-005)
    const writes = w.calls.filter((c) => ['fetch', 'clone', 'worktree', 'merge', 'checkout', 'add', 'commit', 'push', 'reset'].includes(c.args[0]));
    assert.deepEqual(writes.map((c) => c.args.join(' ')), [], `expected no git write calls, saw ${writes.map((c) => c.args[0]).join(', ')}`);
  } finally { await w.close(); }
});

test('start_spec refuses spec_hook_unsupported, naming the hook, when a mandatory specify hook cannot be honoured', async () => {
  const w = await specWorld({ fixture: new URL('../fixtures/spec-kit/unknown-mandatory-hook/', import.meta.url).pathname });
  try {
    const p = w.ready();
    const r = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' });
    refused(r, 'spec_hook_unsupported');
    assert.match(r.payload.reason, /speckit\.acme\.notify/);
    assert.deepEqual(w.forge.writes(), []);
  } finally { await w.close(); }
});

test('start_spec refuses branch_exists when the dry run\'s branch is already on the forge (another session took the number)', async () => {
  const w = await specWorld();
  try {
    w.remoteBranches.add(BRANCH);
    const p = w.ready();
    refused(await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' }), 'branch_exists');
    assert.deepEqual(w.forge.writes(), []);
  } finally { await w.close(); }
});

test('start_spec never reuses a branch the proposal\'s comments record as withdrawn (FR-019)', async () => {
  const w = await specWorld();
  try {
    const p = w.ready({ comments: [{ body: `Spec withdrawn by its author. Branch \`${BRANCH}\` is kept and will not be reused.\n\n<!-- pdlc-stage: stage=withdrawn branch=${BRANCH} spec=${SPEC_DIR} -->` }] });
    const r = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' });
    refused(r, 'branch_exists');
    assert.match(r.payload.reason, /withdrawn/);
  } finally { await w.close(); }
});

test('the audit line for start_spec carries the branch', async () => {
  const w = await specWorld();
  try {
    const p = w.ready();
    ok(await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' }));
    const a = w.c.audits().find((x) => x.tool === 'start_spec');
    assert.equal(a.branch, BRANCH);
    assert.equal(a.number, p.number);
    assert.equal(a.decision, 'allowed');
  } finally { await w.close(); }
});

// ── get_spec and write_spec_file ─────────────────────────────────────────────────────────────────────────────────

async function started() {
  const w = await specWorld();
  const p = w.ready();
  const s = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' });
  ok(s);
  return { w, p, revision: s.payload.revision };
}

test('US1-AC2 get_spec reads the spec in progress: stage, branch, files, revision, markers and clarified', async () => {
  const { w, p, revision } = await started();
  try {
    const r = await w.c.call('get_spec', { repo: 'BELAY', number: p.number });
    ok(r);
    assert.equal(r.payload.stage, 'spec-in-progress');
    assert.equal(r.payload.locked, false);
    assert.equal(r.payload.branch, BRANCH);
    assert.equal(r.payload.spec_dir, SPEC_DIR);
    assert.equal(r.payload.revision, revision);
    assert.deepEqual(r.payload.files.map((f) => f.path), ['spec.md']);
    assert.ok(r.payload.markers.length > 0, 'the template\'s [NEEDS CLARIFICATION] examples are listed');
    assert.equal(r.payload.clarified, false);
    assert.equal(r.payload.proposal_updated_since_start, false);
    assert.deepEqual(r.payload.remote, { changed: false });
  } finally { await w.close(); }
});

test('get_spec refuses no_spec_for_proposal when the proposal has no spec in progress', async () => {
  const w = await specWorld();
  try {
    const p = w.ready();
    refused(await w.c.call('get_spec', { repo: 'BELAY', number: p.number }), 'no_spec_for_proposal');
  } finally { await w.close(); }
});

test('get_spec reports proposal_updated_since_start once the proposal is edited after the spec started (spec Edge Cases)', async () => {
  const { w, p } = await started();
  try {
    const issue = await w.c.call('get_proposal', { repo: 'BELAY', number: p.number });
    ok(await w.c.call('update_proposal', { repo: 'BELAY', number: p.number, expected_updated_at: issue.payload.updated_at, sections: { problem: 'A sharper problem.' } }));
    const r = await w.c.call('get_spec', { repo: 'BELAY', number: p.number });
    assert.equal(r.payload.proposal_updated_since_start, true);
  } finally { await w.close(); }
});

test('write_spec_file writes inside the feature folder against the current revision, and returns the new one', async () => {
  const { w, p, revision } = await started();
  try {
    const r = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: '# Feature Specification: Pane probe\n', base_revision: revision });
    ok(r);
    assert.notEqual(r.payload.revision, revision);
    assert.equal(readFileSync(join(w.worktreePath, 'specs', BRANCH, 'spec.md'), 'utf8'), '# Feature Specification: Pane probe\n');
    const c = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'checklists/requirements.md', content: '- [ ] x\n', base_revision: r.payload.revision });
    ok(c);
  } finally { await w.close(); }
});

test('write_spec_file refuses pane_edit_pending when the folder moved past base_revision, writing nothing', async () => {
  const { w, p, revision } = await started();
  try {
    // an edit made by another process (the pane's) since the model last read the spec
    writeFileSync(join(w.worktreePath, 'specs', BRANCH, 'spec.md'), '# typed in the pane\n');
    const r = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: '# chat edit\n', base_revision: revision });
    refused(r, 'pane_edit_pending');
    assert.equal(readFileSync(join(w.worktreePath, 'specs', BRANCH, 'spec.md'), 'utf8'), '# typed in the pane\n');
  } finally { await w.close(); }
});

test('write_spec_file refuses path_outside_feature through the tool too', async () => {
  const { w, p, revision } = await started();
  try {
    refused(await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: '../../.forgejo/x.yml', content: 'x', base_revision: revision }), 'path_outside_feature');
  } finally { await w.close(); }
});

test('write_spec_file refuses stage_transition_refused outside spec-in-progress, and document_locked from in-engineering on (FR-018)', async () => {
  const { w, p, revision } = await started();
  try {
    const issue = w.forge.issue('BELAY', p.number);
    const label = (name) => w.forge.state.labels.belay.find((l) => l.name === name);
    issue.labels = issue.labels.filter((l) => l.name !== 'status/spec-in-progress').concat([{ ...label('status/ready-to-plan') }]);
    refused(await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: 'x', base_revision: revision }), 'stage_transition_refused');
    issue.labels = issue.labels.filter((l) => l.name !== 'status/ready-to-plan').concat([{ ...label('status/in-engineering') }]);
    const r = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: 'x', base_revision: revision });
    refused(r, 'document_locked');
    assert.match(r.payload.reason, /planning has started/i);
  } finally { await w.close(); }
});

test('write_spec_file refuses content over 256 KiB as invalid_input', async () => {
  const { w, p, revision } = await started();
  try {
    refused(await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: 'x'.repeat(256 * 1024 + 1), base_revision: revision }), 'invalid_input');
  } finally { await w.close(); }
});

test('a start that stopped after the worktree but before the stage moved is finished, not repeated, by the next start_spec', async () => {
  const w = await specWorld();
  try {
    const p = w.ready();
    ok(await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' }));
    // simulate the interruption: the label never moved and the comment never landed
    const issue = w.forge.issue('BELAY', p.number);
    const label = (name) => w.forge.state.labels.belay.find((l) => l.name === name);
    issue.labels = issue.labels.filter((l) => l.name !== 'status/spec-in-progress').concat([{ ...label('status/needs-spec') }]);
    issue.comments = [];
    const r = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' });
    refused(r, 'spec_already_in_progress');
    assert.equal(r.payload.branch, BRANCH);
    assert.ok(w.labelsOf(p.number).includes('status/spec-in-progress'), 'the stage move was completed');
    assert.equal(w.forge.issue('BELAY', p.number).comments.length, 1);
    assert.equal(w.worktrees.length, 2, 'no second worktree');
    ok(await w.c.call('get_spec', { repo: 'BELAY', number: p.number }));
  } finally { await w.close(); }
});

// ── approve_spec (US2; FR-008, FR-009) ──────────────────────────────────────────────────────────────────────────

const CLARIFIED = `# Feature Specification: Pane probe

**Feature Branch**: \`017-pane-probe\`

**Input**: User description: "Proposal #1: Proposal: Pane probe"

## Clarifications

### Session 2026-11-28

- Q: Who reviews? → A: The author.

## Requirements

- **FR-001**: The pane MUST show the spec.
`;

async function clarified() {
  const { w, p, revision } = await started();
  const r = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: CLARIFIED, base_revision: revision });
  ok(r);
  return { w, p, revision: r.payload.revision };
}

test('US2-AC5 approve_spec commits, publishes the branch, then moves to ready-to-plan with the linked comment and its trailer', async () => {
  const { w, p, revision } = await clarified();
  try {
    const r = await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision });
    ok(r);
    assert.equal(r.payload.stage, 'ready-to-plan');
    assert.equal(r.payload.branch, BRANCH);
    assert.equal(r.payload.spec_url, `https://forge.example/operator/BELAY/src/branch/${BRANCH}/specs/${BRANCH}`);
    assert.match(r.payload.commit, /^[0-9a-f]{40}$/);
    assert.deepEqual(w.pushes, [BRANCH]);
    assert.equal(w.commits.length, 1);
    assert.equal(w.commits[0].message, `docs(017): approve spec for proposal item #${p.number}\n\nApproved in Claude Desktop by the spec's author.`);
    assert.ok(w.labelsOf(p.number).includes('status/ready-to-plan'));
    assert.ok(!w.labelsOf(p.number).includes('status/spec-in-progress'));
    const last = w.forge.issue('BELAY', p.number).comments.at(-1).body;
    assert.equal(last, `Spec approved by its author and published on branch \`${BRANCH}\`: [${SPEC_DIR}](https://forge.example/operator/BELAY/src/branch/${BRANCH}/specs/${BRANCH}). Ready to plan.\n\n<!-- pdlc-stage: stage=ready-to-plan branch=${BRANCH} spec=${SPEC_DIR} -->`);
    // the published tip is recorded for the take-latest check (R8)
    const state = JSON.parse(readFileSync(join(w.cloneRoot, '.pdlc-specs', 'BELAY', `${BRANCH}.state.json`), 'utf8'));
    assert.equal(state.recorded_remote_tip, r.payload.commit);
  } finally { await w.close(); }
});

test('approve_spec refuses pane_edit_pending on a stale base_revision, publishing nothing', async () => {
  const { w, p, revision } = await clarified();
  try {
    writeFileSync(join(w.worktreePath, 'specs', BRANCH, 'spec.md'), `${CLARIFIED}\n- typed in the pane\n`);
    refused(await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision }), 'pane_edit_pending');
    assert.deepEqual(w.pushes, []);
    assert.ok(w.labelsOf(p.number).includes('status/spec-in-progress'));
  } finally { await w.close(); }
});

test('US2-AC6 approve_spec refuses spec_has_markers, listing the markers, and US2-AC4 spec_not_clarified, before any git write', async () => {
  const { w, p, revision } = await started();
  try {
    const r = await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision });
    refused(r, 'spec_has_markers');
    assert.ok(Array.isArray(r.payload.markers) && r.payload.markers.length > 0);
    const noMarkers = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: '# Feature Specification: Pane probe\n', base_revision: revision });
    refused(await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: noMarkers.payload.revision }), 'spec_not_clarified');
    assert.ok(!w.calls.some((c) => ['add', 'commit', 'push'].includes(c.args[0])));
  } finally { await w.close(); }
});

test('FR-009 publish_failed: the commit is kept and the stage does NOT move; approving again publishes it', async () => {
  const { w, p, revision } = await clarified();
  try {
    w.pushFails.on = true;
    const r = await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision });
    refused(r, 'publish_failed');
    assert.ok(w.labelsOf(p.number).includes('status/spec-in-progress'), 'no stage says ready to plan for a spec not on the forge');
    assert.equal(w.commits.length, 1);
    w.pushFails.on = false;
    const again = await w.c.call('get_spec', { repo: 'BELAY', number: p.number });
    ok(await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: again.payload.revision }));
    assert.equal(w.commits.length, 1, 'no second, empty commit');
    assert.deepEqual(w.pushes, [BRANCH]);
    assert.ok(w.labelsOf(p.number).includes('status/ready-to-plan'));
  } finally { await w.close(); }
});

test('approve_spec refuses git_identity_missing before anything is staged', async () => {
  const { w, p, revision } = await clarified();
  try {
    w.identity.email = '';
    refused(await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision }), 'git_identity_missing');
    assert.ok(!w.calls.some((c) => ['add', 'commit', 'push'].includes(c.args[0])));
  } finally { await w.close(); }
});

test('the audit line for approve_spec names the branch', async () => {
  const { w, p, revision } = await clarified();
  try {
    ok(await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision }));
    assert.equal(w.c.audits().find((a) => a.tool === 'approve_spec').branch, BRANCH);
  } finally { await w.close(); }
});

test('US3-AC4 FR-018 at in-engineering the spec is locked: write_spec_file and approve_spec refuse document_locked, citing that planning started', async () => {
  const { w, p, revision } = await clarified();
  try {
    const issue = w.forge.issue('BELAY', p.number);
    const label = (name) => w.forge.state.labels.belay.find((l) => l.name === name);
    issue.labels = issue.labels.filter((l) => l.name !== 'status/spec-in-progress').concat([{ ...label('status/in-engineering') }]);
    for (const [tool, args] of [['write_spec_file', { path: 'spec.md', content: 'x' }], ['approve_spec', {}]]) {
      const r = await w.c.call(tool, { repo: 'BELAY', number: p.number, base_revision: revision, ...args });
      refused(r, 'document_locked');
      assert.match(r.payload.reason, /planning has started/i, tool);
    }
    assert.deepEqual(w.pushes, []);
    const g = await w.c.call('get_spec', { repo: 'BELAY', number: p.number });
    assert.equal(g.payload.locked, true);
  } finally { await w.close(); }
});

// ── US8: the branch changed on the forge (FR-022, R8) ──────────────────────────────────────────────────────────

test('US8-AC4 approve_spec refuses branch_changed, listing what changed, when the forge moved since the last publish; nothing is written', async () => {
  const { w, p, revision } = await clarified();
  try {
    ok(await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision }));
    // someone else pushed to the feature branch on the forge
    w.tips.set(BRANCH, 'd'.repeat(40));
    // put it back to spec-in-progress as a reopen would (reopen_spec lands in Phase 8)
    const issue = w.forge.issue('BELAY', p.number);
    const label = (name) => w.forge.state.labels.belay.find((l) => l.name === name);
    issue.labels = issue.labels.filter((l) => l.name !== 'status/ready-to-plan').concat([{ ...label('status/spec-in-progress') }]);
    const g = await w.c.call('get_spec', { repo: 'BELAY', number: p.number });
    assert.equal(g.payload.remote.changed, true);
    assert.equal(g.payload.remote.commits[0].author, 'Someone else');
    const pushes = w.pushes.length;
    const r = await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: g.payload.revision });
    refused(r, 'branch_changed');
    assert.equal(r.payload.commits[0].subject, 'docs: edit on the forge');
    assert.match(r.payload.diffstat, /spec\.md/);
    assert.equal(w.pushes.length, pushes, 'nothing published');
  } finally { await w.close(); }
});

test('take_latest_spec refuses nothing_to_take when the forge has not moved', async () => {
  const { w, p, revision } = await clarified();
  try {
    ok(await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision }));
    const issue = w.forge.issue('BELAY', p.number);
    const label = (name) => w.forge.state.labels.belay.find((l) => l.name === name);
    issue.labels = issue.labels.filter((l) => l.name !== 'status/ready-to-plan').concat([{ ...label('status/spec-in-progress') }]);
    refused(await w.c.call('take_latest_spec', { repo: 'BELAY', number: p.number }), 'nothing_to_take');
  } finally { await w.close(); }
});

// ── reopen_spec (US5; FR-017, FR-018) ───────────────────────────────────────────────────────────────────────────

async function approved() {
  const { w, p, revision } = await clarified();
  const a = await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision });
  ok(a);
  return { w, p };
}

test('US5-AC1 reopen_spec moves ready-to-plan back to spec-in-progress with the reopen text, and hides it from ready work', async () => {
  const { w, p } = await approved();
  try {
    const r = await w.c.call('reopen_spec', { repo: 'BELAY', number: p.number });
    ok(r);
    assert.deepEqual([r.payload.stage, r.payload.branch], ['spec-in-progress', BRANCH]);
    assert.ok(w.labelsOf(p.number).includes('status/spec-in-progress'));
    assert.ok(!w.labelsOf(p.number).includes('status/ready-to-plan'));
    assert.equal(w.forge.issue('BELAY', p.number).comments.at(-1).body,
      `Spec reopened by its author for editing; hidden from ready work until approved again.\n\n<!-- pdlc-stage: stage=spec-in-progress branch=${BRANCH} spec=${SPEC_DIR} -->`);
    assert.equal(w.c.audits().find((a) => a.tool === 'reopen_spec').branch, BRANCH);
    assert.ok(!w.forge.writes().some((c) => c.method === 'PATCH'), 'reopen_spec never changes the issue\'s state (FR-027: no issue reopen or close)');
  } finally { await w.close(); }
});

test('US5-AC2 a reopen resets the clarification count: approving again needs a NEW session; then the comment says re-approved, on the same branch', async () => {
  const { w, p } = await approved();
  try {
    ok(await w.c.call('reopen_spec', { repo: 'BELAY', number: p.number }));
    const state = JSON.parse(readFileSync(join(w.cloneRoot, '.pdlc-specs', 'BELAY', `${BRANCH}.state.json`), 'utf8'));
    assert.equal(state.sessions_at_start_or_reopen, 1, 'the one session already in the spec is the new baseline');
    assert.equal(state.last_start_or_reopen, '2026-11-27');
    const g = await w.c.call('get_spec', { repo: 'BELAY', number: p.number });
    assert.equal(g.payload.clarified, false);
    const edited = CLARIFIED.replace('- **FR-001**: The pane MUST show the spec.', '- **FR-001**: The pane MUST show the spec beside the chat.');
    const wr = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: edited, base_revision: g.payload.revision });
    refused(await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: wr.payload.revision }), 'spec_not_clarified');
    const again = edited.replace('## Requirements', '### Session 2026-11-28\n\n- No questions: no critical ambiguity found.\n\n## Requirements');
    const wr2 = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: again, base_revision: wr.payload.revision });
    const a = await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: wr2.payload.revision });
    ok(a);
    assert.equal(a.payload.branch, BRANCH);
    assert.match(w.forge.issue('BELAY', p.number).comments.at(-1).body, /^Spec re-approved by its author and published on branch `017-pane-probe`/);
    assert.deepEqual(w.pushes, [BRANCH, BRANCH], 'both approvals published the same branch');
    assert.equal(w.commits.length, 2);
  } finally { await w.close(); }
});

test('US5-AC3 FR-018 reopen_spec refuses document_locked at in-engineering, and stage_transition_refused when not ready to plan', async () => {
  const { w, p } = await approved();
  try {
    const issue = w.forge.issue('BELAY', p.number);
    const label = (name) => w.forge.state.labels.belay.find((l) => l.name === name);
    issue.labels = issue.labels.filter((l) => l.name !== 'status/ready-to-plan').concat([{ ...label('status/in-engineering') }]);
    const r = await w.c.call('reopen_spec', { repo: 'BELAY', number: p.number });
    refused(r, 'document_locked');
    assert.match(r.payload.reason, /planning has started/i);
    issue.labels = issue.labels.filter((l) => l.name !== 'status/in-engineering').concat([{ ...label('status/spec-in-progress') }]);
    refused(await w.c.call('reopen_spec', { repo: 'BELAY', number: p.number }), 'stage_transition_refused');
  } finally { await w.close(); }
});

test('US7 start_spec with no local copy yet refuses spec_kit_unavailable, saying to sync first, and clones nothing', async () => {
  const w = await specWorld();
  try {
    const { rmSync } = await import('node:fs');
    rmSync(w.copyPath, { recursive: true, force: true });
    const p = w.ready();
    const r = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' });
    refused(r, 'spec_kit_unavailable');
    assert.match(r.payload.reason, /sync_repo/);
    assert.ok(!w.calls.some((c) => c.args[0] === 'clone'));
  } finally { await w.close(); }
});

// ── withdraw_spec (US6; FR-019) ─────────────────────────────────────────────────────────────────────────────────

for (const [to, label] of [['ready', 'status/needs-spec'], ['draft', 'status/proposal-draft']]) {
  test(`US6-AC1 withdraw_spec to ${to}: the stage the author chose, a withdrawn trailer naming the branch, and NOTHING deleted`, async () => {
    const { w, p } = await started();
    try {
      const r = await w.c.call('withdraw_spec', { repo: 'BELAY', number: p.number, to });
      ok(r);
      assert.equal(r.payload.stage, to);
      assert.ok(w.labelsOf(p.number).includes(label));
      assert.ok(!w.labelsOf(p.number).includes('status/spec-in-progress'));
      assert.equal(w.forge.issue('BELAY', p.number).comments.at(-1).body,
        `Spec withdrawn by its author. Branch \`${BRANCH}\` is kept and will not be reused.\n\n<!-- pdlc-stage: stage=withdrawn branch=${BRANCH} spec=${SPEC_DIR} -->`);
      assert.ok(existsSync(join(w.worktreePath, 'specs', BRANCH, 'spec.md')), 'the worktree and its files stay');
      const state = JSON.parse(readFileSync(join(w.cloneRoot, '.pdlc-specs', 'BELAY', `${BRANCH}.state.json`), 'utf8'));
      assert.equal(state.withdrawn, true);
      assert.ok(!w.calls.some((c) => ['push', 'reset'].includes(c.args[0]) || (c.args[0] === 'worktree' && c.args[1] !== 'list') && c.args[1] !== 'add'), 'no git write');
      assert.ok(!w.forge.writes().some((c) => c.method === 'PATCH'), 'the issue is not closed');
      refused(await w.c.call('get_spec', { repo: 'BELAY', number: p.number }), 'no_spec_for_proposal');
    } finally { await w.close(); }
  });
}

test('US6-AC2 after a withdrawal, a new start creates a NEW feature; the withdrawn branch is never reused', async () => {
  const { w, p } = await started();
  try {
    ok(await w.c.call('withdraw_spec', { repo: 'BELAY', number: p.number, to: 'ready' }));
    // the repository's own numbering would offer the same number again only if it could not see the branch: refused
    refused(await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' }), 'branch_exists');
    w.scripts.branch = '018-pane-probe-two';
    const r = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe-two' });
    ok(r);
    assert.equal(r.payload.branch, '018-pane-probe-two');
    assert.ok(w.labelsOf(p.number).includes('status/spec-in-progress'));
  } finally { await w.close(); }
});

test('US6-AC3 FR-018 withdraw_spec refuses document_locked at in-engineering', async () => {
  const { w, p } = await started();
  try {
    const issue = w.forge.issue('BELAY', p.number);
    const label = (name) => w.forge.state.labels.belay.find((l) => l.name === name);
    issue.labels = issue.labels.filter((l) => l.name !== 'status/spec-in-progress').concat([{ ...label('status/in-engineering') }]);
    const r = await w.c.call('withdraw_spec', { repo: 'BELAY', number: p.number, to: 'ready' });
    refused(r, 'document_locked');
    assert.match(r.payload.reason, /planning has started/i);
  } finally { await w.close(); }
});

test('T082 finding: after a same-day reopen, an answer added under the existing session heading lets the spec be approved again', async () => {
  const { w, p } = await approved();
  try {
    ok(await w.c.call('reopen_spec', { repo: 'BELAY', number: p.number }));
    const state = JSON.parse(readFileSync(join(w.cloneRoot, '.pdlc-specs', 'BELAY', `${BRANCH}.state.json`), 'utf8'));
    assert.equal(state.clarify_entries_at_start_or_reopen, 1, 'the one answer already in the spec is the new baseline');
    const g = await w.c.call('get_spec', { repo: 'BELAY', number: p.number });
    assert.equal(g.payload.clarified, false);
    const spec = g.payload.files.find((f) => f.path === 'spec.md').content;
    const answered = spec.replace(/(### Session [^\n]*\n\n- [^\n]*\n)/, '$1- Q: Duplicate story? → A: Removed it.\n');
    assert.notEqual(answered, spec);
    const wr = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: answered, base_revision: g.payload.revision });
    ok(wr);
    assert.equal((await w.c.call('get_spec', { repo: 'BELAY', number: p.number })).payload.clarified, true);
    ok(await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: wr.payload.revision }));
  } finally { await w.close(); }
});
