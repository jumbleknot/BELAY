// Label resolution and the narrow state/priority swap (FR-006, FR-007, FR-014; research R8; US3-AC3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLabels, planStatusSwap, planPrioritySwap, statusFromLabels, priorityFromLabels } from '../../src/labels.mjs';
import { createForgeClient } from '../../src/forge-client.mjs';
import { Refusal } from '../../src/refusal.mjs';
import { fakeFetch, paged } from './helpers/fake-fetch.mjs';
import { config } from './helpers/fixtures.mjs';

const NAMES = ['type/proposal', 'status/proposal-draft', 'status/needs-spec', 'priority/p1', 'priority/p2', 'priority/p3',
  'status/bot-managed', 'type/bug', 'type/feature', 'type/chore', 'type/tech-debt', 'status/blocked', 'dependencies',
  'security', 'extra-1', 'extra-2', 'extra-3', 'extra-4', 'extra-5', 'extra-6', 'extra-7', 'extra-8', 'extra-9', 'extra-10',
  'extra-11', 'extra-12', 'extra-13', 'extra-14', 'extra-15', 'extra-16', 'extra-17', 'extra-18', 'extra-19', 'extra-20',
  'extra-21', 'extra-22', 'extra-23', 'extra-24', 'extra-25', 'extra-26', 'extra-27', 'extra-28', 'extra-29', 'extra-30',
  'extra-31', 'extra-32', 'extra-33', 'extra-34', 'extra-35', 'extra-36', 'last-on-page-two'];
const ROWS = NAMES.map((name, i) => ({ id: 100 + i, name }));
const id = (name) => 100 + NAMES.indexOf(name);

async function labelSet(rows = ROWS) {
  const f = fakeFetch({ 'GET /repos/operator/BELAY/labels': paged(rows) });
  const set = await loadLabels(createForgeClient({ config, fetch: f.fetch }), '/repos/operator/BELAY');
  return { f, set };
}

const refusedUnknown = (fn, name) => {
  let e;
  try { fn(); } catch (err) { e = err; }
  assert.ok(e instanceof Refusal && e.code === 'unknown_label', String(e));
  assert.match(e.reason, new RegExp(name.replace('/', '\\/')));
};

test('every label page is loaded and names resolve to ids', async () => {
  const { f, set } = await labelSet();
  assert.equal(f.calls.length, 2);
  assert.equal(set.idOf('last-on-page-two'), id('last-on-page-two'));
  assert.deepEqual(set.resolve(['type/proposal', 'priority/p2']), [id('type/proposal'), id('priority/p2')]);
});

test('an unknown name refuses with unknown_label, naming it, and makes no further request', async () => {
  const { f, set } = await labelSet(ROWS.filter((r) => r.name !== 'status/proposal-draft'));
  const before = f.calls.length;
  refusedUnknown(() => set.resolve(['type/proposal', 'status/proposal-draft']), 'status/proposal-draft');
  refusedUnknown(() => set.idOf('nope/x'), 'nope/x');
  assert.equal(f.calls.length, before);
});

test('planStatusSwap: draft → ready removes the draft id and adds the ready id, nothing else', async () => {
  const { set } = await labelSet();
  assert.deepEqual(planStatusSwap(['type/proposal', 'status/proposal-draft', 'priority/p2', 'extra-1'], 'ready', set),
    { remove: [id('status/proposal-draft')], add: [id('status/needs-spec')] });
});

test('planStatusSwap: ready → draft is the reverse', async () => {
  const { set } = await labelSet();
  assert.deepEqual(planStatusSwap(['type/proposal', 'status/needs-spec'], 'draft', set),
    { remove: [id('status/needs-spec')], add: [id('status/proposal-draft')] });
});

test('planStatusSwap: no change when already in the target state', async () => {
  const { set } = await labelSet();
  assert.deepEqual(planStatusSwap(['type/proposal', 'status/needs-spec'], 'ready', set), { remove: [], add: [] });
});

test('planStatusSwap: from neither status label, only the target is added; from both, the other is removed', async () => {
  const { set } = await labelSet();
  assert.deepEqual(planStatusSwap(['type/proposal'], 'draft', set), { remove: [], add: [id('status/proposal-draft')] });
  assert.deepEqual(planStatusSwap(['status/needs-spec', 'status/proposal-draft'], 'draft', set), { remove: [id('status/needs-spec')], add: [] });
});

test('planPrioritySwap: p2 → p1 removes one and adds one; the same priority changes nothing', async () => {
  const { set } = await labelSet();
  assert.deepEqual(planPrioritySwap(['type/proposal', 'priority/p2'], 'p1', set), { remove: [id('priority/p2')], add: [id('priority/p1')] });
  assert.deepEqual(planPrioritySwap(['priority/p3'], 'p3', set), { remove: [], add: [] });
});

test('planPrioritySwap: several priority labels collapse to the single target', async () => {
  const { set } = await labelSet();
  assert.deepEqual(planPrioritySwap(['priority/p1', 'priority/p3', 'priority/p2'], 'p2', set),
    { remove: [id('priority/p1'), id('priority/p3')], add: [] });
  assert.deepEqual(planPrioritySwap(['priority/p1', 'priority/p3'], 'p2', set),
    { remove: [id('priority/p1'), id('priority/p3')], add: [id('priority/p2')] });
});

test('a swap to a label the repository lacks refuses with unknown_label', async () => {
  const { set } = await labelSet(ROWS.filter((r) => r.name !== 'status/needs-spec'));
  refusedUnknown(() => planStatusSwap(['status/proposal-draft'], 'ready', set), 'status/needs-spec');
});

test('statusFromLabels: draft, ready, or unknown with a warning for neither or both', () => {
  assert.deepEqual(statusFromLabels(['status/proposal-draft']), { status: 'draft', warning: null });
  assert.deepEqual(statusFromLabels(['status/needs-spec']), { status: 'ready', warning: null });
  assert.equal(statusFromLabels([]).status, 'unknown');
  assert.match(statusFromLabels([]).warning, /status/);
  assert.equal(statusFromLabels(['status/needs-spec', 'status/proposal-draft']).status, 'unknown');
});

test('priorityFromLabels: exactly one priority label, else unknown with a warning', () => {
  assert.deepEqual(priorityFromLabels(['priority/p3', 'x']), { priority: 'p3', warning: null });
  assert.equal(priorityFromLabels([]).priority, 'unknown');
  assert.equal(priorityFromLabels(['priority/p1', 'priority/p2']).priority, 'unknown');
  assert.match(priorityFromLabels(['priority/p1', 'priority/p2']).warning, /priority/);
});
