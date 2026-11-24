// renovate-health.mjs (feature 012, US1, research R4-R6): the weekly report whose silence is the alarm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRepositoryProblems, classifyBranch, buildReport, judgeFreshness, main, MARKER } from '../renovate-health.mjs';

const NOW = new Date('2026-11-25T08:30:00Z');
const DASH = '## Pending Approval\n\n - [ ] x\n\n## Repository problems\n\nThese problems occurred:\n\n - WARN: Failed to look up docker package node\n - ERROR: something broke\n - INFO: fine\n\n## Detected Dependencies\n\n - WARN: not in the section\n';

test('parseRepositoryProblems keeps the WARN and ERROR lines of the section only, without the bullet', () => {
  assert.deepEqual(parseRepositoryProblems(DASH), ['WARN: Failed to look up docker package node', 'ERROR: something broke']);
});
test('parseRepositoryProblems: the heading match is case-insensitive', () => {
  assert.deepEqual(parseRepositoryProblems('## Repository Problems\n\n - WARN: x\n'), ['WARN: x']);
});
test('parseRepositoryProblems: no section gives []', () => assert.deepEqual(parseRepositoryProblems('## Pending Approval\n'), []));

test('classifyBranch: not in main is active', () => assert.equal(classifyBranch({ inMain: false, pr: null }), 'active'));
test('classifyBranch: in main with an open PR is empty', () => assert.equal(classifyBranch({ inMain: true, pr: { number: 1 } }), 'empty'));
test('classifyBranch: in main with no PR is stale', () => assert.equal(classifyBranch({ inMain: true, pr: null }), 'stale'));
test('classifyBranch: unanswerable ancestry is unknown', () => assert.equal(classifyBranch({ inMain: null, pr: null }), 'unknown'));

const facts = (over = {}) => ({ dashboardFound: true, problems: [], protectionsReadable: true, trackingClosed: false,
  branches: [{ name: 'renovate/a', sha: 'a'.repeat(40), class: 'active', pr: { number: 5 } }], blocked: [], openBotPrs: 1, prLimit: 6,
  lockfile: { state: 'unaided', ok: true, line: 'lock file unaided' }, ...over });

