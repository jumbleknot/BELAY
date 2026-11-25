// The owner-and-repository guard's allowlist (FR-012, research R1; US1-AC1, US3-AC1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepoAllowlist } from '../../src/repo-allowlist.mjs';
import { createForgeClient } from '../../src/forge-client.mjs';
import { Refusal } from '../../src/refusal.mjs';
import { fakeFetch } from './helpers/fake-fetch.mjs';
import { config, repoRow, searchRoute } from './helpers/fixtures.mjs';

function setup(rows, { clones = [] } = {}) {
  const state = { rows };
  const f = fakeFetch({ 'GET /repos/search': (req) => searchRoute(state.rows)(req) });
  const allowlist = createRepoAllowlist({
    forge: createForgeClient({ config, fetch: f.fetch }),
    config,
    existsSync: (p) => clones.some((c) => p.replace(/\\/g, '/') === `/clones/${c}/.git`),
  });
  return { f, allowlist, state };
}

const refusedUnknown = async (promise) => {
  let e;
  try { await promise; } catch (err) { e = err; }
  assert.ok(e instanceof Refusal && e.code === 'unknown_repo', String(e));
  assert.ok(e.reason.length > 0);
};

test('list keeps only rows owned by the configured owner, compared case-insensitively', async () => {
  const { allowlist } = setup([repoRow('BELAY', { owner: 'Operator' }), repoRow('mcm'), repoRow('theirs', { owner: 'someone-else' })]);
  const { repos, truncated } = await allowlist.list();
  assert.deepEqual(repos.map((r) => r.name), ['BELAY', 'mcm']);
  assert.equal(truncated, false);
});

test('list rows carry name, description, default_branch and has_clone', async () => {
  const { allowlist } = setup([repoRow('BELAY', { default_branch: 'trunk', description: 'tooling' }), repoRow('mcm')], { clones: ['BELAY'] });
  const { repos } = await allowlist.list();
  assert.deepEqual(repos, [
    { name: 'BELAY', description: 'tooling', default_branch: 'trunk', has_clone: true },
    { name: 'mcm', description: 'mcm repo', default_branch: 'main', has_clone: false },
  ]);
});

test('resolve returns the canonical name for a case-different request', async () => {
  const { allowlist } = setup([repoRow('BELAY')]);
  const r = await allowlist.resolve('belay');
  assert.equal(r.name, 'BELAY');
  assert.equal(r.default_branch, 'main');
});

test('the list is cached: a second resolve makes no request', async () => {
  const { f, allowlist } = setup([repoRow('BELAY'), repoRow('mcm')]);
  await allowlist.resolve('BELAY');
  const before = f.calls.length;
  await allowlist.resolve('mcm');
  assert.equal(f.calls.length, before);
});

test('a miss refreshes the list once, then finds a repository created since', async () => {
  const { f, allowlist, state } = setup([repoRow('BELAY')]);
  await allowlist.resolve('BELAY');
  state.rows = [repoRow('BELAY'), repoRow('fresh')];
  const r = await allowlist.resolve('FRESH');
  assert.equal(r.name, 'fresh');
  assert.equal(f.calls.length, 2);
});

test('an unknown name refuses with unknown_repo after exactly one refresh', async () => {
  const { f, allowlist } = setup([repoRow('BELAY')]);
  await allowlist.resolve('BELAY');
  await refusedUnknown(allowlist.resolve('nope'));
  assert.equal(f.calls.length, 2);
});

test('another owner\'s repository refuses with unknown_repo', async () => {
  const { allowlist } = setup([repoRow('BELAY'), repoRow('theirs', { owner: 'someone-else' })]);
  await refusedUnknown(allowlist.resolve('theirs'));
});

test('the owner/repo form refuses with unknown_repo and makes no forge request at all', async () => {
  const { f, allowlist } = setup([repoRow('BELAY')]);
  await refusedUnknown(allowlist.resolve('someone-else/BELAY'));
  await refusedUnknown(allowlist.resolve('operator/BELAY'));
  assert.equal(f.calls.length, 0);
});

test('an empty or non-string repo refuses with unknown_repo and makes no request', async () => {
  const { f, allowlist } = setup([repoRow('BELAY')]);
  await refusedUnknown(allowlist.resolve(''));
  await refusedUnknown(allowlist.resolve(undefined));
  assert.equal(f.calls.length, 0);
});
