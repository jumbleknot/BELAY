#!/usr/bin/env node
// The dependency bot's weekly health report (feature 012, US1, research R4–R6).
//
// WHY THIS EXISTS. A bot that silently stops working is worse than no bot, because you believe you
// are covered (ADR-0004). MovieCollectionManager (MCM) found its bot broken four independent ways,
// each for weeks, because nothing asked "is it still doing its job?". So once a week this posts ONE
// comment on one tracking issue: one line when healthy, one line per finding otherwise. Because it
// posts every week, a missing week means this job died, and the bot's own run checks for exactly
// that (`--check-freshness`, research R6).
//
// What it reads:
//   - the Dependency Dashboard's "Repository problems" section;
//   - every renovate/* branch, classified active / empty / stale / unknown with git ancestry;
//   - every open bot PR's required checks: MCM's report said "Healthy" twice while bot PRs were red;
//   - the lock-file verdict from check-lockfile-refresh.mjs.
//
// Unlike MCM's version it never exits 0 on a failed read. It posts a failure comment (without the
// report marker, so the watchdog does not count it as a report) and exits 1.
//
// Usage:
//   node scripts/renovate-health.mjs [--lockfile-verdict <file>] [--dry-run]
//   node scripts/renovate-health.mjs --check-freshness [--out <file>]
//   node scripts/renovate-health.mjs --selftest
//
// Tokens: GITHUB_TOKEN reads; CI_DIGEST_TOKEN (write:issue) posts the comment and creates the issue.
// Exit codes: 0 posted (whatever the findings) · 1 a read or the post failed · 2 bad arguments.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMergeVerdict, parseRequiredGlobs } from './ci-status.mjs';
import { listAll } from './lib/forge-list.mjs';
import { isMain } from './lib/is-main.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: renovate-health.mjs [--lockfile-verdict <file>] [--dry-run] | --check-freshness [--out <file>] | --selftest';
export const MARKER = '<!-- renovate-health -->';
export const TRACKING_TITLE = 'Dependency-bot health reports';
const DASHBOARD_TITLE = 'Dependency Dashboard';
const BOT_LABEL = 'status/bot-managed';
const DAY_MS = 86_400_000;
const STALE_AFTER_MS = 8 * DAY_MS;

/** The tracking issue's description (research R5); docs/runbooks/renovate.md quotes it. */
export const TRACKING_BODY = [
  'The dependency bot\'s weekly health report (feature 012). `.forgejo/workflows/renovate-health.yml` posts one comment',
  'here every Wednesday after the routine window: one line when healthy, one line per finding otherwise.',
  '',
  '**A week with no comment means the health job itself stopped.** The bot\'s own run checks this, and fails its',
  '`renovate/verdict` when the newest report is more than 8 days old. See docs/runbooks/renovate.md, "The health loop".',
  '',
  'Never close or relabel this issue: it is bot-managed, and `backlog.mjs ready` deliberately hides it.',
].join('\n');

// ── pure parts ───────────────────────────────────────────────────────────────────────────────────

/** The WARN/ERROR lines of the dashboard's "Repository problems" section (data-model.md DashboardProblem.text). */
export function parseRepositoryProblems(body) {
  const m = /^##\s+Repository problems\s*$/im.exec(body ?? '');
  if (!m) return [];
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next)).split('\n')
    .map((l) => l.trim().replace(/^-\s+/, ''))
    .filter((l) => /\b(WARN|ERROR)\b/.test(l));
}

/** data-model.md BotBranch.class, from MCM's measured rules (spec FR-004). */
export function classifyBranch({ inMain, pr }) {
  if (inMain === null || inMain === undefined) return 'unknown';
  if (!inMain) return 'active';
  return pr ? 'empty' : 'stale';
}

const isoDate = (now) => now.toISOString().slice(0, 10);

/** The report (data-model.md HealthReport): { healthy, body }. One line when healthy. */
export function buildReport(facts, now) {
  const date = isoDate(now);
  const findings = [];
  if (!facts.dashboardFound) findings.push(`dashboard not found (no open "${DASHBOARD_TITLE}" labelled ${BOT_LABEL})`);
  for (const p of facts.problems ?? []) findings.push(`dashboard problem: ${p}`);
  for (const b of facts.branches ?? []) {
    if (b.class === 'empty') findings.push(`empty: ${b.name} (PR #${b.pr?.number} adds nothing to main)`);
    else if (b.class === 'stale') findings.push(`stale: ${b.name} (already in main, no PR: the bot would reuse it verbatim)`);
    else if (b.class === 'unknown') findings.push(`unknown ancestry: ${b.name} (git could not answer whether it is in main)`);
  }
  for (const p of facts.blocked ?? []) findings.push(`blocked: PR #${p.number} ${p.title} · failing: ${p.failing.join(', ')}`);
  if (!facts.protectionsReadable) findings.push('branch protection unreadable: blocked bot PRs cannot be judged');
  if (facts.lockfile && !facts.lockfile.ok) findings.push(facts.lockfile.line);
  if (facts.trackingClosed) findings.push('tracking issue was closed: reports still post here; reopen it');

  const lockText = facts.lockfile ? facts.lockfile.state : 'not checked';
  const budget = `${facts.openBotPrs ?? 0}/${facts.prLimit ?? '?'} open PRs`;
  if (!findings.length) {
    const n = (facts.branches ?? []).length;
    return { healthy: true, body: `${MARKER} ✅ ${date} healthy: dashboard 0 problems · ${n} bot branches active · ${budget}, none blocked · lock file ${lockText}` };
  }
  return {
    healthy: false,
    body: [`${MARKER} ⚠️ ${date} ${findings.length} finding(s)`, ...findings.map((f) => `- ${f}`), `- (info) ${budget}; lock file ${lockText}`].join('\n'),
  };
}

