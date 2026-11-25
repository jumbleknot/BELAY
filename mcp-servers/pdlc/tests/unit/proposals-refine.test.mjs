// Refining proposals: list, read comments, partial update with stale-write refusal, comment
// (FR-006, FR-007, FR-015, FR-016; research R8, R9; US2-AC1 to US2-AC6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers/world.mjs';
import { renderBody, parseBody } from '../../src/proposal-body.mjs';
import { Refusal } from '../../src/refusal.mjs';

const sections = {
  feature_name: 'Import', problem: 'p', proposed_value: 'v', personas: 'c',
  goals_success: 'g', rough_scope: 'r', open_questions: '', out_of_scope: '', priority: 'p2',
};
const refused = async (promise, code) => {
  let e;
  try { await promise; } catch (err) { e = err; }
  assert.ok(e instanceof Refusal, `expected Refusal ${code}, got ${e?.stack ?? e}`);
  assert.equal(e.code, code);
  return e;
};
const seed = (w, over = {}) => w.forge.addIssue('BELAY', { title: 'Proposal: Import', body: renderBody(sections), labels: ['type/proposal', 'status/proposal-draft', 'priority/p2'], ...over });
const lid = (w, n) => w.forge.state.labels.belay.find((l) => l.name === n).id;

test('list: status draft, ready and all filter on the resolved labels; all uses type/proposal alone', async () => {
  const w = world();
  const d = seed(w, { title: 'Proposal: D' });
  const r = seed(w, { title: 'Proposal: R', labels: ['type/proposal', 'status/needs-spec', 'priority/p1'] });
  seed(w, { title: 'Bug', labels: ['type/bug'] });
  const nums = async (status) => (await w.proposals.list({ repo: 'BELAY', status, state: 'open' })).proposals.map((p) => p.number).sort();
  assert.deepEqual(await nums('draft'), [d.number]);
  assert.deepEqual(await nums('ready'), [r.number]);
  assert.deepEqual(await nums('all'), [d.number, r.number].sort());
  const listings = w.forge.calls.filter((c) => c.path === '/repos/operator/BELAY/issues');
  assert.deepEqual(listings.map((c) => c.query.labels), ['type/proposal,status/proposal-draft', 'type/proposal,status/needs-spec', 'type/proposal']);
});

test('list rows carry number, title, status, priority, state and updated_at', async () => {
  const w = world();
  const i = seed(w);
  const { proposals, total, truncated } = await w.proposals.list({ repo: 'belay', status: 'all', state: 'open' });
  assert.deepEqual(proposals, [{ number: i.number, title: 'Proposal: Import', status: 'draft', priority: 'p2', state: 'open', updated_at: i.updated_at }]);
  assert.equal(total, 1);
  assert.equal(truncated, false);
});

test('list: query is passed as q; state defaults to open and is passed through', async () => {
  const w = world();
  await w.proposals.list({ repo: 'BELAY', status: 'all', query: 'spreadsheet' });
  await w.proposals.list({ repo: 'BELAY', status: 'all', state: 'closed' });
  const [a, b] = w.forge.calls.filter((c) => c.path === '/repos/operator/BELAY/issues');
  assert.equal(a.query.q, 'spreadsheet');
  assert.equal(a.query.state, 'open');
  assert.equal(b.query.state, 'closed');
});

test('list: type=issues is always sent, and any row with pull_request is dropped', async () => {
  const w = world();
  seed(w);
  w.forge.addIssue('BELAY', { title: 'Proposal: PR', labels: ['type/proposal', 'status/proposal-draft'], pull: true });
  const r = await w.proposals.list({ repo: 'BELAY', status: 'all' });
  assert.ok(w.forge.calls.filter((c) => c.path.endsWith('/issues')).every((c) => c.query.type === 'issues'));
  assert.ok(r.proposals.every((p) => p.title !== 'Proposal: PR'));
});

test('list: more than a page of proposals is paged, and a cap is reported as truncated with the total', async () => {
  const w = world();
  for (let i = 0; i < 120; i++) seed(w, { title: `Proposal: P${i}` });
  const all = await w.proposals.list({ repo: 'BELAY', status: 'draft' });
  assert.equal(all.proposals.length, 120);
  assert.equal(all.truncated, false);
  const capped = await w.proposals.list({ repo: 'BELAY', status: 'draft' }, { maxPages: 1 });
  assert.equal(capped.proposals.length, 50);
  assert.equal(capped.truncated, true);
  assert.equal(capped.total, 120);
});

test('list refuses unknown_label before the filtered request when a status label is missing', async () => {
  const w = world({ labels: ['type/proposal', 'status/needs-spec', 'priority/p1', 'priority/p2', 'priority/p3'] });
  await refused(w.proposals.list({ repo: 'BELAY', status: 'draft' }), 'unknown_label');
  assert.equal(w.forge.calls.filter((c) => c.path.endsWith('/issues')).length, 0);
});

