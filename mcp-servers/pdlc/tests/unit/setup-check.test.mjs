// check_setup (data-model.md Setup check result; research R7; US4-AC1 to US4-AC4, FR-028). It reports;
// it never creates anything, and ok:false is a normal result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSetupCheck, FORM_PATH, FIX_HINT } from '../../src/setup-check.mjs';
import { createForgeClient } from '../../src/forge-client.mjs';
import { createRepoAllowlist } from '../../src/repo-allowlist.mjs';
import { fakeForge } from './helpers/fake-forge.mjs';
import { connect } from './helpers/mcp-client.mjs';
import { config } from './helpers/fixtures.mjs';

const MASTER = readFileSync(new URL('../../contract/proposal.yaml', import.meta.url), 'utf8');
const MASTER_LABELS = JSON.parse(readFileSync(new URL('../../contract/proposal-labels.json', import.meta.url), 'utf8'));
const REQUIRED = MASTER_LABELS.map((l) => l.name).filter((n) => n !== 'status/bot-managed');

function rig({ labels, form, inEffect = true, branch = 'main' }) {
  const forge = fakeForge({ labels });
  forge.state.repos[0].default_branch = branch;
  if (form !== undefined) forge.state.files[`belay:${FORM_PATH}`] = form;
  // Measured 2026-11-25: issue_templates answers file_name as the FULL path in the repository.
  if (inEffect) forge.state.templates.belay = [{ name: 'Backlog item', file_name: '.forgejo/issue_template/backlog-item.yaml' }, { name: 'Proposal', file_name: '.forgejo/issue_template/proposal.yaml' }];
  else forge.state.templates.belay = [{ name: 'Backlog item', file_name: '.forgejo/issue_template/backlog-item.yaml' }];
  const client = createForgeClient({ config, fetch: forge.fetch });
  const allowlist = createRepoAllowlist({ forge: client, config, existsSync: () => false });
  return { forge, allowlist, check: createSetupCheck({ forge: client, allowlist, config }) };
}

test('nothing set up: every required label is missing, the form is missing, ok false, and nothing is created', async () => {
  const r = rig({ labels: ['type/bug'], form: undefined, inEffect: false });
  const res = await r.check.check({ repo: 'belay' });
  assert.deepEqual(res, { repo: 'BELAY', ok: false, default_branch: 'main', missing_labels: REQUIRED, form: 'missing', fix_hint: FIX_HINT });
  assert.deepEqual(r.forge.writes(), []);
});

test('the raw form is read from the default branch, which need not be main', async () => {
  const r = rig({ labels: REQUIRED, form: MASTER, branch: 'trunk' });
  const res = await r.check.check({ repo: 'BELAY' });
  assert.equal(res.default_branch, 'trunk');
  const raw = r.forge.calls.find((c) => c.path.includes('/raw/'));
  assert.equal(raw.query.ref, 'trunk');
});

test('labels only: missing_labels empty, form missing', async () => {
  const r = rig({ labels: REQUIRED, form: undefined, inEffect: false });
  const res = await r.check.check({ repo: 'BELAY' });
  assert.deepEqual(res.missing_labels, []);
  assert.equal(res.form, 'missing');
  assert.equal(res.ok, false);
});

test('status/bot-managed is not required', async () => {
  const r = rig({ labels: REQUIRED, form: MASTER });
  assert.equal((await r.check.check({ repo: 'BELAY' })).ok, true);
});

test('a form file present but not parsed by the forge is not_in_effect', async () => {
  const r = rig({ labels: REQUIRED, form: MASTER, inEffect: false });
  const res = await r.check.check({ repo: 'BELAY' });
  assert.equal(res.form, 'not_in_effect');
  assert.equal(res.ok, false);
});

test('bytes that differ from the master are out_of_step; CRLF-only differences are ok', async () => {
  const drifted = rig({ labels: REQUIRED, form: MASTER.replace('Proposed feature name', 'Feature name') });
  assert.equal((await drifted.check.check({ repo: 'BELAY' })).form, 'out_of_step');
  const crlf = rig({ labels: REQUIRED, form: MASTER.replace(/\n/g, '\r\n') });
  assert.equal((await crlf.check.check({ repo: 'BELAY' })).form, 'ok');
});

test('all set up: ok true, fix_hint null', async () => {
  const r = rig({ labels: [...REQUIRED, 'type/bug'], form: MASTER });
  assert.deepEqual(await r.check.check({ repo: 'BELAY' }), { repo: 'BELAY', ok: true, default_branch: 'main', missing_labels: [], form: 'ok', fix_hint: null });
});

test('over the protocol, ok:false is a normal result, not isError', async () => {
  const r = rig({ labels: ['type/bug'], form: undefined, inEffect: false });
  const c = await connect({ allowlist: r.allowlist, setupCheck: r.check });
  try {
    const res = await c.call('check_setup', { repo: 'BELAY' });
    assert.notEqual(res.isError, true, JSON.stringify(res.payload));
    assert.equal(res.payload.ok, false);
    assert.deepEqual(res.structuredContent, res.payload);
  } finally { await c.close(); }
});

test('an unknown repository is refused before any label or file request', async () => {
  const r = rig({ labels: REQUIRED, form: MASTER });
  await assert.rejects(r.check.check({ repo: 'nope' }), (e) => e.code === 'unknown_repo');
  assert.ok(r.forge.calls.every((c) => c.path === '/repos/search'));
});

test('a proposal form elsewhere (another folder\'s proposal.yaml) does not count as in effect', async () => {
  const r = rig({ labels: REQUIRED, form: MASTER, inEffect: false });
  r.forge.state.templates.belay.push({ name: 'Proposal', file_name: '.gitea/issue_template/proposal.yaml' });
  assert.equal((await r.check.check({ repo: 'BELAY' })).form, 'not_in_effect');
});
