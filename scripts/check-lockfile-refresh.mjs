#!/usr/bin/env node
// Did the routine window run, and what did lock-file maintenance do in it? (feature 012, US2, research R3)
//
// WHY THIS EXISTS. Lock-file maintenance is the channel that delivers transitive security fixes the
// version ranges already allow, and MovieCollectionManager (MCM) measured it dying silently, more
// than once:
//   - a missing toolchain;
//   - a spent PR budget (lock-file maintenance sorts last);
//   - a window its cron never met.
// MCM's check judged PR timestamps only, never failed, and could not tell "nothing to refresh" from
// "dead". This one asks two questions of the most recent window that has fully passed:
//   1. Did a `renovate` run start inside it? If not, the window never ran: the worst case.
//   2. What did that run say happened to lock-file maintenance? Feature 011's verdict status carries
//      Renovate's own result for that branch (`; lock file: <result>`), so `no-work` (already
//      current) is told apart from `not-scheduled` or `pr-limit-reached` (dead or starved).
// The window comes from renovate.json, never from a copy kept here.
//
// Usage:
//   node scripts/check-lockfile-refresh.mjs [--now <iso>] [--verdict-out <file>]
//   node scripts/check-lockfile-refresh.mjs --selftest
//
// Exit codes: 0 unaided or current · 1 any other verdict, or a failed read · 2 bad arguments.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cronMinutes } from './check-renovate-config.mjs';
import { listAll } from './lib/forge-list.mjs';
import { isMain } from './lib/is-main.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: check-lockfile-refresh.mjs [--now <iso>] [--verdict-out <file>] | --selftest';
const MINUTE = 60_000;
const WEEK_MINUTES = 7 * 1440;
// A run that starts at 06:59 can still open its PR a few minutes later.
const PR_SLACK_MS = 60 * MINUTE;

const minuteOfWeek = (d) => d.getUTCDay() * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes();

