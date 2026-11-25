// The tools over the real protocol (InMemoryTransport), with the fake forge and a fake git behind the
// real modules. Output shapes are contracts/tools.md's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { connect } from './helpers/mcp-client.mjs';
import { world } from './helpers/world.mjs';
import { fakeGit } from './helpers/fake-git.mjs';
import { createLocalCopy } from '../../src/local-copy.mjs';
import { renderBody } from '../../src/proposal-body.mjs';

const sections = {
  feature_name: 'Import export spreadsheet', problem: 'p', proposed_value: 'v', personas: 'c',
  goals_success: 'g', rough_scope: 'r', open_questions: '', out_of_scope: '', priority: 'p2',
};
const PATH = join('/clones', 'BELAY');

async function harness({ exists = false, script = {} } = {}) {
  const w = world({ repos: ['BELAY', 'mcm'] });
  const g = fakeGit({
    [`clone --filter=blob:none --single-branch --branch main https://forge.example/operator/BELAY.git ${PATH}`]: {},
    'rev-parse --show-toplevel': { stdout: `${PATH}\n` },
    'config --get remote.origin.url': { stdout: 'https://forge.example/operator/BELAY.git\n' },
    'fetch origin main': {},
    'symbolic-ref --short HEAD': { stdout: 'main\n' },
    'status --porcelain=v1 --untracked-files=normal': { stdout: '' },
    'rev-list --count HEAD..origin/main': { stdout: '0\n' },
    'rev-list --count origin/main..HEAD': { stdout: '0\n' },
    'rev-parse HEAD': { stdout: 'abc123\n' },
    ...script,
  });
  const localCopy = createLocalCopy({ cloneRoot: '/clones', originUrlFor: (n) => `https://forge.example/operator/${n}.git`, git: g.git, existsSync: () => exists });
  const c = await connect({ allowlist: w.allowlist, proposals: w.proposals, localCopy });
  return { w, g, c };
}

test('US1 list_repos returns the owner\'s repositories with the contract shape', async () => {
  const { c } = await harness();
  try {
    const r = await c.call('list_repos');
    assert.notEqual(r.isError, true, JSON.stringify(r.payload));
    assert.deepEqual(r.structuredContent, r.payload);
    assert.deepEqual(r.payload, { repos: [
      { name: 'BELAY', description: 'BELAY repo', default_branch: 'main', has_clone: false },
      { name: 'mcm', description: 'mcm repo', default_branch: 'main', has_clone: false },
    ], truncated: false });
  } finally { await c.close(); }
});

test('US1 repo_status of an absent copy, matched case-insensitively and returned canonically', async () => {
  const { c } = await harness();
  try {
    const r = await c.call('repo_status', { repo: 'belay' });
    assert.deepEqual(r.payload, { repo: 'BELAY', path: PATH, exists: false, branch: null, default_branch: null, clean: null, behind: null, ahead: null });
  } finally { await c.close(); }
});

test('US1 sync_repo clones an absent copy', async () => {
  const { c, g } = await harness();
  try {
    const r = await c.call('sync_repo', { repo: 'BELAY' });
    assert.notEqual(r.isError, true, JSON.stringify(r.payload));
    assert.deepEqual(r.payload, { repo: 'BELAY', path: PATH, action: 'cloned', from: null, to: 'abc123', default_branch: 'main' });
    assert.equal(g.calls[0].args[0], 'clone');
  } finally { await c.close(); }
});

test('US1 repo_status of an existing copy reports branch, clean, behind and ahead', async () => {
  const { c } = await harness({ exists: true, script: { 'rev-list --count HEAD..origin/main': { stdout: '4\n' } } });
  try {
    const r = await c.call('repo_status', { repo: 'BELAY' });
    assert.deepEqual(r.payload, { repo: 'BELAY', path: PATH, exists: true, branch: 'main', default_branch: 'main', clean: true, behind: 4, ahead: 0 });
  } finally { await c.close(); }
});

test('US1 create_proposal files a draft and returns {number, title, status, priority, url, updated_at}', async () => {
  const { c, w } = await harness();
  try {
    const r = await c.call('create_proposal', { repo: 'belay', title: 'Proposal: Import export spreadsheet', sections, priority: 'p2', status: 'draft' });
    assert.notEqual(r.isError, true, JSON.stringify(r.payload));
    assert.deepEqual(Object.keys(r.payload).sort(), ['number', 'priority', 'status', 'title', 'updated_at', 'url']);
    assert.equal(r.payload.status, 'draft');
    assert.equal(r.payload.updated_at, w.forge.issue('BELAY', r.payload.number).updated_at);
  } finally { await c.close(); }
});

test('US1 create_proposal refuses a duplicate title, naming the existing issue', async () => {
  const { c, w } = await harness();
  try {
    w.forge.addIssue('BELAY', { title: 'Proposal: Import export spreadsheet', labels: ['type/proposal', 'status/proposal-draft', 'priority/p2'] });
    const r = await c.call('create_proposal', { repo: 'BELAY', title: 'Proposal: Import export spreadsheet', sections, priority: 'p2', status: 'draft' });
    assert.equal(r.isError, true);
    assert.equal(r.payload.code, 'duplicate_title');
    assert.equal(r.payload.number, 1);
  } finally { await c.close(); }
});

test('US1 get_proposal reads a web-form proposal into the same sections', async () => {
  const { c, w } = await harness();
  try {
    const i = w.forge.addIssue('BELAY', { title: 'Proposal: Import export spreadsheet', body: renderBody(sections).replace(/\n/g, '\r\n'), labels: ['type/proposal', 'status/proposal-draft', 'priority/p2'] });
    const r = await c.call('get_proposal', { repo: 'BELAY', number: i.number });
    assert.notEqual(r.isError, true, JSON.stringify(r.payload));
    assert.deepEqual(r.payload.sections, sections);
    assert.deepEqual(Object.keys(r.payload).sort(), ['comments', 'labels', 'number', 'priority', 'sections', 'state', 'status', 'title', 'updated_at', 'url', 'warnings']);
  } finally { await c.close(); }
});
