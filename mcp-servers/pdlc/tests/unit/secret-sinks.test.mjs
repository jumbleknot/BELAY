// The secret-sink sweep (FR-018, SC-008; US3-AC5 credential half). Every tool runs, including its
// failing paths, with a canary token. The canary may appear ONLY in the Authorization header and the git
// child's GIT_CONFIG_VALUE_* environment: never in a result, a stderr line, a git argv or a fetch URL.
// Proposal body text never appears in a git argv either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { connect } from './helpers/mcp-client.mjs';
import { fakeForge } from './helpers/fake-forge.mjs';
import { fakeExecFile } from './helpers/fake-exec.mjs';
import { CANARY, config } from './helpers/fixtures.mjs';
import { createForgeClient } from '../../src/forge-client.mjs';
import { createRepoAllowlist } from '../../src/repo-allowlist.mjs';
import { createProposals } from '../../src/proposals.mjs';
import { createLocalCopy } from '../../src/local-copy.mjs';
import { createGitRunner } from '../../src/git-runner.mjs';
import { createSetupCheck } from '../../src/setup-check.mjs';
import { renderBody } from '../../src/proposal-body.mjs';
import { Refusal } from '../../src/refusal.mjs';

const BODY_MARKER = 'UNIQUE-BODY-MARKER-7f3a';
const sections = { feature_name: 'Sinks', problem: BODY_MARKER, proposed_value: 'v', personas: 'c', goals_success: 'g', rough_scope: 'r', open_questions: '', out_of_scope: '', priority: 'p2' };
const PATH = join('/clones', 'BELAY');

function rig({ gitThrows = false } = {}) {
  const forge = fakeForge();
  const client = createForgeClient({ config, fetch: forge.fetch });
  const allowlist = createRepoAllowlist({ forge: client, config, existsSync: () => false });
  const proposals = createProposals({ forge: client, allowlist, config });
  const x = fakeExecFile((args) => {
    if (gitThrows) throw new Error(`spawn git EACCES with GIT_CONFIG_VALUE_0=Authorization: token ${CANARY}`);
    if (args[0] === 'rev-parse') return { stdout: 'abc\n' };
    if (args[0] === 'fetch') return { code: 128, stderr: `fatal: Authentication failed (Authorization: token ${CANARY})` };
    return { stdout: '' };
  });
  const git = createGitRunner({ token: CANARY, execFile: x.execFile, baseEnv: { PATH: '/usr/bin' } });
  let exists = false;
  const localCopy = createLocalCopy({ cloneRoot: '/clones', originUrlFor: (n) => `https://forge.example/operator/${n}.git`, git, existsSync: () => exists });
  const setupCheck = createSetupCheck({ forge: client, allowlist, config });
  return { forge, x, deps: { allowlist, proposals, localCopy, setupCheck }, setExists: (v) => { exists = v; } };
}

function assertNoCanaryOutsideTheTwoSinks(r, c, results) {
  for (const res of results) {
    assert.doesNotMatch(JSON.stringify(res.content), /canary-/, 'tool result text');
    assert.doesNotMatch(JSON.stringify(res.structuredContent ?? null), /canary-/, 'structuredContent');
  }
  assert.doesNotMatch(c.stderr.join(''), /canary-/, 'stderr');
  for (const call of r.forge.calls) {
    assert.doesNotMatch(call.url, /canary-/, 'fetch URL');
    for (const [k, v] of Object.entries(call.headers)) if (k !== 'Authorization') assert.doesNotMatch(String(v), /canary-/, `header ${k}`);
    assert.equal(call.headers.Authorization, `token ${CANARY}`);
  }
  for (const call of r.x.calls) {
    assert.doesNotMatch(call.args.join(' '), /canary-/, 'git argv');
    assert.doesNotMatch(call.args.join(' '), new RegExp(BODY_MARKER), 'proposal body in git argv');
    for (const [k, v] of Object.entries(call.options.env)) {
      if (!/^GIT_CONFIG_VALUE_\d+$/.test(k)) assert.doesNotMatch(String(v), /canary-/, `git env ${k}`);
    }
  }
}

test('every tool, on its success paths, leaks the token nowhere but the two sinks', async () => {
  const r = rig();
  const c = await connect(r.deps);
  try {
    const results = [];
    const call = async (t, a) => { const res = await c.call(t, a); results.push(res); return res; };
    await call('list_repos');
    await call('repo_status', { repo: 'BELAY' });
    await call('sync_repo', { repo: 'BELAY' });
    const created = (await call('create_proposal', { repo: 'BELAY', title: 'Proposal: Sinks', sections, priority: 'p2', status: 'draft' })).payload;
    await call('list_proposals', { repo: 'BELAY', status: 'all' });
    await call('get_proposal', { repo: 'BELAY', number: created.number });
    const commented = (await call('add_comment', { repo: 'BELAY', number: created.number, body: BODY_MARKER })).payload;
    await call('update_proposal', { repo: 'BELAY', number: created.number, expected_updated_at: commented.updated_at, status: 'ready' });
    const setup = await call('check_setup', { repo: 'BELAY' });
    assert.notEqual(setup.isError, true, JSON.stringify(setup.payload));
    assert.ok(r.x.calls.length > 0, 'git ran');
    assertNoCanaryOutsideTheTwoSinks(r, c, results);
  } finally { await c.close(); }
});

test('the failing paths (401, 403, 500, network, a git failure, an unexpected throw, a refusal) leak nothing', async () => {
  const r = rig();
  const c = await connect(r.deps);
  try {
    const results = [];
    const call = async (t, a) => { const res = await c.call(t, a); results.push(res); return res; };
    const i = r.forge.addIssue('BELAY', { title: 'Proposal: Sinks', body: renderBody(sections), labels: ['type/proposal', 'status/proposal-draft', 'priority/p2'] });
    await call('list_repos');
    for (const failure of [401, 403, 500, 'network']) {
      r.forge.state.failNext = failure;
      const res = await call('get_proposal', { repo: 'BELAY', number: i.number });
      assert.equal(res.isError, true, String(failure));
    }
    await call('update_proposal', { repo: 'BELAY', number: i.number, expected_updated_at: 'stale', status: 'ready' });
    r.setExists(true);
    const gitFail = await call('repo_status', { repo: 'BELAY' });
    assert.equal(gitFail.isError, true);
    assertNoCanaryOutsideTheTwoSinks(r, c, results);
  } finally { await c.close(); }
});

test('an unexpected error carrying the token is redacted in the log line and absent from the result', async () => {
  const r = rig({ gitThrows: true });
  const c = await connect(r.deps);
  try {
    const res = await c.call('sync_repo', { repo: 'BELAY' });
    assert.equal(res.isError, true);
    assert.ok(c.stderr.some((l) => /unexpected failure/.test(l)), 'the failure was logged');
    assertNoCanaryOutsideTheTwoSinks(r, c, [res]);
  } finally { await c.close(); }
});

test('below the server: a forge failure\'s Refusal itself carries no token or header', async () => {
  for (const failure of [401, 403, 404, 422, 500, 'network']) {
    const forge = fakeForge();
    const client = createForgeClient({ config, fetch: forge.fetch });
    forge.state.failNext = failure;
    let e;
    try { await client.get('/repos/operator/BELAY/issues/1', { capability: 'read issues' }); } catch (err) { e = err; }
    assert.ok(e instanceof Refusal, String(failure));
    assert.doesNotMatch(`${e.message} ${JSON.stringify(e.toJSON())}`, /canary-|Authorization/, String(failure));
  }
});
