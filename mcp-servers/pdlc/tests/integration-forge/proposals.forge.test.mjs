// The live tier (quickstart §2) against `ci-smoke`, through the real modules and real git: no doubles
// anywhere (constitution Test Type Integrity). Every issue it creates is titled
// `Proposal: pdlc-it-<run id>-…` (or `pdlc-it-<run id>-…` for the non-proposal), and the helper, not the
// server, closes them all at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createForgeClient } from '../../src/forge-client.mjs';
import { createRepoAllowlist } from '../../src/repo-allowlist.mjs';
import { createProposals } from '../../src/proposals.mjs';
import { createSetupCheck } from '../../src/setup-check.mjs';
import { createLocalCopy } from '../../src/local-copy.mjs';
import { createGitRunner } from '../../src/git-runner.mjs';
import { Refusal } from '../../src/refusal.mjs';

const REPO = 'ci-smoke';
const RUN = process.env.PDLC_IT_RUN_ID;
const config = Object.freeze({
  forgeUrl: process.env.PDLC_FORGE_URL, apiBase: `${process.env.PDLC_FORGE_URL}/api/v1`,
  owner: process.env.PDLC_FORGE_OWNER, token: process.env.PDLC_FORGE_TOKEN,
});
assert.ok(config.forgeUrl && config.owner && config.token && RUN, 'run through `pnpm nx run pdlc:integration-forge`, which sets the PDLC_* variables');

const forge = createForgeClient({ config });
const allowlist = createRepoAllowlist({ forge, config });
const proposals = createProposals({ forge, allowlist, config });
const setupCheck = createSetupCheck({ forge, allowlist, config });
const R = `/repos/${config.owner}/${REPO}`;
const created = [];

// ── the helper: direct API calls the server itself never makes ─────────────────────────────────
const LABELS = JSON.parse(readFileSync(new URL('../../contract/proposal-labels.json', import.meta.url), 'utf8'));
async function ensureLabels() {
  const { items } = await forge.getAll(`${R}/labels`);
  for (const l of LABELS) if (!items.some((x) => x.name === l.name)) await forge.post(`${R}/labels`, l);
}
const closeOwn = async () => { for (const n of created) await forge.patch(`${R}/issues/${n}`, { state: 'closed' }).catch(() => {}); };

const sections = (name) => ({
  feature_name: `pdlc-it-${RUN}-${name}`, problem: 'A live-forge test proposal.', proposed_value: 'Proves the server.',
  personas: 'The operator.', goals_success: '- [ ] it round-trips', rough_scope: '- create, read, update',
  open_questions: '', out_of_scope: '', priority: 'p3',
});

const refused = async (promise, code) => {
  let e;
  try { await promise; } catch (err) { e = err; }
  assert.ok(e instanceof Refusal, `expected ${code}, got ${e?.stack ?? e}`);
  assert.equal(e.code, code);
};

test.before(ensureLabels);
test.after(closeOwn);

test('check_setup returns ok for ci-smoke', async () => {
  const r = await setupCheck.check({ repo: REPO });
  assert.deepEqual({ ok: r.ok, missing_labels: r.missing_labels, form: r.form }, { ok: true, missing_labels: [], form: 'ok' }, JSON.stringify(r));
});

test('create a draft, refuse a duplicate, read it back', async () => {
  const s = sections('draft');
  const c = await proposals.create({ repo: 'CI-SMOKE', title: `Proposal: ${s.feature_name}`, sections: s, priority: 'p3', status: 'draft' });
  created.push(c.number);
  assert.equal(c.status, 'draft');
  await refused(proposals.create({ repo: REPO, title: `Proposal: ${s.feature_name}`, sections: s, priority: 'p3', status: 'draft' }), 'duplicate_title');
  const g = await proposals.get({ repo: REPO, number: c.number });
  assert.deepEqual(g.sections, s);
  assert.deepEqual(g.warnings, []);
  assert.equal(g.updated_at, c.updated_at);
});

test('update to ready, then stale after an out-of-band edit', async () => {
  const s = sections('ready');
  const c = await proposals.create({ repo: REPO, title: `Proposal: ${s.feature_name}`, sections: s, priority: 'p3', status: 'draft' });
  created.push(c.number);
  const u = await proposals.update({ repo: REPO, number: c.number, expected_updated_at: c.updated_at, status: 'ready' });
  assert.equal(u.status, 'ready');
  assert.deepEqual(u.changed, ['status']);
  // The forge's updated_at has one-second resolution: wait so the out-of-band edit moves it.
  await new Promise((r) => setTimeout(r, 1100));
  await forge.patch(`${R}/issues/${c.number}`, { body: `${(await forge.get(`${R}/issues/${c.number}`)).body}\nedited out of band\n` });
  await refused(proposals.update({ repo: REPO, number: c.number, expected_updated_at: u.updated_at, priority: 'p1' }), 'stale');
});

test('refuse a non-proposal, another owner and an unknown repository', async () => {
  const plain = await forge.post(`${R}/issues`, { title: `pdlc-it-${RUN}-plain`, body: 'not a proposal' });
  created.push(plain.number);
  await refused(proposals.comment({ repo: REPO, number: plain.number, body: 'hi' }), 'not_a_proposal');
  await refused(proposals.get({ repo: `someone-else/${REPO}`, number: plain.number }), 'unknown_repo');
  await refused(proposals.get({ repo: `pdlc-it-${RUN}-no-such-repo`, number: 1 }), 'unknown_repo');
});

test('sync_repo clones ci-smoke with the token in the environment only, then up_to_date', async () => {
  const cloneRoot = mkdtempSync(join(tmpdir(), 'pdlc-it-clones-'));
  try {
    const repo = await allowlist.resolve(REPO);
    const lc = createLocalCopy({
      cloneRoot,
      originUrlFor: (name) => `${config.forgeUrl}/${config.owner}/${name}.git`,
      git: createGitRunner({ token: config.token }),
    });
    assert.equal((await lc.sync(repo)).action, 'cloned');
    assert.equal((await lc.sync(repo)).action, 'up_to_date');
    const st = await lc.status(repo);
    assert.deepEqual({ behind: st.behind, clean: st.clean }, { behind: 0, clean: true });
    const gitConfig = readFileSync(join(cloneRoot, repo.name, '.git', 'config'), 'utf8');
    assert.equal(gitConfig.includes(config.token), false, 'the token is in .git/config');
    assert.doesNotMatch(gitConfig, /extraHeader|Authorization|:\/\/[^/\s]*@/i);
  } finally { rmSync(cloneRoot, { recursive: true, force: true }); }
});
