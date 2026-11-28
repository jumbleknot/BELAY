// The live tier for feature 016 (T068; quickstart §1; SC-004, SC-007, SC-011): the whole spec lifecycle against the
// real forge and the real `ci-smoke` repository, through the real modules, real git and the real Spec Kit scripts run
// by the real PowerShell. No doubles anywhere (constitution Test Type Integrity).
//
// Needs: `ci-smoke` with Spec Kit 1.4.x on a PROTECTED `main` (quickstart Prerequisites), and a token with
// `write:issue` + `write:repository` (the 016 `pdlc` scope), given to run.mjs as PDLC_IT_TOKEN.
//
// What it leaves behind: the proposal issue is closed by the helper; the feature branch it published
// (`NNN-pdlc-it-<run id>-life`) stays on `ci-smoke` until the operator agrees to delete it (docs/runbooks/pdlc.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createForgeClient } from '../../src/forge-client.mjs';
import { createRepoAllowlist } from '../../src/repo-allowlist.mjs';
import { createProposals } from '../../src/proposals.mjs';
import { createSetupCheck } from '../../src/setup-check.mjs';
import { createLocalCopy } from '../../src/local-copy.mjs';
import { createGitRunner } from '../../src/git-runner.mjs';
import { createSpecKitRunner } from '../../src/spec-kit-runner.mjs';
import { createSpecWorktree } from '../../src/spec-worktree.mjs';
import { createSpecFiles } from '../../src/spec-files.mjs';
import { createSpecApproval } from '../../src/spec-approval.mjs';
import { createSpecLifecycle } from '../../src/spec-lifecycle.mjs';
import { readTrailers } from '../../src/stages.mjs';
import { Refusal } from '../../src/refusal.mjs';

const REPO = 'ci-smoke';
const RUN = process.env.PDLC_IT_RUN_ID;
const cloneRoot = mkdtempSync(join(tmpdir(), 'pdlc-it-specs-'));
const config = Object.freeze({
  forgeUrl: process.env.PDLC_FORGE_URL, apiBase: `${process.env.PDLC_FORGE_URL}/api/v1`,
  owner: process.env.PDLC_FORGE_OWNER, token: process.env.PDLC_FORGE_TOKEN, cloneRoot,
});
assert.ok(config.forgeUrl && config.owner && config.token && RUN, 'run through `pnpm nx run pdlc:integration-forge`, which sets the PDLC_* variables');

const forge = createForgeClient({ config });
const allowlist = createRepoAllowlist({ forge, config });
const proposals = createProposals({ forge, allowlist, config });
const setupCheck = createSetupCheck({ forge, allowlist, config });
const git = createGitRunner({ token: config.token });
const originUrlFor = (name) => `${config.forgeUrl}/${encodeURIComponent(config.owner)}/${encodeURIComponent(name)}.git`;
const localCopy = createLocalCopy({ cloneRoot, originUrlFor, git });
const specs = createSpecLifecycle({
  forge, allowlist, proposals, localCopy, config,
  specKit: createSpecKitRunner({ cloneRoot, git }),
  worktree: createSpecWorktree({ cloneRoot, git }),
  files: createSpecFiles(),
  approval: createSpecApproval({ git }),
});
const R = `/repos/${config.owner}/${REPO}`;
const created = [];

