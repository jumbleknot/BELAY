#!/usr/bin/env node
// Delete remote branches already merged into main that nothing uses (feature 012, US3, research R7).
//
// WHY THIS EXISTS. A bot branch that survives its merge is reused VERBATIM on the bot's next run,
// which opens an empty PR. MovieCollectionManager (MCM) measured four of them at once (#874–#877),
// from PRs merged through the API without deleting the head. BELAY's merge tool and the repository
// setting delete most merged heads; this catches the rest.
//
// It deletes a branch only when ALL of these hold, and prints why it kept every other one:
//   1. it is not `main` and matches no branch-protection rule (an unreadable listing deletes nothing);
//   2. it is not the head of an open PR (a short or malformed listing deletes nothing);
//   3. its head is in origin/main (unanswerable ancestry means keep);
//   4. its head is NOT on main's first-parent history. A branch just created from main points at a
//      first-parent commit, which may be days old, so a tip-age rule alone (MCM's) would reap a branch
//      another agent created a minute ago. A branch merged through a merge commit has its tip as a
//      second parent;
//   5. its tip commit is at least 6 hours old (MCM's grace period), as a second guard.
// Known limitation: a fast-forward or squash merge is never reaped. That is the safe direction.
//
// The delete is `git push --force-with-lease=refs/heads/<b>:<sha>`, leased to the sha classified
// here: the forge's DELETE endpoint has no precondition.
//
// Usage:
//   node scripts/reap-merged-branches.mjs            # a dry run: lists keep / would reap, deletes nothing
//   node scripts/reap-merged-branches.mjs --apply    # deletes (the scheduled workflow passes this)
//   node scripts/reap-merged-branches.mjs --selftest
//
// Exit codes: 0 done · 1 a read failed (nothing deleted) or a delete failed · 2 bad arguments.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAll } from './lib/forge-list.mjs';
import { isMain } from './lib/is-main.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: reap-merged-branches.mjs [--apply] | --selftest';
export const GRACE_MS = 6 * 3600_000;

const globToRegExp = (g) => new RegExp(`^${g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

/** One branch's decision (data-model.md ReapCandidate.decision). Pure. */
export function decideBranch({ name, date, inMain, onFirstParent, openPrHeads, protectedGlobs, now }) {
  const keep = (reason) => ({ decision: 'keep', reason });
  if (name === 'main' || protectedGlobs.some((g) => globToRegExp(g).test(name))) return keep('protected');
  if (openPrHeads.has(name)) return keep('open-pr');
  if (inMain === null || inMain === undefined) return keep('ancestry-unknown');
  if (!inMain) return keep('not-merged');
  if (onFirstParent) return keep('unstarted');
  const t = Date.parse(date ?? '');
  if (Number.isNaN(t)) return keep('no-date');
  if (now.getTime() - t < GRACE_MS) return keep('too-new');
  return { decision: 'reap', reason: 'merged' };
}

// ── git and the forge ────────────────────────────────────────────────────────────────────────────

const defaultGit = (args) => spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });

// The run token is refused on /branch_protections (HTTP 403, measured 2026-11-24, branch-reaper run #95), so the
// repository owner's CI_DIGEST_TOKEN (read:repository) reads it. Every other call keeps the run token.
async function readProtections(env, doFetch) {
  const token = env.CI_DIGEST_TOKEN || env.GITHUB_TOKEN;
  const res = await doFetch(`${env.GITHUB_SERVER_URL}/api/v1/repos/${env.GITHUB_REPOSITORY}/branch_protections`, { headers: { Authorization: `token ${token}` } });
  if (!res.ok) throw new Error(`GET /branch_protections: HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('GET /branch_protections: not a list');
  return list.flatMap((p) => [p.rule_name, p.branch_name]).filter(Boolean);
}

// ── --selftest ───────────────────────────────────────────────────────────────────────────────────