test('get returns comments as {author, created_at, body}', async () => {
  const w = world();
  const i = seed(w, { comments: [{ user: { login: 'a' }, created_at: 't1', body: 'one' }, { user: { login: 'b' }, created_at: 't2', body: 'two' }] });
  const r = await w.proposals.get({ repo: 'BELAY', number: i.number });
  assert.deepEqual(r.comments, [{ author: 'a', created_at: 't1', body: 'one' }, { author: 'b', created_at: 't2', body: 'two' }]);
});

test('update replaces only the given sections and keeps the rest as parsed', async () => {
  const w = world();
  const i = seed(w);
  const before = i.updated_at;
  const r = await w.proposals.update({ repo: 'BELAY', number: i.number, expected_updated_at: before, sections: { problem: 'a sharper problem' } });
  const after = parseBody(w.forge.issue('BELAY', i.number).body).sections;
  assert.deepEqual(after, { ...sections, problem: 'a sharper problem' });
  assert.deepEqual(r.changed, ['sections.problem']);
  assert.equal(r.updated_at, w.forge.issue('BELAY', i.number).updated_at);
  assert.notEqual(r.updated_at, before);
});

test('update status draft → ready swaps exactly one label (DELETE old, POST new) and leaves the others', async () => {
  const w = world();
  const i = seed(w, { labels: ['type/proposal', 'status/proposal-draft', 'priority/p2', 'type/feature'] });
  const r = await w.proposals.update({ repo: 'BELAY', number: i.number, expected_updated_at: i.updated_at, status: 'ready' });
  const writes = w.forge.writes();
  assert.deepEqual(writes.map((c) => `${c.method} ${c.path}`), [
    `DELETE /repos/operator/BELAY/issues/${i.number}/labels/${lid(w, 'status/proposal-draft')}`,
    `POST /repos/operator/BELAY/issues/${i.number}/labels`,
  ]);
  assert.deepEqual(writes[1].body, { labels: [lid(w, 'status/needs-spec')] });
  assert.deepEqual(w.forge.issue('BELAY', i.number).labels.map((l) => l.name).sort(), ['priority/p2', 'status/needs-spec', 'type/feature', 'type/proposal']);
  assert.equal(r.status, 'ready');
  assert.deepEqual(r.changed, ['status']);
});

test('update priority replaces the single priority/* label and the Priority section', async () => {
  const w = world();
  const i = seed(w);
  const r = await w.proposals.update({ repo: 'BELAY', number: i.number, expected_updated_at: i.updated_at, priority: 'p1' });
  const issue = w.forge.issue('BELAY', i.number);
  assert.deepEqual(issue.labels.map((l) => l.name).filter((n) => n.startsWith('priority/')), ['priority/p1']);
  assert.equal(parseBody(issue.body).sections.priority, 'p1');
  assert.equal(r.priority, 'p1');
  assert.ok(r.changed.includes('priority'));
});

test('update may change the title, which must stay "Proposal: <name>"', async () => {
  const w = world();
  const i = seed(w);
  const r = await w.proposals.update({ repo: 'BELAY', number: i.number, expected_updated_at: i.updated_at, title: 'Proposal: Import and export' });
  assert.equal(w.forge.issue('BELAY', i.number).title, 'Proposal: Import and export');
  assert.deepEqual(r.changed, ['title']);
  await refused(w.proposals.update({ repo: 'BELAY', number: i.number, expected_updated_at: r.updated_at, title: 'Import' }), 'invalid_input');
});

test('update refuses stale with the current updated_at, and makes no PATCH, DELETE or POST', async () => {
  const w = world();
  const i = seed(w);
  const e = await refused(w.proposals.update({ repo: 'BELAY', number: i.number, expected_updated_at: '2026-01-01T00:00:00Z', status: 'ready', sections: { problem: 'x' } }), 'stale');
  assert.equal(e.details.updated_at, i.updated_at);
  assert.equal(w.forge.writes().length, 0);
});

test('update with nothing to change writes nothing and returns the current updated_at', async () => {
  const w = world();
  const i = seed(w);
  const r = await w.proposals.update({ repo: 'BELAY', number: i.number, expected_updated_at: i.updated_at, status: 'draft', sections: { problem: 'p' } });
  assert.deepEqual(r.changed, []);
  assert.equal(r.updated_at, i.updated_at);
  assert.equal(w.forge.writes().length, 0);
});

test('comment posts the body and returns comment_url and the issue\'s new updated_at', async () => {
  const w = world();
  const i = seed(w);
  const before = i.updated_at;
  const r = await w.proposals.comment({ repo: 'BELAY', number: i.number, body: 'From the 25 Nov call.' });
  const issue = w.forge.issue('BELAY', i.number);
  assert.equal(issue.comments.at(-1).body, 'From the 25 Nov call.');
  assert.deepEqual(r, { number: i.number, comment_url: issue.comments.at(-1).html_url, updated_at: issue.updated_at });
  assert.notEqual(r.updated_at, before);
});

test('comment refuses an empty body or one over 65,536 bytes with no forge call', async () => {
  const w = world();
  await refused(w.proposals.comment({ repo: 'BELAY', number: 1, body: '' }), 'invalid_input');
  await refused(w.proposals.comment({ repo: 'BELAY', number: 1, body: 'é'.repeat(40_000) }), 'invalid_input');
  assert.equal(w.forge.calls.length, 0);
});