// ── the helper: direct API and git calls the server itself never makes ──────────────────────────
const LABELS = JSON.parse(readFileSync(new URL('../../contract/proposal-labels.json', import.meta.url), 'utf8'));
async function ensureLabels() {
  const { items } = await forge.getAll(`${R}/labels`);
  for (const l of LABELS) if (!items.some((x) => x.name === l.name)) await forge.post(`${R}/labels`, l);
}
const closeOwn = async () => { for (const n of created) await forge.patch(`${R}/issues/${n}`, { state: 'closed' }).catch(() => {}); };
// The helper's own git, with the token in the environment only (as the server does), never in argv or a config file.
const helperGit = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: token ${config.token}`, GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '' },
});
const stageLabels = async (number) => (await forge.get(`${R}/issues/${number}`)).labels.map((l) => l.name).filter((n) => /^status\//.test(n));
const latestTrailer = async (number) => readTrailers((await forge.getAll(`${R}/issues/${number}/comments`)).items).latest;
const refused = async (promise, code) => {
  let e;
  try { await promise; } catch (err) { e = err; }
  assert.ok(e instanceof Refusal, `expected ${code}, got ${e?.stack ?? e}`);
  assert.equal(e.code, code, e.reason);
  return e;
};

const specText = ({ branch, number, title, sessions }) => [
  `# Feature Specification: ${title}`, '',
  `**Feature Branch**: \`${branch}\``, `**Input**: Proposal #${number}: ${title}`, '',
  '## Clarifications', '',
  ...Array.from({ length: sessions }, (_, i) => [`### Session 2026-11-28 (${i + 1})`, '', '- Nothing to ask: the live tier\'s spec is fixed.', '']).flat(),
  '## Requirements', '', '- **FR-001**: The live tier round-trips a spec through the forge.', '',
].join('\n');

test.before(ensureLabels);
test.after(async () => { await closeOwn(); rmSync(cloneRoot, { recursive: true, force: true }); });

test('check_setup: ci-smoke\'s default branch is protected (the forge is the second refusal)', async () => {
  const r = await setupCheck.check({ repo: REPO });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.default_branch_protected, true, 'protect ci-smoke\'s main first (quickstart Prerequisites)');
});

test('check_spec_kit: ci-smoke has a supported Spec Kit in its local copy', async () => {
  const repo = await allowlist.resolve(REPO);
  await localCopy.sync(repo);
  const kit = await specs.checkSpecKit({ repo: REPO });
  assert.equal(kit.ok, true, kit.reason);
  assert.equal(kit.supported, true);
});