/** data-model.md TrackingIssue.freshness from the issue's comments. A failure comment has no marker. */
export function judgeFreshness(comments, now) {
  const marked = (comments ?? []).filter((c) => (c.body ?? '').includes(MARKER) && !Number.isNaN(Date.parse(c.created_at ?? '')));
  if (!marked.length) return 'no-report-yet';
  const newest = Math.max(...marked.map((c) => Date.parse(c.created_at)));
  const age = now.getTime() - newest;
  const days = Math.floor(age / DAY_MS);
  return age > STALE_AFTER_MS ? `stale ${days}d` : `fresh ${days}d`;
}

// ── the forge and git ────────────────────────────────────────────────────────────────────────────

function forge(env, doFetch) {
  const base = `${env.GITHUB_SERVER_URL}/api/v1/repos/${env.GITHUB_REPOSITORY}`;
  const read = env.GITHUB_TOKEN;
  const auth = (t) => ({ Authorization: `token ${t}` });
  return {
    base,
    protectionsToken: env.CI_DIGEST_TOKEN || read,
    list: (path, opts = {}) => listAll(path, { fetch: doFetch, token: read, base, ...opts }),
    // `as` picks the token: the run token is refused on /branch_protections (403, measured 2026-11-24, run #94),
    // so that one read uses the owner's CI_DIGEST_TOKEN (read:repository).
    async get(path, as = read) {
      const res = await doFetch(`${base}${path}`, { headers: auth(as) });
      if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
      return res.json();
    },
    async post(path, body) {
      if (!env.CI_DIGEST_TOKEN) throw new Error('CI_DIGEST_TOKEN is not set: the report cannot be posted');
      const res = await doFetch(`${base}${path}`, { method: 'POST', headers: { ...auth(env.CI_DIGEST_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`POST ${path}: HTTP ${res.status}`);
      return res.json();
    },
  };
}

const BOT_ISSUES = `/issues?state=all&type=issues&labels=${encodeURIComponent(BOT_LABEL)}`;
const defaultGit = (args) => spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });

function ancestry(git, sha) {
  const r = git(['merge-base', '--is-ancestor', sha, 'origin/main']);
  return r.status === 0 ? true : r.status === 1 ? false : null;
}

async function readFacts(f, git, config) {
  const issues = await f.list(BOT_ISSUES);
  const dashboard = issues.find((i) => i.title === DASHBOARD_TITLE && i.state === 'open') ?? null;
  const tracking = issues.find((i) => i.title === TRACKING_TITLE) ?? null;
  const branches = (await f.list('/branches')).filter((b) => b.name.startsWith('renovate/'));
  const botPrs = (await f.list('/pulls?state=open')).filter((p) => (p.head?.ref ?? '').startsWith('renovate/'));
  let globs = null;
  try { globs = parseRequiredGlobs(await f.get('/branch_protections', f.protectionsToken), 'main'); } catch { globs = null; }
  const classified = branches.map((b) => {
    const sha = b.commit?.id;
    const pr = botPrs.find((p) => p.head.ref === b.name) ?? null;
    const inMain = sha ? ancestry(git, sha) : null;
    return { name: b.name, sha, inMain, pr: pr && { number: pr.number }, class: classifyBranch({ inMain, pr }) };
  });
  const blocked = [];
  if (globs) {
    for (const p of botPrs) {
      const body = await f.get(`/commits/${p.head.sha}/status`);
      const v = computeMergeVerdict(body.statuses ?? [], { requiredGlobs: globs, event: 'pull_request' });
      if (v.blocking.length) blocked.push({ number: p.number, title: p.title, failing: v.blocking.map((c) => c.context) });
    }
  }
  return {
    tracking,
    facts: {
      dashboardFound: Boolean(dashboard), problems: dashboard ? parseRepositoryProblems(dashboard.body) : [],
      branches: classified, blocked, protectionsReadable: Boolean(globs), openBotPrs: botPrs.length,
      prLimit: config.prConcurrentLimit, trackingClosed: tracking?.state === 'closed',
    },
  };
}

async function ensureTracking(f, tracking) {
  if (tracking) return tracking.number;
  const label = (await f.list('/labels')).find((l) => l.name === BOT_LABEL);
  if (!label) throw new Error(`label ${BOT_LABEL} does not exist: run backlog.mjs setup-labels`);
  return (await f.post('/issues', { title: TRACKING_TITLE, body: TRACKING_BODY, labels: [label.id] })).number;
}

async function freshness(f, now) {
  const tracking = (await f.list(BOT_ISSUES)).find((i) => i.title === TRACKING_TITLE);
  if (!tracking) {
    const runs = await f.list('/actions/tasks', { items: 'workflow_runs' });
    return runs.some((r) => r.name === 'renovate-health' && r.status === 'success') ? 'missing' : 'no-report-yet';
  }
  // Issue comments come back whole on this forge (no paging), so one read is the full list.
  return judgeFreshness(await f.get(`/issues/${tracking.number}/comments`), now);
}

// ── --selftest ───────────────────────────────────────────────────────────────────────────────────

export async function selftest() {
  const failures = [];
  const now = new Date('2026-11-25T08:30:00Z');
  const check = (name, ok) => { if (!ok) failures.push(name); };
  check('problems parsed', parseRepositoryProblems('## Repository problems\n - WARN: x\n## Next\n - WARN: y\n').join() === 'WARN: x');
  check('classes', ['active', 'empty', 'stale', 'unknown'].join() === [
    classifyBranch({ inMain: false }), classifyBranch({ inMain: true, pr: {} }), classifyBranch({ inMain: true, pr: null }), classifyBranch({ inMain: null })].join());
  const ok = { dashboardFound: true, problems: [], branches: [], blocked: [], protectionsReadable: true, openBotPrs: 0, prLimit: 6, lockfile: null };
  check('healthy is one line', buildReport(ok, now).body.split('\n').length === 1);
  check('a blocked PR is a finding', !buildReport({ ...ok, blocked: [{ number: 1, title: 't', failing: ['c'] }] }, now).healthy);
  check('a missing dashboard is a finding', !buildReport({ ...ok, dashboardFound: false }, now).healthy);
  check('8 days + 1 minute is stale', judgeFreshness([{ body: MARKER, created_at: new Date(now - STALE_AFTER_MS - 60_000).toISOString() }], now).startsWith('stale'));
  check('no report yet passes', judgeFreshness([{ body: '❌ x', created_at: now.toISOString() }], now) === 'no-report-yet');
  return { failures };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), { env = process.env, fetch: doFetch = fetch, git = defaultGit, now = new Date(), config, log = console.log, error = console.error } = {}) {
  if (argv[0] === '--selftest') {
    const { failures } = await selftest();
    for (const x of failures) error(`[renovate-health] ✗ selftest: ${x}`);
    if (!failures.length) log('[renovate-health] ✅ selftest: problems, classes, the one-line healthy report, findings and freshness');
    return failures.length ? 1 : 0;
  }
  const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const known = new Set(['--dry-run', '--check-freshness', '--out', '--lockfile-verdict']);
  for (let i = 0; i < argv.length; i++) {
    if (!known.has(argv[i])) { error(USAGE); return 2; }
    if (argv[i] === '--out' || argv[i] === '--lockfile-verdict') { if (!argv[i + 1]) { error(USAGE); return 2; } i++; }
  }
  const f = forge(env, doFetch);

  if (argv.includes('--check-freshness')) {
    let state;
    try { state = await freshness(f, now); } catch (e) { state = 'unknown'; error(`[renovate-health] ✗ freshness could not be read: ${e.message}`); }
    if (opt('--out')) writeFileSync(opt('--out'), `${state}\n`);
    log(`[renovate-health] health report: ${state}`);
    return 0;
  }

  const cfg = config ?? JSON.parse(readFileSync(join(REPO_ROOT, 'renovate.json'), 'utf8'));
  const lockFile = opt('--lockfile-verdict');
  const lockfile = lockFile && existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : (lockFile ? { ok: false, state: 'unknown', line: 'lock file unknown: the check wrote no verdict' } : null);

  let tracking = null;
  let report;
  try {
    const r = await readFacts(f, git, cfg);
    tracking = r.tracking;
    report = buildReport({ ...r.facts, lockfile }, now);
  } catch (e) {
    const body = `❌ ${isoDate(now)} could not read: ${e.message}`;
    error(`[renovate-health] ${body}`);
    if (!argv.includes('--dry-run') && tracking === null) {
      try { tracking = (await f.list(BOT_ISSUES)).find((i) => i.title === TRACKING_TITLE) ?? null; } catch { /* the failure is already being reported */ }
    }
    if (!argv.includes('--dry-run') && tracking) {
      try { await f.post(`/issues/${tracking.number}/comments`, { body }); } catch (p) { error(`[renovate-health] ✗ the failure comment was refused too: ${p.message}`); }
    }
    return 1;
  }

  log(report.body);
  if (argv.includes('--dry-run')) return 0;
  try {
    const n = await ensureTracking(f, tracking);
    await f.post(`/issues/${n}/comments`, { body: report.body });
    log(`[renovate-health] posted on issue #${n} (${report.healthy ? 'healthy' : 'findings'})`);
    return 0;
  } catch (e) {
    error(`[renovate-health] ✗ the report could not be posted: ${e.message}`);
    return 1;
  }
}

if (isMain(import.meta.url)) main().then((code) => process.exit(code));
