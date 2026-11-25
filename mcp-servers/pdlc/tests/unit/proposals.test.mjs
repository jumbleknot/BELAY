// Creating and reading proposals (data-model.md Proposal; FR-005, FR-009; research R9, R10;
// US1-AC4, US1-AC5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers/world.mjs';
import { renderBody } from '../../src/proposal-body.mjs';
import { Refusal } from '../../src/refusal.mjs';

const sections = {
  feature_name: 'Import export spreadsheet', problem: 'p', proposed_value: 'v', personas: 'c',
  goals_success: 'g', rough_scope: 'r', open_questions: '', out_of_scope: '', priority: 'p2',
};
const createArgs = (over = {}) => ({ repo: 'belay', title: 'Proposal: Import export spreadsheet', sections, priority: 'p2', status: 'draft', ...over });

const refused = async (promise, code) => {
  let e;
  try { await promise; } catch (err) { e = err; }
  assert.ok(e instanceof Refusal, `expected Refusal ${code}, got ${e?.stack ?? e}`);
  assert.equal(e.code, code);
  assert.ok(e.reason.length > 0);
  return e;
};

const labelIds = (w, names) => names.map((n) => w.forge.state.labels.belay.find((l) => l.name === n).id);

test('create files "Proposal: <feature_name>" with type/proposal + draft + one priority, sent as ids, body from renderBody', async () => {
  const w = world();
  const r = await w.proposals.create(createArgs());
  const post = w.forge.writes().find((c) => c.method === 'POST' && c.path === '/repos/operator/BELAY/issues');
  assert.equal(post.body.title, 'Proposal: Import export spreadsheet');
  assert.deepEqual([...post.body.labels].sort(), labelIds(w, ['type/proposal', 'status/proposal-draft', 'priority/p2']).sort());
  assert.equal(post.body.body, renderBody(sections));
  assert.deepEqual(r, { number: 1, title: 'Proposal: Import export spreadsheet', status: 'draft', priority: 'p2',
    url: 'https://forge.example/operator/BELAY/issues/1', updated_at: w.forge.issue('BELAY', 1).updated_at });
});

test('create with status ready uses status/needs-spec, and the repo name is used canonically', async () => {
  const w = world();
  await w.proposals.create(createArgs({ status: 'ready', priority: 'p1', sections: { ...sections, priority: 'p1' } }));
  const post = w.forge.writes()[0];
  assert.equal(post.path, '/repos/operator/BELAY/issues');
  assert.deepEqual([...post.body.labels].sort(), labelIds(w, ['type/proposal', 'status/needs-spec', 'priority/p1']).sort());
});

