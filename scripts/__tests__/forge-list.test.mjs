// lib/forge-list.mjs (feature 012, research R8): every forge listing read to its end, or not at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAll, ForgeListError } from '../lib/forge-list.mjs';

// pages: array of { body, total, status } served in order; `total` goes to the header unless items-shaped.
function fake(pages) {
  const seen = [];
  const f = async (url) => {
    seen.push(url);
    const p = pages[seen.length - 1] ?? { body: [], total: 0 };
    return { ok: (p.status ?? 200) < 300, status: p.status ?? 200, json: async () => p.body,
      headers: { get: (k) => (k.toLowerCase() === 'x-total-count' && p.total !== undefined ? String(p.total) : null) } };
  };
  f.seen = seen;
  return f;
}
const opts = (f, extra = {}) => ({ fetch: f, token: 't', base: 'https://forge.example/api/v1/repos/o/r', pageSize: 2, ...extra });

test('listAll pages with limit and page until the total is read', async () => {
  const f = fake([{ body: [1, 2], total: 3 }, { body: [3], total: 3 }]);
  assert.deepEqual(await listAll('/branches', opts(f)), [1, 2, 3]);
  assert.match(f.seen[0], /\/branches\?limit=2&page=1$/);
  assert.match(f.seen[1], /page=2$/);
});
test('listAll keeps an existing query string', async () => {
  const f = fake([{ body: [], total: 0 }]);
  await listAll('/pulls?state=open', opts(f));
  assert.match(f.seen[0], /\/pulls\?state=open&limit=2&page=1$/);
});
test('listAll throws ForgeListError on a non-2xx status', async () => {
  await assert.rejects(listAll('/x', opts(fake([{ body: {}, status: 403 }]))), (e) => e instanceof ForgeListError && /403/.test(e.message));
});
test('listAll throws on a page that is not an array', async () => {
  await assert.rejects(listAll('/x', opts(fake([{ body: { a: 1 }, total: 1 }]))), /shape/);
});
test('listAll throws on a missing x-total-count', async () => {
  await assert.rejects(listAll('/x', opts(fake([{ body: [1] }]))), /total/);
});
test('listAll throws when the rows read differ from the total (a short read is never complete)', async () => {
  await assert.rejects(listAll('/x', opts(fake([{ body: [1, 2], total: 5 }, { body: [], total: 5 }]))), /read 2 of 5/);
});
test('listAll returns [] for an empty listing', async () => {
  assert.deepEqual(await listAll('/x', opts(fake([{ body: [], total: 0 }]))), []);
});
test('listAll with items reads an object page and its total_count (the Actions tasks shape)', async () => {
  const f = fake([{ body: { workflow_runs: [{ id: 1 }, { id: 2 }], total_count: 3 } }, { body: { workflow_runs: [{ id: 3 }], total_count: 3 } }]);
  assert.deepEqual((await listAll('/actions/tasks', opts(f, { items: 'workflow_runs' }))).map((r) => r.id), [1, 2, 3]);
});
test('listAll with items fails closed on a mismatch and on a missing total_count', async () => {
  await assert.rejects(listAll('/a', opts(fake([{ body: { workflow_runs: [{ id: 1 }], total_count: 4 } }, { body: { workflow_runs: [], total_count: 4 } }]), { items: 'workflow_runs' })), /read 1 of 4/);
  await assert.rejects(listAll('/a', opts(fake([{ body: { workflow_runs: [] } }]), { items: 'workflow_runs' })), /total/);
});