test('buildReport: all clear is one line, with the marker, the date and what it checked', () => {
  const r = buildReport(facts(), NOW);
  assert.equal(r.healthy, true);
  assert.equal(r.body.split('\n').length, 1);
  assert.equal(r.body, `${MARKER} ✅ 2026-11-25 healthy: dashboard 0 problems · 1 bot branches active · 1/6 open PRs, none blocked · lock file unaided`);
});
test('buildReport: without a lock-file verdict the healthy line says "not checked"', () => {
  assert.match(buildReport(facts({ lockfile: null }), NOW).body, /lock file not checked$/);
});
for (const [name, over, want] of [
  ['a dashboard problem', { problems: ['WARN: x'] }, /dashboard problem: WARN: x/],
  ['an empty branch', { branches: [{ name: 'renovate/e', class: 'empty', pr: { number: 7 } }] }, /empty: renovate\/e \(PR #7/],
  ['a stale branch', { branches: [{ name: 'renovate/s', class: 'stale', pr: null }] }, /stale: renovate\/s/],
  ['an unknown branch', { branches: [{ name: 'renovate/u', class: 'unknown', pr: null }] }, /unknown ancestry: renovate\/u/],
  ['a blocked PR', { blocked: [{ number: 9, title: 'bump x', failing: ['guardrails / sast (pull_request)'] }] }, /blocked: PR #9 bump x · failing: guardrails \/ sast/],
  ['a failing lock-file verdict', { lockfile: { state: 'starved', ok: false, line: 'lock file starved: …' } }, /lock file starved/],
  ['a missing dashboard', { dashboardFound: false }, /dashboard not found/],
  ['unreadable protection', { protectionsReadable: false }, /branch protection unreadable/],
  ['a closed tracking issue', { trackingClosed: true }, /tracking issue was closed/],
]) {
  test(`buildReport: ${name} is a finding, under a header with the marker`, () => {
    const r = buildReport(facts(over), NOW);
    assert.equal(r.healthy, false);
    assert.match(r.body.split('\n')[0], new RegExp(`^${MARKER} ⚠️ 2026-11-25 \\d+ finding`));
    assert.match(r.body, want);
  });
}

const comment = (daysAgo, body = `${MARKER} ✅ x`) => ({ body, created_at: new Date(NOW.getTime() - daysAgo * 86400000).toISOString() });
test('judgeFreshness: a report 8 days old is fresh', () => assert.equal(judgeFreshness([comment(8)], NOW), 'fresh 8d'));
test('judgeFreshness: 8 days and 1 minute is stale', () => {
  assert.match(judgeFreshness([{ body: `${MARKER} x`, created_at: new Date(NOW.getTime() - 8 * 86400000 - 60000).toISOString() }], NOW), /^stale 8d/);
});
test('judgeFreshness: no marked comment is no-report-yet, and unmarked ones are ignored', () => {
  assert.equal(judgeFreshness([comment(1, '❌ could not read x')], NOW), 'no-report-yet');
  assert.equal(judgeFreshness([], NOW), 'no-report-yet');
});
test('judgeFreshness: the newest marked report counts', () => assert.equal(judgeFreshness([comment(20), comment(2)], NOW), 'fresh 2d'));

// ── main, with injected fetch and git ────────────────────────────────────────────────────────────

const ENV = { GITHUB_SERVER_URL: 'https://forge.example', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'read', CI_DIGEST_TOKEN: 'write' };
const DASHBOARD = { number: 64, title: 'Dependency Dashboard', state: 'open', body: DASH.replace(/ - (WARN|ERROR)[^\n]*\n/g, ''), labels: [{ name: 'status/bot-managed' }] };
const TRACKING = { number: 66, title: 'Dependency-bot health reports', state: 'open', labels: [{ name: 'status/bot-managed' }] };

function world({ tracking = TRACKING, failOn = null, tasks = [] } = {}) {
  const posts = [];
  const list = (rows) => ({ body: rows, total: rows.length });
  const routes = {
    'GET /issues?state=all': list(tracking ? [DASHBOARD, tracking] : [DASHBOARD]),
    'GET /branches': list([{ name: 'renovate/a', commit: { id: 'a'.repeat(40) } }, { name: 'feature-x', commit: { id: 'b'.repeat(40) } }]),
    'GET /pulls?state=open': list([{ number: 5, title: 'bump a', head: { ref: 'renovate/a', sha: 'a'.repeat(40) } }]),
    'GET /branch_protections': { body: [{ rule_name: 'main', branch_name: 'main', enable_status_check: true, status_check_contexts: ['guardrails / guardrails (pull_request)'] }] },
    [`GET /commits/${'a'.repeat(40)}/status`]: { body: { statuses: [{ context: 'guardrails / guardrails (pull_request)', status: 'success', created_at: NOW.toISOString() }] } },
    'GET /labels': list([{ id: 3, name: 'status/bot-managed' }]),
    'GET /issues/66/comments': { body: [comment(9)] },
    'GET /actions/tasks': { body: { workflow_runs: tasks, total_count: tasks.length } },
  };
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^https:\/\/forge\.example\/api\/v1\/repos\/o\/r/, '');
    if (method !== 'GET') { posts.push({ method, path, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true, status: 201, json: async () => ({ number: 66 }) }; }
    const key = Object.keys(routes).find((k) => `${method} ${path}`.startsWith(k));
    if (!key || (failOn && path.startsWith(failOn))) return { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } };
    const r = routes[key];
    return { ok: true, status: 200, json: async () => r.body, headers: { get: (h) => (h === 'x-total-count' && r.total !== undefined ? String(r.total) : null) } };
  };
  const git = (args) => (args[0] === 'merge-base' ? { status: 1 } : { status: 0, stdout: '' });
  return { fetch, git, posts };
}
const deps = (w) => ({ env: ENV, fetch: w.fetch, git: w.git, now: NOW, config: { prConcurrentLimit: 6 }, log: () => {}, error: () => {} });

test('health main: finds the dashboard by label and title, posts one report with the write token', async () => {
  const w = world();
  assert.equal(await main([], deps(w)), 0);
  const comments = w.posts.filter((p) => p.path === '/issues/66/comments');
  assert.equal(comments.length, 1);
  assert.equal(comments[0].auth, 'token write');
  assert.match(comments[0].body.body, /healthy: dashboard 0 problems · 1 bot branches active · 1\/6 open PRs, none blocked/);
});
test('health main: creates the tracking issue, labelled status/bot-managed, when it is missing', async () => {
  const w = world({ tracking: null });
  assert.equal(await main([], deps(w)), 0);
  const created = w.posts.find((p) => p.path === '/issues' && p.method === 'POST');
  assert.equal(created.body.title, 'Dependency-bot health reports');
  assert.deepEqual(created.body.labels, [3]);
});
test('health main: a closed tracking issue still gets the comment, and says so', async () => {
  const w = world({ tracking: { ...TRACKING, state: 'closed' } });
  await main([], deps(w));
  assert.match(w.posts.find((p) => p.path === '/issues/66/comments').body.body, /tracking issue was closed/);
});
test('health main: a failed read exits 1 and posts a failure comment without the marker, never "healthy"', async () => {
  const w = world({ failOn: '/branches' });
  assert.equal(await main([], deps(w)), 1);
  const c = w.posts.find((p) => p.path === '/issues/66/comments');
  assert.match(c.body.body, /❌ 2026-11-25 could not read/);
  assert.doesNotMatch(c.body.body, new RegExp(MARKER));
});
test('health main: --dry-run posts nothing', async () => {
  const w = world();
  assert.equal(await main(['--dry-run'], deps(w)), 0);
  assert.equal(w.posts.length, 0);
});
test('health main: --check-freshness --out writes stale, no-report-yet and missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-'));
  const out = join(dir, 'f.txt');
  await main(['--check-freshness', '--out', out], deps(world()));
  assert.match(readFileSync(out, 'utf8'), /^stale 9d/);
  await main(['--check-freshness', '--out', out], deps(world({ tracking: null })));
  assert.equal(readFileSync(out, 'utf8').trim(), 'no-report-yet');
  await main(['--check-freshness', '--out', out], deps(world({ tracking: null, tasks: [{ name: 'renovate-health', status: 'success' }] })));
  assert.equal(readFileSync(out, 'utf8').trim(), 'missing');
});
test('health main: --selftest passes', async () => assert.equal(await main(['--selftest'], deps(world())), 0));

test('health main: branch protection is read with CI_DIGEST_TOKEN, other reads with GITHUB_TOKEN (run token 403, measured 2026-11-24)', async () => {
  const w = world();
  const seen = {};
  const f = w.fetch;
  const spy = async (url, init = {}) => { const k = url.includes('/branch_protections') ? 'protections' : url.includes('/branches') ? 'branches' : null; if (k) seen[k] = init.headers?.Authorization; return f(url, init); };
  await main(['--dry-run'], { ...deps(w), fetch: spy });
  assert.deepEqual(seen, { protections: 'token write', branches: 'token read' });
});
