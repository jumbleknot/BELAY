// reap-merged-branches.mjs (feature 012, US3, research R7): delete merged branches nothing uses, never
// one in use. A dry run by default. Every git and forge call is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBranch, main } from '../reap-merged-branches.mjs';

const NOW = new Date('2026-11-25T03:30:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const base = { name: 'feature-x', sha: 'f'.repeat(40), date: hoursAgo(48), inMain: true, onFirstParent: false, openPrHeads: new Set(), protectedGlobs: ['main'], now: NOW };
const d = (over) => decideBranch({ ...base, ...over });

test('decideBranch: main is protected', () => assert.deepEqual(d({ name: 'main' }), { decision: 'keep', reason: 'protected' }));
test('decideBranch: a protection rule_name glob protects', () => assert.equal(d({ name: 'release/1.0', protectedGlobs: ['main', 'release/*'] }).reason, 'protected'));
test('decideBranch: the head of an open PR is kept', () => assert.equal(d({ openPrHeads: new Set(['feature-x']) }).reason, 'open-pr'));
test('decideBranch: not merged is kept', () => assert.equal(d({ inMain: false }).reason, 'not-merged'));
test('decideBranch: unanswerable ancestry is kept', () => assert.equal(d({ inMain: null }).reason, 'ancestry-unknown'));
test('decideBranch: a branch on main\'s first-parent history is unstarted, even when its tip is days old', () => {
  assert.equal(d({ onFirstParent: true, date: hoursAgo(96) }).reason, 'unstarted');
});
test('decideBranch: a tip younger than 6 hours is too-new', () => assert.equal(d({ date: new Date(NOW.getTime() - (6 * 3600000 - 60000)).toISOString() }).reason, 'too-new'));
test('decideBranch: no readable date is kept', () => assert.equal(d({ date: null }).reason, 'no-date'));
test('decideBranch: merged, unused, unprotected, off the first-parent line, exactly 6 hours old is reaped', () => {
  assert.deepEqual(d({ date: hoursAgo(6) }), { decision: 'reap', reason: 'merged' });
});

// ── main ─────────────────────────────────────────────────────────────────────────────────────────

const MAIN_TIP = 'm'.repeat(40);
const REFS = [
  ['main', MAIN_TIP, hoursAgo(1)], ['renovate/old', 'r'.repeat(40), hoursAgo(30)], ['agent-new', MAIN_TIP, hoursAgo(1)],
  ['open-one', 'o'.repeat(40), hoursAgo(30)],
].map(([n, s, dt]) => `${n}\t${s}\t${dt}`).join('\n');

function world({ prsTotal = null, protections = [{ rule_name: 'main' }], pushFails = false } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'fetch') return { status: 0, stdout: '' };
    if (args[0] === 'for-each-ref') return { status: 0, stdout: `${REFS}\nHEAD\t${MAIN_TIP}\t${hoursAgo(1)}\n` };
    if (args[0] === 'rev-list') return { status: 0, stdout: `${MAIN_TIP}\n` };
    if (args[0] === 'merge-base') return { status: 0 };
    if (args[0] === 'push') return { status: pushFails ? 1 : 0, stderr: pushFails ? 'rejected' : '' };
    return { status: 1 };
  };
  const prs = [{ number: 3, head: { ref: 'open-one' } }];
  const fetch = async (url) => {
    if (url.includes('/pulls')) return { ok: true, status: 200, json: async () => (/[?&]page=1\b/.test(url) ? prs : []), headers: { get: (h) => (h === 'x-total-count' ? String(prsTotal ?? prs.length) : null) } };
    if (url.includes('/branch_protections')) return protections ? { ok: true, status: 200, json: async () => protections } : { ok: false, status: 403, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { git, fetch, calls, lines: [] };
}
const run = (argv, w) => main(argv, { env: { GITHUB_SERVER_URL: 'https://forge.example', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }, git: w.git, fetch: w.fetch, now: NOW, log: (l) => w.lines.push(l), error: (l) => w.lines.push(l) });

test('reaper main: the default is a dry run, which deletes nothing and names a reason for every branch', async () => {
  const w = world();
  assert.equal(await run([], w), 0);
  assert.ok(!w.calls.some((c) => c.startsWith('push')));
  const out = w.lines.join('\n');
  assert.match(out, /keep main \(protected\)/);
  assert.match(out, /would reap renovate\/old/);
  assert.match(out, /keep agent-new \(unstarted\)/);
  assert.match(out, /keep open-one \(open-pr\)/);
});
test('reaper main: --apply deletes with a lease to the classified sha', async () => {
  const w = world();
  assert.equal(await run(['--apply'], w), 0);
  assert.deepEqual(w.calls.filter((c) => c.startsWith('push')), [`push --force-with-lease=refs/heads/renovate/old:${'r'.repeat(40)} origin :refs/heads/renovate/old`]);
});
test('reaper main: a short open-PR listing deletes nothing and exits 1', async () => {
  const w = world({ prsTotal: 9 });
  assert.equal(await run(['--apply'], w), 1);
  assert.ok(!w.calls.some((c) => c.startsWith('push')));
});
test('reaper main: an unreadable protection listing deletes nothing and exits 1', async () => {
  const w = world({ protections: null });
  assert.equal(await run(['--apply'], w), 1);
  assert.ok(!w.calls.some((c) => c.startsWith('push')));
});
test('reaper main: a failed delete exits 1', async () => {
  assert.equal(await run(['--apply'], world({ pushFails: true })), 1);
});
test('reaper main: --selftest passes', async () => assert.equal(await run(['--selftest'], world()), 0));
