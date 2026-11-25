// Item #81: a manual dispatch silently cancelled the push run it was meant to replace.
//
// THE INCIDENT THIS PINS. On 2026-11-25 the merge of PR #80 created devcontainer-image push run 143.
// The shared host runner was busy, so the run sat queued and never reached `/actions/tasks`, which
// lists only jobs a runner has picked up. Reading that list, a session concluded that no push run
// existed and dispatched the workflow by hand. The workflow's `concurrency` group has
// `cancel-in-progress: true`, so the dispatch (run 147, created 13:22:05) cancelled run 143 in the
// same second. The trigger was never broken. The dispatch destroyed the evidence that it worked.
//
// So `dispatch` first asks `/actions/runs` (which DOES list queued runs) for a waiting, running or
// blocked run of the same workflow on the same ref, and refuses unless --supersede says the
// operator means to replace it. A forge that cannot answer is a refusal too, not a pass.
//
// Measured on Forgejo 15.0.3, 2026-11-25: `status` and `workflow_id` filters work and an unknown
// status answers 400; `head_branch` is silently ignored; a run's branch is in `prettyref`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCommand, cmdDispatch, ForgePrError, USAGE } from '../forge-pr.mjs';
import { usageNamesEveryFlag } from '../lib/argv-contract.mjs';

const REPO = '/repos/o/r';

/** A fake forge. `runs` maps a status to the rows GET /actions/runs answers for it. */
function fakeForge({ runs = {}, listStatus = 200, dispatchStatus = 204 } = {}) {
  const calls = [];
  return {
    calls,
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'GET') {
        if (listStatus !== 200) return { status: listStatus, data: { message: 'denied' } };
        const q = new URL(path, 'http://x').searchParams;
        const rows = (runs[q.get('status')] ?? []).filter((r) => r.workflow_id === q.get('workflow_id'));
        return { status: 200, data: { workflow_runs: rows, total_count: rows.length } };
      }
      return { status: dispatchStatus, data: dispatchStatus === 204 ? undefined : { message: 'nope' } };
    },
  };
}

const run = (n, over = {}) => ({
  id: 8000 + n, index_in_repo: n, workflow_id: 'devcontainer-image.yml', event: 'push', status: 'waiting',
  prettyref: 'main', commit_sha: 'b'.repeat(40), created: '2026-11-25T12:56:32Z', ...over,
});

const posts = (forge) => forge.calls.filter((c) => c.method === 'POST');

test('dispatch refuses when a run of the same workflow on the same ref is still queued (the run-143 replay)', async () => {
  const forge = fakeForge({ runs: { waiting: [run(143)] } });
  await assert.rejects(
    () => cmdDispatch({ workflow: 'devcontainer-image.yml', ref: 'main' }, { forge, repoPath: REPO, log: () => {} }),
    (err) => err instanceof ForgePrError && /143/.test(err.message) && /--supersede/.test(err.message) && /cancel/i.test(err.message),
  );
  assert.equal(posts(forge).length, 0, 'it dispatched anyway');
});

test('dispatch refuses for a running or blocked run too', async () => {
  for (const status of ['running', 'blocked']) {
    const forge = fakeForge({ runs: { [status]: [run(150, { status })] } });
    await assert.rejects(
      () => cmdDispatch({ workflow: 'devcontainer-image.yml', ref: 'main' }, { forge, repoPath: REPO, log: () => {} }),
      (err) => err instanceof ForgePrError && /150/.test(err.message),
      `a ${status} run did not block the dispatch`,
    );
    assert.equal(posts(forge).length, 0);
  }
});

test('dispatch asks the forge by workflow and status, never by the ignored head_branch filter', async () => {
  const forge = fakeForge();
  await cmdDispatch({ workflow: 'devcontainer-image.yml', ref: 'main' }, { forge, repoPath: REPO, log: () => {} });
  const gets = forge.calls.filter((c) => c.method === 'GET').map((c) => new URL(c.path, 'http://x'));
  assert.deepEqual(gets.map((u) => u.searchParams.get('status')).sort(), ['blocked', 'running', 'waiting']);
  for (const u of gets) {
    assert.equal(u.pathname, `${REPO}/actions/runs`);
    assert.equal(u.searchParams.get('workflow_id'), 'devcontainer-image.yml');
    assert.equal(u.searchParams.has('head_branch'), false);
    assert.ok(u.searchParams.get('page') && u.searchParams.get('limit'), 'limit without page returns the whole listing');
  }
});

test('dispatch goes ahead when the pending run is on another ref or of another workflow', async () => {
  const forge = fakeForge({ runs: { waiting: [run(160, { prettyref: 'feat/x' }), run(161, { workflow_id: 'guardrails.yml' })] } });
  const out = [];
  await cmdDispatch({ workflow: 'devcontainer-image.yml', ref: 'main' }, { forge, repoPath: REPO, log: (l) => out.push(l) });
  assert.equal(posts(forge).length, 1);
  assert.deepEqual(posts(forge)[0].body, { ref: 'main' });
});

test('--supersede dispatches over a pending run, and says which run it will cancel', async () => {
  const forge = fakeForge({ runs: { waiting: [run(143)] } });
  const out = [];
  await cmdDispatch({ workflow: 'devcontainer-image.yml', ref: 'main', supersede: true }, { forge, repoPath: REPO, log: (l) => out.push(l) });
  assert.equal(posts(forge).length, 1);
  assert.match(out.join('\n'), /143/);
});

test('a forge that cannot list runs is a refusal, not a pass', async () => {
  const forge = fakeForge({ listStatus: 403 });
  await assert.rejects(
    () => cmdDispatch({ workflow: 'devcontainer-image.yml', ref: 'main' }, { forge, repoPath: REPO, log: () => {} }),
    (err) => err instanceof ForgePrError && /403/.test(err.message) && /--supersede/.test(err.message),
  );
  assert.equal(posts(forge).length, 0);
});

test('the success line points at /actions/runs, which lists queued runs, not /actions/tasks', async () => {
  const out = [];
  await cmdDispatch({ workflow: 'guardrails.yml', ref: 'feat/x', inputs: { reason: 'manual' } }, { forge: fakeForge(), repoPath: REPO, log: (l) => out.push(l) });
  assert.match(out.join('\n'), /\/actions\/runs\?workflow_id=guardrails\.yml/);
  assert.doesNotMatch(out.join('\n'), /\/actions\/tasks/);
});

test('--supersede parses as a flag on dispatch only, and the usage names it', () => {
  assert.equal(resolveCommand(['dispatch', 'x.yml', '--ref', 'main', '--supersede']).supersede, true);
  assert.equal(resolveCommand(['dispatch', 'x.yml', '--ref', 'main']).supersede, undefined);
  assert.throws(() => resolveCommand(['merge', '7', '--expect-head', 'a'.repeat(40), '--supersede']));
  assert.deepEqual(usageNamesEveryFlag(USAGE, ['--supersede']), []);
});