test('the full lifecycle on the real forge: start, write, approve (publish), forge refuses main, branch changed, take latest, re-approve, reopen, withdraw', async (t) => {
  const repo = await allowlist.resolve(REPO);
  const title = `Proposal: pdlc-it-${RUN}-life`;
  const s = {
    feature_name: `pdlc-it-${RUN}-life`, problem: 'A live-forge spec lifecycle.', proposed_value: 'Proves 016 on the forge.',
    personas: 'The operator.', goals_success: '- [ ] it publishes', rough_scope: '- start, approve, reopen, withdraw',
    open_questions: '', out_of_scope: '',
  };
  const p = await proposals.create({ repo: REPO, title, sections: s, priority: 'p3', status: 'ready' });
  created.push(p.number);

  // start_spec, timed against the plan's 30 s target (finding P1)
  const t0 = Date.now();
  const started = await specs.start({ repo: REPO, number: p.number, short_name: `pdlc-it-${RUN}-life` });
  const startMs = Date.now() - t0;
  t.diagnostic(`start_spec took ${startMs} ms (plan target: 30000 ms)`);
  console.log(`[pdlc-it] start_spec took ${startMs} ms (plan target: 30000 ms)`);
  assert.match(started.branch, new RegExp(`^\\d{3}-pdlc-it-${RUN}-life$`));
  assert.deepEqual(await stageLabels(p.number), ['status/spec-in-progress']);
  assert.deepEqual(await latestTrailer(p.number), { stage: 'spec-in-progress', branch: started.branch, spec: started.spec_dir });
  const copyPath = localCopy.pathOf(repo.name);
  assert.equal(helperGit(copyPath, 'symbolic-ref', '--short', 'HEAD').trim(), repo.default_branch, 'the default-branch copy is never switched');

  // write a clarified spec, then approve: commit and publish the feature branch
  let g = await specs.get({ repo: REPO, number: p.number });
  const w = await specs.writeFile({ repo: REPO, number: p.number, path: 'spec.md', base_revision: g.revision,
    content: specText({ branch: started.branch, number: p.number, title, sessions: 1 }) });
  const a1 = await specs.approve({ repo: REPO, number: p.number, base_revision: w.revision });
  assert.equal(a1.stage, 'ready-to-plan');
  assert.equal((await forge.get(`${R}/branches/${encodeURIComponent(started.branch)}`)).commit.id, a1.commit, 'the branch is published at the approval commit');
  assert.deepEqual(await stageLabels(p.number), ['status/ready-to-plan']);
  assert.equal((await latestTrailer(p.number)).stage, 'ready-to-plan');

  // SC-007: the server refuses a push to main, and so does the forge (a protected branch), through the helper's own git
  const ctxWorktree = g.worktree_path;
  await refused(git.run(['push', 'origin', `refs/heads/${started.branch}:refs/heads/${repo.default_branch}`], {
    cwd: ctxWorktree, spec: { cloneRoot, repo: repo.name, copyPath, defaultBranch: repo.default_branch, featureBranch: started.branch,
      specDir: started.spec_dir.replace(/\/$/, ''), recordedRemoteTip: a1.commit } }), 'push_target_refused');
  const mainBefore = (await forge.get(`${R}/branches/${repo.default_branch}`)).commit.id;
  let forgeRefusal = '';
  try {
    helperGit(ctxWorktree, 'push', 'origin', `refs/heads/${started.branch}:refs/heads/${repo.default_branch}`);
  } catch (e) { forgeRefusal = String(e.stderr ?? e.message); }
  assert.match(forgeRefusal, /protected branch|pre-receive hook declined/i, 'the forge refused the push to the protected default branch');
  assert.equal((await forge.get(`${R}/branches/${repo.default_branch}`)).commit.id, mainBefore, 'main did not move');

  // SC-011: someone else pushes to the feature branch; approving again is refused until the author takes the latest
  await specs.reopen({ repo: REPO, number: p.number });
  assert.deepEqual(await stageLabels(p.number), ['status/spec-in-progress']);
  const other = mkdtempSync(join(tmpdir(), 'pdlc-it-other-'));
  try {
    helperGit(other, 'clone', '-q', '--branch', started.branch, originUrlFor(REPO), 'c');
    const c = join(other, 'c');
    helperGit(c, 'commit', '-q', '--allow-empty', '-m', `pdlc-it ${RUN}: another session's commit`);
    helperGit(c, 'push', '-q', 'origin', `HEAD:refs/heads/${started.branch}`);
  } finally { rmSync(other, { recursive: true, force: true }); }
  g = await specs.get({ repo: REPO, number: p.number });
  assert.equal(g.remote.changed, true, 'get_spec sees the branch moved');
  const w2 = await specs.writeFile({ repo: REPO, number: p.number, path: 'spec.md', base_revision: g.revision,
    content: specText({ branch: started.branch, number: p.number, title, sessions: 2 }) });
  await refused(specs.approve({ repo: REPO, number: p.number, base_revision: w2.revision }), 'branch_changed');
  const taken = await specs.takeLatest({ repo: REPO, number: p.number });
  assert.deepEqual(taken.conflicts, []);
  const a2 = await specs.approve({ repo: REPO, number: p.number, base_revision: taken.revision });
  assert.equal((await forge.get(`${R}/branches/${encodeURIComponent(started.branch)}`)).commit.id, a2.commit, 're-approval published on top of the other commit');
  assert.match((await forge.getAll(`${R}/issues/${p.number}/comments`)).items.at(-1).body, /re-approved/);

  // withdraw: back to ready, the branch kept and never reused
  await specs.reopen({ repo: REPO, number: p.number });
  await specs.withdraw({ repo: REPO, number: p.number, to: 'ready' });
  assert.deepEqual(await stageLabels(p.number), ['status/needs-spec']);
  assert.equal((await latestTrailer(p.number)).stage, 'withdrawn');
  assert.ok(await forge.get(`${R}/branches/${encodeURIComponent(started.branch)}`), 'the withdrawn branch is kept');

  // SC-004: never two stage labels at once, at any point above (checked at each step); the issue is still open
  assert.equal((await forge.get(`${R}/issues/${p.number}`)).state, 'open');
});
