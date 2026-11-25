// The write-guard matrix (FR-012 to FR-016, FR-019, FR-020, SC-003; US3-AC1, -AC2, -AC3, -AC6). Each
// row sends the request one guard refuses, over the real protocol, and checks the refusal code, a
// reason, and that NOTHING was written. Guards apply in data-model order (0 → 5): a request breaking
// two guards is refused by the earlier one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers/mcp-client.mjs';
import { world } from './helpers/world.mjs';
import { renderBody } from '../../src/proposal-body.mjs';

const sections = {
  feature_name: 'Import', problem: 'p', proposed_value: 'v', personas: 'c',
  goals_success: 'g', rough_scope: 'r', open_questions: '', out_of_scope: '', priority: 'p2',
};
const big = 'x'.repeat(40_000);

async function harness(opts) {
  const w = world({ repos: ['BELAY'], ...opts });
  const c = await connect({ allowlist: w.allowlist, proposals: w.proposals });
  const seed = (over = {}) => w.forge.addIssue('BELAY', { title: 'Proposal: Import', body: renderBody(sections), labels: ['type/proposal', 'status/proposal-draft', 'priority/p2'], ...over });
  return { w, c, seed };
}

async function expectRefusal(h, tool, args, code) {
  const r = await h.c.call(tool, args);
  assert.equal(r.isError, true, `${tool} ${JSON.stringify(args).slice(0, 120)} was not refused`);
  assert.equal(r.payload.code, code, `${tool}: ${JSON.stringify(r.payload)}`);
  assert.ok(r.payload.reason.length > 0);
  assert.deepEqual(h.w.forge.writes(), [], `${tool} wrote despite the refusal`);
  return r;
}

const create = (over = {}) => ({ repo: 'BELAY', title: 'Proposal: Import', sections, priority: 'p2', status: 'draft', ...over });

test('guard 1: another owner (owner/repo form) is refused for every tool with no forge request at all', async () => {
  const h = await harness();
  try {
    for (const [tool, args] of [
      ['create_proposal', create({ repo: 'someone/BELAY' })],
      ['update_proposal', { repo: 'someone/BELAY', number: 1, expected_updated_at: 'x', status: 'ready' }],
      ['add_comment', { repo: 'someone/BELAY', number: 1, body: 'hi' }],
      ['list_proposals', { repo: 'someone/BELAY', status: 'all' }],
      ['get_proposal', { repo: 'someone/BELAY', number: 1 }],
    ]) await expectRefusal(h, tool, args, 'unknown_repo');
    assert.equal(h.w.forge.calls.length, 0);
  } finally { await h.c.close(); }
});

test('guard 1: an unknown repository is refused for every tool, with only the repository listing read', async () => {
  const h = await harness();
  try {
    for (const [tool, args] of [
      ['create_proposal', create({ repo: 'nope' })],
      ['update_proposal', { repo: 'nope', number: 1, expected_updated_at: 'x', status: 'ready' }],
      ['add_comment', { repo: 'nope', number: 1, body: 'hi' }],
      ['list_proposals', { repo: 'nope', status: 'all' }],
      ['get_proposal', { repo: 'nope', number: 1 }],
    ]) await expectRefusal(h, tool, args, 'unknown_repo');
    assert.ok(h.w.forge.calls.every((c) => c.path === '/repos/search'), JSON.stringify(h.w.forge.calls.map((c) => c.path)));
  } finally { await h.c.close(); }
});

test('guard 2: a pull request is refused for update, comment and get', async () => {
  const h = await harness();
  try {
    const pr = h.seed({ pull: true });
    await expectRefusal(h, 'update_proposal', { repo: 'BELAY', number: pr.number, expected_updated_at: pr.updated_at, status: 'ready' }, 'not_a_proposal');
    await expectRefusal(h, 'add_comment', { repo: 'BELAY', number: pr.number, body: 'hi' }, 'not_a_proposal');
    await expectRefusal(h, 'get_proposal', { repo: 'BELAY', number: pr.number }, 'not_a_proposal');
  } finally { await h.c.close(); }
});