export async function selftest() {
  const failures = [];
  const now = new Date('2026-11-25T03:30:00Z');
  const base = { name: 'x', date: new Date(now - 48 * 3600_000).toISOString(), inMain: true, onFirstParent: false, openPrHeads: new Set(), protectedGlobs: ['main'], now };
  const cases = [
    [{ name: 'main' }, 'protected'], [{ openPrHeads: new Set(['x']) }, 'open-pr'], [{ inMain: false }, 'not-merged'],
    [{ inMain: null }, 'ancestry-unknown'], [{ onFirstParent: true }, 'unstarted'], [{ date: null }, 'no-date'],
    [{ date: new Date(now - GRACE_MS + 60_000).toISOString() }, 'too-new'], [{}, 'merged'],
  ];
  for (const [over, want] of cases) {
    const got = decideBranch({ ...base, ...over }).reason;
    if (got !== want) failures.push(`${JSON.stringify(Object.keys(over))} gave ${got}, not ${want}`);
  }
  return { failures };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), { env = process.env, fetch: doFetch = fetch, git = defaultGit, now = new Date(), log = console.log, error = console.error } = {}) {
  if (argv[0] === '--selftest') {
    const { failures } = await selftest();
    for (const f of failures) error(`[reaper] ✗ selftest: ${f}`);
    if (!failures.length) log('[reaper] ✅ selftest: every keep reason, and a reap only when all five rules hold');
    return failures.length ? 1 : 0;
  }
  if (argv.some((a) => a !== '--apply')) { error(USAGE); return 2; }
  const apply = argv.includes('--apply');

  let refs;
  let protectedGlobs;
  let openPrHeads;
  let firstParent;
  try {
    const fetched = git(['fetch', '--prune', 'origin']);
    if (fetched.status !== 0) throw new Error(`git fetch --prune failed: ${fetched.stderr ?? ''}`.trim());
    const out = git(['for-each-ref', '--format=%(refname:strip=3)%09%(objectname)%09%(committerdate:iso-strict)', 'refs/remotes/origin']);
    if (out.status !== 0) throw new Error('git for-each-ref failed');
    refs = out.stdout.split('\n').filter(Boolean).map((l) => l.split('\t')).filter(([n]) => n && n !== 'HEAD')
      .map(([name, sha, date]) => ({ name, sha, date: date || null }));
    protectedGlobs = await readProtections(env, doFetch);
    const base = `${env.GITHUB_SERVER_URL}/api/v1/repos/${env.GITHUB_REPOSITORY}`;
    openPrHeads = new Set((await listAll('/pulls?state=open', { fetch: doFetch, token: env.GITHUB_TOKEN, base })).map((p) => p.head?.ref).filter(Boolean));
    const fp = git(['rev-list', '--first-parent', 'origin/main']);
    if (fp.status !== 0) throw new Error('git rev-list --first-parent origin/main failed (a shallow checkout?)');
    firstParent = new Set(fp.stdout.split('\n').filter(Boolean));
  } catch (e) {
    error(`[reaper] ✗ ${e.message}. Nothing deleted.`);
    return 1;
  }

  let reaped = 0;
  let failed = 0;
  for (const r of refs) {
    const a = git(['merge-base', '--is-ancestor', r.sha, 'refs/remotes/origin/main']);
    const inMain = a.status === 0 ? true : a.status === 1 ? false : null;
    const d = decideBranch({ ...r, inMain, onFirstParent: firstParent.has(r.sha), openPrHeads, protectedGlobs, now });
    if (d.decision === 'keep') { log(`keep ${r.name} (${d.reason})`); continue; }
    if (!apply) { log(`would reap ${r.name} (${r.sha.slice(0, 12)})`); reaped++; continue; }
    const p = git(['push', `--force-with-lease=refs/heads/${r.name}:${r.sha}`, 'origin', `:refs/heads/${r.name}`]);
    if (p.status === 0) { log(`reap ${r.name} (${r.sha.slice(0, 12)})`); reaped++; } else { error(`✗ reap ${r.name} failed: ${(p.stderr ?? '').trim()}`); failed++; }
  }
  log(`[reaper] ${apply ? 'reaped' : 'would reap'} ${reaped} of ${refs.length} branch(es)${failed ? `; ${failed} delete(s) FAILED` : ''}${apply ? '' : ' (dry run: nothing deleted; pass --apply)'}`);
  return failed ? 1 : 0;
}

if (isMain(import.meta.url)) main().then((code) => process.exit(code));
