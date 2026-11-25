// check-lockfile-refresh.mjs (feature 012, US2, research R3): did the window run, and what did lock-file
// maintenance do in it? Every forge call is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveWindow, judgeLockfile, main, pickWindowVerdict } from '../check-lockfile-refresh.mjs';

const CFG = { timezone: 'UTC', schedule: ['* 5-6 * * 3'], lockFileMaintenance: { schedule: ['* 5-6 * * 3'] } };
const WED_0830 = new Date('2026-11-25T08:30:00Z'); // a Wednesday
const W = { start: '2026-11-25T05:00:00.000Z', end: '2026-11-25T07:00:00.000Z' };

test('deriveWindow: Wednesday 08:30 gives that day 05:00-07:00', () => {
  assert.deepEqual(deriveWindow(CFG, WED_0830), W);
});
test('deriveWindow: a window in progress is skipped for the previous one', () => {
  assert.deepEqual(deriveWindow(CFG, new Date('2026-11-25T06:00:00Z')), { start: '2026-11-18T05:00:00.000Z', end: '2026-11-18T07:00:00.000Z' });
});
test('deriveWindow: lockFileMaintenance.schedule is preferred over schedule', () => {
  const w = deriveWindow({ timezone: 'UTC', schedule: ['* 1 * * 1'], lockFileMaintenance: { schedule: ['* 5-6 * * 3'] } }, WED_0830);
  assert.deepEqual(w, W);
});
test('deriveWindow: a non-UTC timezone throws', () => {
  assert.throws(() => deriveWindow({ ...CFG, timezone: 'America/New_York' }, WED_0830), /UTC/);
});

// A captured-shape Actions task row (fields measured 2026-11-24).
const run = (n, started, over = {}) => ({ id: 9000 + n, name: 'renovate', head_sha: `${n}`.padStart(40, 'a'), run_number: n, event: 'schedule', status: 'success',
  created_at: started, updated_at: started, run_started_at: started, ...over });
const pr = (n, over = {}) => ({ number: n, title: 'chore(deps): lock file maintenance', head: { ref: 'renovate/lock-file-maintenance' },
  created_at: '2026-11-25T05:02:00Z', updated_at: '2026-11-25T05:02:00Z', state: 'open', ...over });
const IN = [run(90, '2026-11-25T05:00:10Z')];
const judge = (over) => judgeLockfile({ window: W, runs: IN, verdictDescription: '✅ renovate run: done, 1 PR(s) created; lock file: pr-created', prs: [pr(70)], ...over });

test('judgeLockfile: pr-created with a PR in the window is unaided', () => assert.equal(judge().state, 'unaided'));
test('judgeLockfile: pr-updated with an existing PR updated in the window is unaided', () => {
  assert.equal(judge({ verdictDescription: 'x; lock file: pr-updated', prs: [pr(70, { created_at: '2026-11-11T05:02:00Z' })] }).state, 'unaided');
});
test('judgeLockfile: already-existed with an open lock-file PR is unaided', () => {
  assert.equal(judge({ verdictDescription: 'x; lock file: already-existed', prs: [pr(70, { created_at: '2026-11-11T05:00:00Z', updated_at: '2026-11-11T05:00:00Z' })] }).state, 'unaided');
});
test('judgeLockfile: no-work is current (nothing to refresh)', () => assert.equal(judge({ verdictDescription: 'x; lock file: no-work', prs: [] }).state, 'current'));
test('judgeLockfile: not-scheduled fails as not-scheduled', () => assert.equal(judge({ verdictDescription: 'x; lock file: not-scheduled', prs: [] }).state, 'not-scheduled'));
test('judgeLockfile: pr-limit-reached and branch-limit-reached are starved', () => {
  for (const r of ['pr-limit-reached', 'branch-limit-reached']) assert.equal(judge({ verdictDescription: `x; lock file: ${r}`, prs: [] }).state, 'starved', r);
});
test('judgeLockfile: no window run is no-window-run', () => assert.equal(judge({ runs: [run(80, '2026-11-24T13:17:00Z')] }).state, 'no-window-run'));
test('judgeLockfile: no lock file part is unknown', () => assert.equal(judge({ verdictDescription: '✅ renovate run: done, 0 PR(s) created', prs: [] }).state, 'unknown'));
test('judgeLockfile: pr-created with no PR found in the window is unknown, naming both', () => {
  const v = judge({ prs: [] });
  assert.equal(v.state, 'unknown');
  assert.match(v.line, /pr-created/);
});
test('judgeLockfile: only a PR forced outside the window, with a failing result, is forced', () => {
  const v = judge({ verdictDescription: 'x; lock file: not-scheduled', prs: [pr(71, { created_at: '2026-11-24T12:30:00Z', updated_at: '2026-11-24T12:30:00Z' })] });
  assert.equal(v.state, 'forced');
  assert.match(v.line, /#71/);
});
test('judgeLockfile: no-work with a forced PR is current, naming the PR', () => {
  const v = judge({ verdictDescription: 'x; lock file: no-work', prs: [pr(71, { created_at: '2026-11-24T12:30:00Z', updated_at: '2026-11-24T12:30:00Z' })] });
  assert.equal(v.state, 'current');
  assert.match(v.line, /#71/);
});
test('judgeLockfile: a merged PR whose head became refs/pull/N/head still matches by title', () => {
  assert.equal(judge({ prs: [pr(70, { head: { ref: 'refs/pull/70/head' } })] }).state, 'unaided');
});
test('judgeLockfile: every line names the window', () => {
  for (const d of ['x; lock file: no-work', 'x; lock file: not-scheduled']) assert.match(judge({ verdictDescription: d }).line, /2026-11-25T05:00/);
});

// ── main, with an injected fetch ─────────────────────────────────────────────────────────────────

function forge(routes) {
  return async (url) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    const r = routes[key];
    return { ok: true, status: 200, json: async () => r.body, headers: { get: (h) => (h === 'x-total-count' && r.total !== undefined ? String(r.total) : null) } };
  };
}
// A captured-shape commit status row: check-renovate-config.mjs links each verdict to its own run.
const verdict = (runNumber, description) => ({ context: 'renovate/verdict', status: 'success', description,
  target_url: `https://forge.example/o/r/actions/runs/${runNumber}` });
const ENV = { GITHUB_SERVER_URL: 'https://forge.example', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
const routes = (desc = 'x; lock file: no-work') => ({
  '/actions/tasks': { body: { workflow_runs: IN, total_count: 1 } },
  [`/commits/${IN[0].head_sha}/statuses`]: { body: [verdict(IN[0].run_number, desc)], total: 1 },
  '/pulls': { body: [], total: 0 },
});
const silent = { log: () => {}, error: () => {} };

test('lockfile main: finds the window run, reads its verdict, writes --verdict-out, exits 0 when current', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'lfr-')), 'v.json');
  const rc = await main(['--now', WED_0830.toISOString(), '--verdict-out', out], { env: ENV, fetch: forge(routes()), config: CFG, ...silent });
  assert.equal(rc, 0);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).state, 'current');
});
test('lockfile main: a failing verdict exits 1', async () => {
  assert.equal(await main(['--now', WED_0830.toISOString()], { env: ENV, fetch: forge(routes('x; lock file: not-scheduled')), config: CFG, ...silent }), 1);
});
test('lockfile main: a failed read exits 1', async () => {
  const r = routes(); delete r['/pulls'];
  assert.equal(await main(['--now', WED_0830.toISOString()], { env: ENV, fetch: forge(r), config: CFG, ...silent }), 1);
});
test('lockfile main: --selftest passes', async () => {
  assert.equal(await main(['--selftest'], { env: ENV, ...silent }), 0);
});