test('guard 2: an issue without type/proposal is refused for update, comment and get', async () => {
  const h = await harness();
  try {
    const bug = h.seed({ title: 'A bug', labels: ['type/bug', 'priority/p1'] });
    await expectRefusal(h, 'update_proposal', { repo: 'BELAY', number: bug.number, expected_updated_at: bug.updated_at, title: 'Proposal: x' }, 'not_a_proposal');
    await expectRefusal(h, 'add_comment', { repo: 'BELAY', number: bug.number, body: 'hi' }, 'not_a_proposal');
    await expectRefusal(h, 'get_proposal', { repo: 'BELAY', number: bug.number }, 'not_a_proposal');
  } finally { await h.c.close(); }
});

test('guard 2: status/bot-managed is refused on update AND comment, even with type/proposal', async () => {
  const h = await harness();
  try {
    const bot = h.seed({ labels: ['type/proposal', 'status/proposal-draft', 'priority/p2', 'status/bot-managed'] });
    await expectRefusal(h, 'update_proposal', { repo: 'BELAY', number: bot.number, expected_updated_at: bot.updated_at, status: 'ready' }, 'bot_managed');
    await expectRefusal(h, 'add_comment', { repo: 'BELAY', number: bot.number, body: 'hi' }, 'bot_managed');
  } finally { await h.c.close(); }
});

test('guard 3: an unknown label is refused in a filter and in each write', async () => {
  const h = await harness({ labels: ['type/proposal', 'priority/p1', 'priority/p2', 'priority/p3'] });
  try {
    const i = h.seed({ labels: ['type/proposal', 'priority/p2'] });
    await expectRefusal(h, 'list_proposals', { repo: 'BELAY', status: 'draft' }, 'unknown_label');
    await expectRefusal(h, 'create_proposal', create(), 'unknown_label');
    await expectRefusal(h, 'update_proposal', { repo: 'BELAY', number: i.number, expected_updated_at: i.updated_at, status: 'ready' }, 'unknown_label');
    assert.equal(h.w.forge.calls.filter((c) => c.path.endsWith('/issues')).length, 0, 'no filtered listing was sent');
  } finally { await h.c.close(); }
});

test('guard 4: a stale expected_updated_at is refused on update', async () => {
  const h = await harness();
  try {
    const i = h.seed();
    await expectRefusal(h, 'update_proposal', { repo: 'BELAY', number: i.number, expected_updated_at: '2020-01-01T00:00:00Z', sections: { problem: 'x' } }, 'stale');
  } finally { await h.c.close(); }
});

test('guard 5: a duplicate open title is refused on create', async () => {
  const h = await harness();
  try {
    h.seed();
    await expectRefusal(h, 'create_proposal', create(), 'duplicate_title');
  } finally { await h.c.close(); }
});

test('guard 0: an over-size body is refused on create, update and comment', async () => {
  const h = await harness();
  try {
    const i = h.seed();
    await expectRefusal(h, 'create_proposal', create({ sections: { ...sections, problem: big, rough_scope: big } }), 'invalid_input');
    await expectRefusal(h, 'update_proposal', { repo: 'BELAY', number: i.number, expected_updated_at: i.updated_at, sections: { problem: big, rough_scope: big } }, 'invalid_input');
    await expectRefusal(h, 'add_comment', { repo: 'BELAY', number: i.number, body: 'y'.repeat(65_537) }, 'invalid_input');
  } finally { await h.c.close(); }
});

