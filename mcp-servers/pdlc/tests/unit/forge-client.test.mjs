// The forge client (FR-015 paging, FR-018, spec edge cases: forge unreachable, missing scope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForgeClient } from '../../src/forge-client.mjs';
import { Refusal } from '../../src/refusal.mjs';
import { fakeFetch, paged } from './helpers/fake-fetch.mjs';

const CANARY = 'canary-0123456789abcdef0123456789abcdef';
const config = Object.freeze({ forgeUrl: 'https://forge.example', apiBase: 'https://forge.example/api/v1', owner: 'operator', token: CANARY, cloneRoot: '/tmp/x' });
const client = (routes) => { const f = fakeFetch(routes); return { f, forge: createForgeClient({ config, fetch: f.fetch }) }; };

const refusedWith = async (promise, code) => {
  let e;
  try { await promise; } catch (err) { e = err; }
  assert.ok(e instanceof Refusal, `expected a Refusal, got ${e}`);
  assert.equal(e.code, code);
  assert.ok(e.reason.length > 0);
  assert.doesNotMatch(`${e.message} ${e.reason} ${JSON.stringify(e)}`, /canary-/);
  return e;
};

test('the Authorization: token header is sent, and appears in no returned value', async () => {
  const { f, forge } = client({ 'GET /repos/operator/r': () => ({ body: { name: 'r' } }) });
  const data = await forge.get('/repos/operator/r');
  assert.equal(f.calls[0].headers.Authorization, `token ${CANARY}`);
  assert.doesNotMatch(JSON.stringify(data), /canary-|token /);
  assert.doesNotMatch(f.calls[0].url, /canary-/);
});

test('getAll follows x-total-count with limit at most 50', async () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ id: i }));
  const { f, forge } = client({ 'GET /repos/search': paged(items) });
  const r = await forge.getAll('/repos/search', { query: { q: '' } });
  assert.equal(r.items.length, 120);
  assert.equal(r.total, 120);
  assert.equal(r.truncated, false);
  assert.deepEqual(f.calls.map((c) => c.query.page), ['1', '2', '3']);
  assert.ok(f.calls.every((c) => Number(c.query.limit) <= 50 && c.query.q === ''));
});

test('getAll stops at the page cap and reports truncated: true', async () => {
  const items = Array.from({ length: 500 }, (_, i) => ({ id: i }));
  const { f, forge } = client({ 'GET /repos/search': paged(items) });
  const r = await forge.getAll('/repos/search', { maxPages: 2 });
  assert.equal(r.items.length, 100);
  assert.equal(r.total, 500);
  assert.equal(r.truncated, true);
  assert.equal(f.calls.length, 2);
});

test('getAll stops on an empty page even when x-total-count is missing', async () => {
  const { forge } = client({ 'GET /x': ({ query }) => ({ body: query.page === '1' ? [{ id: 1 }] : [] }) });
  const r = await forge.getAll('/x');
  assert.deepEqual(r.items, [{ id: 1 }]);
  assert.equal(r.truncated, false);
});

test('401 and 403 map to forge_auth, naming the capability, never the token', async () => {
  for (const status of [401, 403]) {
    const { forge } = client({ 'GET /repos/search': () => ({ status, body: { message: `token ${CANARY} lacks read:user` } }) });
    const e = await refusedWith(forge.get('/repos/search', { capability: 'list repositories' }), 'forge_auth');
    assert.match(e.reason, /list repositories/);
  }
});

test('a network error maps to forge_unreachable', async () => {
  const { forge } = client({ 'POST /repos/operator/r/issues': () => { throw new TypeError('fetch failed'); } });
  const e = await refusedWith(forge.post('/repos/operator/r/issues', { title: 'x' }), 'forge_unreachable');
  assert.match(e.reason, /nothing was written|could not be reached/);
});

test('404 maps to not_found', async () => {
  const { forge } = client({});
  await refusedWith(forge.get('/repos/operator/r/issues/9'), 'not_found');
});

test('an error body is never echoed verbatim', async () => {
  const secretish = 'internal stack trace at /srv/forge/handler.go:42';
  for (const status of [400, 422, 500, 502]) {
    const { forge } = client({ 'PATCH /repos/operator/r/issues/1': () => ({ status, body: { message: secretish } }) });
    let e;
    try { await forge.patch('/repos/operator/r/issues/1', { title: 't' }); } catch (err) { e = err; }
    assert.ok(e instanceof Refusal, String(e));
    assert.doesNotMatch(`${e.message} ${e.reason}`, /handler\.go|stack trace/);
  }
});

test('post, patch and delete send JSON and return the parsed body (null for 204)', async () => {
  const { f, forge } = client({
    'POST /a': ({ body }) => ({ status: 201, body: { got: body } }),
    'PATCH /b': ({ body }) => ({ body: { got: body } }),
    'DELETE /c': () => ({ status: 204 }),
  });
  assert.deepEqual(await forge.post('/a', { x: 1 }), { got: { x: 1 } });
  assert.deepEqual(await forge.patch('/b', { y: 2 }), { got: { y: 2 } });
  assert.equal(await forge.delete('/c'), null);
  assert.equal(f.calls[0].headers['Content-Type'], 'application/json');
});

test('raw returns the text of a file, and null for a 404 rather than refusing', async () => {
  const { f, forge } = client({ 'GET /repos/operator/r/raw/.forgejo/issue_template/proposal.yaml': () => ({ text: 'name: Proposal\n' }) });
  assert.equal(await forge.raw('/repos/operator/r/raw/.forgejo/issue_template/proposal.yaml', { query: { ref: 'main' } }), 'name: Proposal\n');
  assert.equal(f.calls[0].query.ref, 'main');
  assert.equal(await forge.raw('/repos/operator/r/raw/missing.yaml'), null);
});

test('getAll reads rows from an envelope when told to (repos/search answers {ok, data})', async () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: i }));
  const { forge } = client({ 'GET /repos/search': (req) => { const r = paged(items)(req); return { ...r, body: { ok: true, data: r.body } }; } });
  const r = await forge.getAll('/repos/search', { rows: (body) => body.data });
  assert.equal(r.items.length, 60);
});
