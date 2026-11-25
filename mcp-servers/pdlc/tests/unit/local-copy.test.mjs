// The local proposal copy: status and sync (data-model.md Local proposal copy; research R3;
// US1-AC2, US1-AC3, edge case: default branch not main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createLocalCopy } from '../../src/local-copy.mjs';
import { fakeGit } from './helpers/fake-git.mjs';

const ROOT = '/clones';
const repo = { name: 'BELAY', default_branch: 'main' };
const PATH = join(ROOT, 'BELAY');
const ORIGIN = 'https://forge.example/operator/BELAY.git';
const originUrlFor = (name) => `https://forge.example/operator/${name}.git`;

const healthy = (overrides = {}) => ({
  'rev-parse --show-toplevel': { stdout: `${PATH}\n` },
  'config --get remote.origin.url': { stdout: `${ORIGIN}\n` },
  'fetch origin main': { stdout: '' },
  'symbolic-ref --short HEAD': { stdout: 'main\n' },
  'status --porcelain=v1 --untracked-files=normal': { stdout: '' },
  'rev-list --count HEAD..origin/main': { stdout: '0\n' },
  'rev-list --count origin/main..HEAD': { stdout: '0\n' },
  'rev-parse HEAD': { stdout: 'aaaa111\n' },
  ...overrides,
});

const copy = (script, { exists = true, defaultBranch } = {}) => {
  const g = fakeGit(script);
  const lc = createLocalCopy({ cloneRoot: ROOT, originUrlFor, git: g.git, existsSync: (p) => exists && p === PATH });
  return { g, lc, r: defaultBranch ? { ...repo, default_branch: defaultBranch } : repo };
};

test('status of an absent copy: exists false and null for the rest, with no git call', async () => {
  const { g, lc, r } = copy({}, { exists: false });
  assert.deepEqual(await lc.status(r), { repo: 'BELAY', path: PATH, exists: false, branch: null, default_branch: null, clean: null, behind: null, ahead: null });
  assert.equal(g.calls.length, 0);
});

test('status of a clean copy behind origin: fetch, then branch, clean, behind, ahead', async () => {
  const { g, lc, r } = copy(healthy({ 'rev-list --count HEAD..origin/main': { stdout: '3\n' } }));
  assert.deepEqual(await lc.status(r), { repo: 'BELAY', path: PATH, exists: true, branch: 'main', default_branch: 'main', clean: true, behind: 3, ahead: 0 });
  assert.ok(g.verbs().includes('fetch'));
  assert.ok(g.calls.every((c) => c.cwd === PATH));
  assert.ok(!g.verbs().includes('merge'), 'status never changes the working tree');
});

test('status reports dirty when porcelain output is non-empty (untracked files count)', async () => {
  const { lc, r } = copy(healthy({ 'status --porcelain=v1 --untracked-files=normal': { stdout: '?? notes.txt\n' } }));
  assert.equal((await lc.status(r)).clean, false);
});

test('status on a detached HEAD reports branch null', async () => {
  const { lc, r } = copy(healthy({ 'symbolic-ref --short HEAD': { code: 128, stderr: 'fatal: ref HEAD is not a symbolic ref' } }));
  assert.equal((await lc.status(r)).branch, null);
});

test('sync of an absent copy: a blobless, single-branch clone of the default branch, with no userinfo', async () => {
  const { g, lc, r } = copy({
    [`clone --filter=blob:none --single-branch --branch main ${ORIGIN} ${PATH}`]: { stdout: '' },
    'rev-parse HEAD': { stdout: 'bbbb222\n' },
  }, { exists: false });
  assert.deepEqual(await lc.sync(r), { repo: 'BELAY', path: PATH, action: 'cloned', from: null, to: 'bbbb222', default_branch: 'main' });
  const clone = g.calls.find((c) => c.args[0] === 'clone');
  assert.equal(clone.cwd, ROOT);
  assert.doesNotMatch(clone.args.join(' '), /@/);
});

test('sync of a clean copy that is behind: fetch, then merge --ff-only, reporting from and to', async () => {
  let head = 'aaaa111';
  const { g, lc, r } = copy(healthy({
    'rev-list --count HEAD..origin/main': { stdout: '2\n' },
    'rev-parse HEAD': () => ({ stdout: `${head}\n` }),
    'merge --ff-only origin/main': () => { head = 'cccc333'; return { stdout: '' }; },
  }));
  assert.deepEqual(await lc.sync(r), { repo: 'BELAY', path: PATH, action: 'fast_forwarded', from: 'aaaa111', to: 'cccc333', default_branch: 'main' });
  const verbs = g.verbs();
  assert.ok(verbs.indexOf('fetch') < verbs.indexOf('merge'));
});

test('sync of a copy behind by 0 reports up_to_date and does not merge', async () => {
  const { g, lc, r } = copy(healthy());
  assert.deepEqual(await lc.sync(r), { repo: 'BELAY', path: PATH, action: 'up_to_date', from: 'aaaa111', to: 'aaaa111', default_branch: 'main' });
  assert.ok(!g.verbs().includes('merge'));
});

test('the default branch is always the repository\'s, never a literal main', async () => {
  const trunk = {
    'rev-parse --show-toplevel': { stdout: `${PATH}\n` },
    'config --get remote.origin.url': { stdout: `${ORIGIN}\n` },
    'fetch origin trunk': { stdout: '' },
    'symbolic-ref --short HEAD': { stdout: 'trunk\n' },
    'status --porcelain=v1 --untracked-files=normal': { stdout: '' },
    'rev-list --count HEAD..origin/trunk': { stdout: '1\n' },
    'rev-list --count origin/trunk..HEAD': { stdout: '0\n' },
    'rev-parse HEAD': { stdout: 'x\n' },
    'merge --ff-only origin/trunk': { stdout: '' },
  };
  const { g, lc, r } = copy(trunk, { defaultBranch: 'trunk' });
  await lc.status(r);
  await lc.sync(r);
  assert.ok(g.calls.every((c) => !c.args.some((a) => /\bmain\b/.test(a))), JSON.stringify(g.calls.map((c) => c.args)));
  const { g: g2, lc: lc2 } = copy({ [`clone --filter=blob:none --single-branch --branch trunk ${ORIGIN} ${PATH}`]: {}, 'rev-parse HEAD': { stdout: 'y\n' } }, { exists: false });
  await lc2.sync({ ...repo, default_branch: 'trunk' });
  assert.ok(g2.calls[0].args.includes('trunk'));
});

test('the expected origin comes from the injected originUrlFor', async () => {
  const seen = [];
  const g = fakeGit({ 'clone --filter=blob:none --single-branch --branch main file:///bare/BELAY.git /clones/BELAY': {}, 'rev-parse HEAD': { stdout: 'z\n' } });
  const lc = createLocalCopy({ cloneRoot: ROOT, originUrlFor: (n) => { seen.push(n); return `file:///bare/${n}.git`; }, git: g.git, existsSync: () => false });
  await lc.sync(repo);
  assert.deepEqual(seen, ['BELAY']);
});