test('order: guard 0 before 1 (an over-size body for an unknown repository is invalid_input, with no forge request)', async () => {
  const h = await harness();
  try {
    await expectRefusal(h, 'create_proposal', create({ repo: 'nope', sections: { ...sections, problem: big, rough_scope: big } }), 'invalid_input');
    await expectRefusal(h, 'update_proposal', { repo: 'nope', number: 1, expected_updated_at: 'x', sections: { problem: big, rough_scope: big } }, 'invalid_input');
    await expectRefusal(h, 'add_comment', { repo: 'nope', number: 1, body: 'y'.repeat(65_537) }, 'invalid_input');
    assert.equal(h.w.forge.calls.length, 0);
  } finally { await h.c.close(); }
});

test('order: guard 1 before 2 (an unknown repository with a PR number is unknown_repo)', async () => {
  const h = await harness();
  try {
    const pr = h.seed({ pull: true });
    await expectRefusal(h, 'add_comment', { repo: 'nope', number: pr.number, body: 'hi' }, 'unknown_repo');
  } finally { await h.c.close(); }
});

test('order: guard 2 before 3 (a non-proposal whose update names a missing label is not_a_proposal)', async () => {
  const h = await harness({ labels: ['type/proposal', 'type/bug', 'priority/p1', 'priority/p2', 'priority/p3'] });
  try {
    const bug = h.seed({ title: 'A bug', labels: ['type/bug'] });
    await expectRefusal(h, 'update_proposal', { repo: 'BELAY', number: bug.number, expected_updated_at: bug.updated_at, status: 'ready' }, 'not_a_proposal');
  } finally { await h.c.close(); }
});

test('order: guard 2 before 4 (a bot-managed issue with a stale timestamp is bot_managed)', async () => {
  const h = await harness();
  try {
    const bot = h.seed({ labels: ['type/proposal', 'status/bot-managed'] });
    await expectRefusal(h, 'update_proposal', { repo: 'BELAY', number: bot.number, expected_updated_at: 'stale', status: 'ready' }, 'bot_managed');
  } finally { await h.c.close(); }
});

test('order: guard 3 before 4 (a missing label with a stale timestamp is unknown_label)', async () => {
  const h = await harness({ labels: ['type/proposal', 'status/proposal-draft', 'priority/p1', 'priority/p2', 'priority/p3'] });
  try {
    const i = h.seed();
    await expectRefusal(h, 'update_proposal', { repo: 'BELAY', number: i.number, expected_updated_at: 'stale', status: 'ready' }, 'unknown_label');
  } finally { await h.c.close(); }
});

test('order: guard 3 before 5 (a create with a missing label and a duplicate title is unknown_label)', async () => {
  const h = await harness({ labels: ['type/proposal', 'priority/p1', 'priority/p2', 'priority/p3'] });
  try {
    h.seed({ labels: ['type/proposal', 'priority/p2'] });
    await expectRefusal(h, 'create_proposal', create(), 'unknown_label');
  } finally { await h.c.close(); }
});

test('guard 1: a repository the token can see but another owner holds is refused for every tool, by plain name', async () => {
  const h = await harness();
  try {
    h.w.forge.state.repos.push({ name: 'theirs', owner: { login: 'someone-else' }, default_branch: 'main', description: 'not ours' });
    h.w.forge.state.issues.theirs = [];
    h.w.forge.state.labels.theirs = h.w.forge.state.labels.belay;
    for (const [tool, args] of [
      ['create_proposal', create({ repo: 'theirs' })],
      ['update_proposal', { repo: 'theirs', number: 1, expected_updated_at: 'x', status: 'ready' }],
      ['add_comment', { repo: 'theirs', number: 1, body: 'hi' }],
      ['list_proposals', { repo: 'theirs', status: 'all' }],
      ['get_proposal', { repo: 'theirs', number: 1 }],
    ]) await expectRefusal(h, tool, args, 'unknown_repo');
    assert.ok(h.w.forge.calls.every((c) => c.path === '/repos/search'));
    const listed = await h.c.call('list_repos');
    assert.ok(listed.payload.repos.every((r) => r.name !== 'theirs'));
  } finally { await h.c.close(); }
});