// ── item #77: the window run's OWN verdict, not the newest on the commit ─────────────────────────
// Measured 2026-11-25: runs #114 (01:17), #116 (the 05:00 window) and #121 (07:17 security cron) all
// ran on one unchanged main commit. The combined status kept only #121's verdict, so the health job
// judged the window by a run outside it.
const SHA = '2f47590f43ba'.padEnd(40, '0');
const SAME_SHA = [run(121, '2026-11-25T07:17:27Z', { head_sha: SHA }), run(116, '2026-11-25T05:00:27Z', { head_sha: SHA }),
  run(114, '2026-11-25T01:17:27Z', { head_sha: SHA })];
const SAME_SHA_STATUSES = [ // newest first, as the forge lists them
  verdict(121, '✅ renovate run: done, 0 PR(s) created; lock file: not-scheduled; health report: fresh 0d'),
  verdict(116, '✅ renovate run: done, 3 PR(s) created; lock file: no-work; health report: fresh 0d'),
  verdict(114, '✅ renovate run: done, 0 PR(s) created; lock file: not-scheduled; health report: fresh 0d'),
];

test('pickWindowVerdict: picks the verdict linked to the window run, not the newest', () => {
  assert.match(pickWindowVerdict(SAME_SHA_STATUSES, 116), /lock file: no-work/);
});
test('pickWindowVerdict: a run number is matched whole (run 16 is not run 116)', () => {
  assert.equal(pickWindowVerdict(SAME_SHA_STATUSES, 16), null);
});
test('pickWindowVerdict: other contexts and a missing target_url are ignored; no match is null, never the newest', () => {
  const rows = [{ context: 'guardrails / guardrails (push)', description: 'lock file: no-work', target_url: 'https://forge.example/o/r/actions/runs/116' },
    { context: 'renovate/verdict', description: 'x; lock file: not-scheduled' }];
  assert.equal(pickWindowVerdict(rows, 116), null);
});
test('lockfile main: three runs on one commit, the window run #116 said no-work: current, exit 0 (item #77)', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'lfr-')), 'v.json');
  const rc = await main(['--now', WED_0830.toISOString(), '--verdict-out', out], { env: ENV, config: CFG, ...silent, fetch: forge({
    '/actions/tasks': { body: { workflow_runs: SAME_SHA, total_count: 3 } },
    [`/commits/${SHA}/statuses`]: { body: SAME_SHA_STATUSES, total: 3 },
    '/pulls': { body: [], total: 0 },
  }) });
  const v = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(v.state, 'current');
  assert.equal(v.result, 'no-work');
  assert.equal(rc, 0);
});
test('lockfile main: no verdict linked to the window run is unknown, exit 1 (item #77)', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'lfr-')), 'v.json');
  const rc = await main(['--now', WED_0830.toISOString(), '--verdict-out', out], { env: ENV, config: CFG, ...silent, fetch: forge({
    '/actions/tasks': { body: { workflow_runs: SAME_SHA, total_count: 3 } },
    [`/commits/${SHA}/statuses`]: { body: [SAME_SHA_STATUSES[0]], total: 1 },
    '/pulls': { body: [], total: 0 },
  }) });
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).state, 'unknown');
  assert.equal(rc, 1);
});