/** The most recent window that has FULLY passed (data-model.md Window): { start, end } as ISO strings. */
export function deriveWindow(config, now) {
  if ((config.timezone ?? 'UTC') !== 'UTC') throw new Error(`renovate.json timezone is ${config.timezone}: the window must be in UTC (rule C2)`);
  const schedule = config.lockFileMaintenance?.schedule ?? config.schedule;
  if (!Array.isArray(schedule) || !schedule.length) throw new Error('renovate.json has no schedule to derive the window from');
  const on = new Set(schedule.flatMap((c) => [...cronMinutes(c)]));
  const inSet = (t) => on.has(((minuteOfWeek(new Date(t)) % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES);
  const nowMin = Math.floor(now.getTime() / MINUTE) * MINUTE;
  // Walk back to the latest minute boundary e with (e - 1 min) in the window and e outside it: a
  // window that has ended. A window still in progress is skipped, because its end is not yet behind us.
  for (let k = 0; k <= 2 * WEEK_MINUTES; k++) {
    const end = nowMin - k * MINUTE;
    if (inSet(end - MINUTE) && !inSet(end)) {
      let start = end - MINUTE;
      while (inSet(start - MINUTE) && end - start < WEEK_MINUTES * MINUTE) start -= MINUTE;
      return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    }
  }
  throw new Error('no window in the last two weeks');
}

const PR_RESULTS = new Set(['pr-created', 'pr-updated']);
const EXISTING_RESULTS = new Set(['already-existed', 'done']);
const STARVED = new Set(['pr-limit-reached', 'branch-limit-reached']);
const isLockfilePr = (p) => /^renovate\/lock-file-maintenance/.test(p.head?.ref ?? '') || /lock file maintenance/i.test(p.title ?? '');

/** Judge one window (research R3; data-model.md LockfileVerdict). Pure. */
export function judgeLockfile({ window, runs, verdictDescription, prs }) {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  const inside = (t) => { const x = Date.parse(t ?? ''); return x >= start && x < end; };
  const active = (t) => { const x = Date.parse(t ?? ''); return x >= start && x < end + PR_SLACK_MS; };
  const windowRuns = runs.filter((r) => r.name === 'renovate' && inside(r.run_started_at))
    .sort((a, b) => Date.parse(b.run_started_at) - Date.parse(a.run_started_at));
  const windowRun = windowRuns[0] ?? null;
  const lockPrs = prs.filter(isLockfilePr);
  const activePr = lockPrs.find((p) => active(p.created_at) || active(p.updated_at)) ?? null;
  const openPr = lockPrs.find((p) => p.state === 'open') ?? null;
  // A PR the window did not touch: created (or forced from the dashboard) outside it.
  const forcedPr = activePr ? null : (lockPrs.find((p) => !active(p.created_at)) ?? null);
  const result = /lock file: ([\w-]+)/.exec(verdictDescription ?? '')?.[1] ?? null;

  let state;
  if (!windowRun) state = 'no-window-run';
  else if (PR_RESULTS.has(result)) state = activePr ? 'unaided' : 'unknown';
  else if (EXISTING_RESULTS.has(result)) state = openPr || activePr ? 'unaided' : 'unknown';
  else if (result === 'no-work') state = 'current';
  else if (result === 'not-scheduled') state = 'not-scheduled';
  else if (STARVED.has(result)) state = 'starved';
  else state = 'unknown';
  if (!['unaided', 'current'].includes(state) && state !== 'no-window-run' && forcedPr && !activePr) state = 'forced';

  const pr = activePr ?? forcedPr ?? openPr;
  const prText = pr ? `, PR #${pr.number}${activePr ? '' : ' (forced outside the window)'}` : '';
  const runText = windowRun ? `run #${windowRun.run_number}, result ${result ?? '(none)'}` : 'no renovate run started inside it';
  const ok = state === 'unaided' || state === 'current';
  const line = `lock file ${state}: window ${window.start}–${window.end}, ${runText}${prText}`;
  return { ok, state, windowRun: windowRun && { runNumber: windowRun.run_number, sha: windowRun.head_sha }, result, pr: pr && { number: pr.number, created_at: pr.created_at, updated_at: pr.updated_at, inWindow: Boolean(activePr) }, line };
}

// ── the forge reads ──────────────────────────────────────────────────────────────────────────────

async function readFacts({ env, fetch: doFetch, window }) {
  const base = `${env.GITHUB_SERVER_URL}/api/v1/repos/${env.GITHUB_REPOSITORY}`;
  const token = env.GITHUB_TOKEN;
  const runs = await listAll('/actions/tasks', { fetch: doFetch, token, base, items: 'workflow_runs' });
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  const windowRun = runs.filter((r) => r.name === 'renovate' && Date.parse(r.run_started_at ?? '') >= start && Date.parse(r.run_started_at ?? '') < end)
    .sort((a, b) => Date.parse(b.run_started_at) - Date.parse(a.run_started_at))[0];
  let verdictDescription = null;
  if (windowRun) {
    const res = await doFetch(`${base}/commits/${windowRun.head_sha}/status`, { headers: { Authorization: `token ${token}` } });
    if (!res.ok) throw new Error(`GET /commits/${windowRun.head_sha}/status: HTTP ${res.status}`);
    const body = await res.json();
    verdictDescription = (body.statuses ?? []).find((s) => s.context === 'renovate/verdict')?.description ?? null;
  }
  const prs = await listAll('/pulls?state=all', { fetch: doFetch, token, base });
  return { runs, verdictDescription, prs };
}

// ── --selftest ───────────────────────────────────────────────────────────────────────────────────

export async function selftest() {
  const failures = [];
  const cfg = { timezone: 'UTC', schedule: ['* 5-6 * * 3'] };
  const w = deriveWindow(cfg, new Date('2026-11-25T08:30:00Z'));
  if (w.start !== '2026-11-25T05:00:00.000Z' || w.end !== '2026-11-25T07:00:00.000Z') failures.push(`window derived as ${w.start}–${w.end}`);
  if (deriveWindow(cfg, new Date('2026-11-25T06:00:00Z')).start !== '2026-11-18T05:00:00.000Z') failures.push('a window in progress was chosen');
  const runs = [{ name: 'renovate', run_started_at: '2026-11-25T05:00:10Z', run_number: 1, head_sha: 'a' }];
  const pr = { number: 1, title: 'chore(deps): lock file maintenance', head: { ref: 'renovate/lock-file-maintenance' }, created_at: '2026-11-25T05:02:00Z', updated_at: '2026-11-25T05:02:00Z', state: 'open' };
  const cases = [
    ['pr-created', [pr], 'unaided'], ['no-work', [], 'current'], ['not-scheduled', [], 'not-scheduled'],
    ['pr-limit-reached', [], 'starved'], ['pr-created', [], 'unknown'],
  ];
  for (const [result, prs, want] of cases) {
    const got = judgeLockfile({ window: w, runs, verdictDescription: `x; lock file: ${result}`, prs }).state;
    if (got !== want) failures.push(`${result} judged ${got}, not ${want}`);
  }
  if (judgeLockfile({ window: w, runs: [], verdictDescription: null, prs: [] }).state !== 'no-window-run') failures.push('a missing window run passed');
  return { failures };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), { env = process.env, fetch: doFetch = fetch, config, log = console.log, error = console.error } = {}) {
  if (argv[0] === '--selftest') {
    const { failures } = await selftest();
    for (const f of failures) error(`[lockfile-refresh] ✗ selftest: ${f}`);
    if (!failures.length) log('[lockfile-refresh] ✅ selftest: every verdict state, and a window in progress skipped');
    return failures.length ? 1 : 0;
  }
  let now = new Date();
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--now' && argv[i + 1]) now = new Date(argv[++i]);
    else if (argv[i] === '--verdict-out' && argv[i + 1]) out = argv[++i];
    else { error(USAGE); return 2; }
  }
  if (Number.isNaN(now.getTime())) { error(USAGE); return 2; }
  let verdict;
  try {
    const cfg = config ?? JSON.parse(readFileSync(join(REPO_ROOT, 'renovate.json'), 'utf8'));
    const window = deriveWindow(cfg, now);
    verdict = judgeLockfile({ window, ...(await readFacts({ env, fetch: doFetch, window })) });
  } catch (e) {
    verdict = { ok: false, state: 'unknown', line: `lock file unknown: the check could not read its inputs: ${e.message}` };
  }
  if (out) writeFileSync(out, `${JSON.stringify(verdict, null, 2)}\n`);
  (verdict.ok ? log : error)(`[lockfile-refresh] ${verdict.ok ? '✅' : '❌'} ${verdict.line}`);
  return verdict.ok ? 0 : 1;
}

if (isMain(import.meta.url)) main().then((code) => process.exit(code));