test('the Priority section is written from the priority argument', async () => {
  const w = world();
  await w.proposals.create(createArgs({ priority: 'p3', sections: { ...sections, priority: '' } }));
  assert.match(w.forge.writes()[0].body.body, /### Priority\n\np3\n/);
});

test('an empty feature_name, an unknown section key, or a title that is not "Proposal: <feature_name>" is invalid_input with no forge call', async () => {
  const w = world();
  await refused(w.proposals.create(createArgs({ sections: { ...sections, feature_name: '  ' } })), 'invalid_input');
  await refused(w.proposals.create(createArgs({ sections: { ...sections, colour: 'x' } })), 'invalid_input');
  await refused(w.proposals.create(createArgs({ title: 'Import export spreadsheet' })), 'invalid_input');
  assert.equal(w.forge.calls.length, 0);
});

test('a body over 64 KiB or a title over 255 characters is invalid_input before any forge call (write guard 0)', async () => {
  const w = world();
  const big = 'x'.repeat(40_000);
  await refused(w.proposals.create(createArgs({ sections: { ...sections, problem: big, rough_scope: big } })), 'invalid_input');
  const long = 'n'.repeat(250);
  await refused(w.proposals.create(createArgs({ title: `Proposal: ${long}`, sections: { ...sections, feature_name: long } })), 'invalid_input');
  assert.equal(w.forge.calls.length, 0);
});

test('an open proposal with the same title (trimmed, case-insensitive) refuses duplicate_title, naming it, and nothing is POSTed', async () => {
  const w = world();
  const existing = w.forge.addIssue('BELAY', { title: '  proposal: IMPORT export spreadsheet ', labels: ['type/proposal', 'status/proposal-draft', 'priority/p2'] });
  const e = await refused(w.proposals.create(createArgs()), 'duplicate_title');
  assert.match(e.reason, new RegExp(`#${existing.number}`));
  assert.equal(e.details.number, existing.number);
  assert.equal(w.forge.writes().length, 0);
});

test('a closed proposal or a non-proposal with the same title does not block create', async () => {
  const w = world();
  w.forge.addIssue('BELAY', { title: 'Proposal: Import export spreadsheet', labels: ['type/proposal'], state: 'closed' });
  w.forge.addIssue('BELAY', { title: 'Proposal: Import export spreadsheet', labels: ['type/feature'] });
  const r = await w.proposals.create(createArgs());
  assert.equal(r.number, 3);
});

test('the duplicate check sends type=issues and the resolved type/proposal label', async () => {
  const w = world();
  await w.proposals.create(createArgs());
  const listing = w.forge.calls.find((c) => c.method === 'GET' && c.path === '/repos/operator/BELAY/issues');
  assert.equal(listing.query.type, 'issues');
  assert.equal(listing.query.state, 'open');
  assert.equal(listing.query.labels, 'type/proposal');
});

test('create refuses unknown_label before any write when the repository lacks a proposal label', async () => {
  const w = world({ labels: ['type/proposal', 'priority/p1', 'priority/p2', 'priority/p3', 'status/needs-spec'] });
  const e = await refused(w.proposals.create(createArgs()), 'unknown_label');
  assert.match(e.reason, /status\/proposal-draft/);
  assert.equal(w.forge.writes().length, 0);
});

test('get returns parsed sections, labels, status, priority, comments and url', async () => {
  const w = world();
  const i = w.forge.addIssue('BELAY', { title: 'Proposal: X', body: renderBody({ ...sections, feature_name: 'X' }), labels: ['type/proposal', 'status/needs-spec', 'priority/p2'],
    comments: [{ user: { login: 'operator' }, created_at: '2026-11-25T09:00:00Z', body: 'first thought' }] });
  const r = await w.proposals.get({ repo: 'BELAY', number: i.number });
  assert.deepEqual(r, {
    number: i.number, title: 'Proposal: X', status: 'ready', priority: 'p2', state: 'open',
    sections: { ...sections, feature_name: 'X' }, labels: ['type/proposal', 'status/needs-spec', 'priority/p2'],
    comments: [{ author: 'operator', created_at: '2026-11-25T09:00:00Z', body: 'first thought' }],
    updated_at: i.updated_at, url: i.html_url, warnings: [],
  });
});

test('get: when the priority label and the Priority section disagree, the label wins, with a warning', async () => {
  const w = world();
  const i = w.forge.addIssue('BELAY', { title: 'Proposal: X', body: renderBody({ ...sections, priority: 'p3' }), labels: ['type/proposal', 'status/proposal-draft', 'priority/p1'] });
  const r = await w.proposals.get({ repo: 'BELAY', number: i.number });
  assert.equal(r.priority, 'p1');
  assert.ok(r.warnings.some((x) => /priority/i.test(x) && /p3/.test(x)), r.warnings.join());
});

test('get: neither or both status labels give status unknown with a warning', async () => {
  const w = world();
  const a = w.forge.addIssue('BELAY', { title: 'Proposal: A', body: renderBody(sections), labels: ['type/proposal', 'priority/p2'] });
  const b = w.forge.addIssue('BELAY', { title: 'Proposal: B', body: renderBody(sections), labels: ['type/proposal', 'priority/p2', 'status/needs-spec', 'status/proposal-draft'] });
  for (const n of [a.number, b.number]) {
    const r = await w.proposals.get({ repo: 'BELAY', number: n });
    assert.equal(r.status, 'unknown');
    assert.ok(r.warnings.some((x) => /status/.test(x)), r.warnings.join());
  }
});

test('get: an issue without type/proposal, or a PR, refuses not_a_proposal; a missing issue refuses not_found', async () => {
  const w = world();
  const plain = w.forge.addIssue('BELAY', { title: 'Bug', labels: ['type/bug'] });
  const pr = w.forge.addIssue('BELAY', { title: 'Proposal: PR', labels: ['type/proposal'], pull: true });
  await refused(w.proposals.get({ repo: 'BELAY', number: plain.number }), 'not_a_proposal');
  await refused(w.proposals.get({ repo: 'BELAY', number: pr.number }), 'not_a_proposal');
  await refused(w.proposals.get({ repo: 'BELAY', number: 99 }), 'not_found');
});

test('get and create refuse unknown_repo for another owner before any issue request', async () => {
  const w = world();
  await refused(w.proposals.get({ repo: 'someone/BELAY', number: 1 }), 'unknown_repo');
  await refused(w.proposals.create(createArgs({ repo: 'nope' })), 'unknown_repo');
  assert.ok(w.forge.calls.every((c) => c.path === '/repos/search'));
});
