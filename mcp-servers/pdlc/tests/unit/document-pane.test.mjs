// The right-hand pane (feature 016, US9; research R9 as measured in T003; FR-035 to FR-037). An MCP App page served as
// ui://pdlc/document-pane.html, opened by show_document, that reads and writes through two app-only tools:
// read_pane_document (polled every 2 s) and save_pane_edit. The model's calls and the page's calls reach DIFFERENT
// server processes (measured), so every revision, draft and "what the model last read" lives in files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { specWorld } from './helpers/spec-world.mjs';

const BRANCH = '017-pane-probe';
const PAGE = 'ui://pdlc/document-pane.html';
const ok = (r) => assert.notEqual(r.isError, true, JSON.stringify(r.payload));
const refused = (r, code) => { assert.equal(r.isError, true, JSON.stringify(r.payload)); assert.equal(r.payload.code, code, JSON.stringify(r.payload)); };
async function started() {
  const w = await specWorld();
  const p = w.ready();
  const s = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' });
  ok(s);
  return { w, p, revision: s.payload.revision };
}

test('tools/list: show_document opens the page (_meta.ui.resourceUri); save_pane_edit and read_pane_document are app-only', async () => {
  const w = await specWorld();
  try {
    const { tools } = await w.c.client.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.equal(by.show_document._meta.ui.resourceUri, PAGE);
    for (const n of ['save_pane_edit', 'read_pane_document']) assert.deepEqual(by[n]._meta.ui.visibility, ['app'], n);
    assert.equal(by.get_spec._meta, undefined, 'other tools carry no UI metadata');
  } finally { await w.close(); }
});

test('resources: the page is listed and read as text/html;profile=mcp-app, from ui/document-pane.html', async () => {
  const w = await specWorld();
  try {
    const { resources } = await w.c.client.listResources();
    assert.deepEqual(resources.map((r) => [r.uri, r.mimeType]), [[PAGE, 'text/html;profile=mcp-app']]);
    const { contents } = await w.c.client.readResource({ uri: PAGE });
    assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.equal(contents[0].text, readFileSync(new URL('../../ui/document-pane.html', import.meta.url), 'utf8'));
  } finally { await w.close(); }
});

test('US9-AC1 show_document on a spec in progress returns the files, the revision and read_only false; a pane save writes through the path guard', async () => {
  const { w, p, revision } = await started();
  try {
    const r = await w.c.call('show_document', { repo: 'BELAY', kind: 'spec', number: p.number });
    ok(r);
    assert.deepEqual([r.payload.kind, r.payload.ref, r.payload.revision, r.payload.read_only], ['spec', p.number, revision, false]);
    assert.deepEqual(r.payload.document.files.map((f) => f.path), ['spec.md']);
    const s = await w.c.call('save_pane_edit', { repo: 'BELAY', kind: 'spec', ref: String(p.number), base_revision: revision, path: 'spec.md', content: '# typed in the pane\n' });
    ok(s);
    assert.notEqual(s.payload.revision, revision);
    assert.equal(readFileSync(join(w.worktreePath, 'specs', BRANCH, 'spec.md'), 'utf8'), '# typed in the pane\n');
    refused(await w.c.call('save_pane_edit', { repo: 'BELAY', kind: 'spec', ref: String(p.number), base_revision: s.payload.revision, path: '../x.md', content: 'x' }), 'path_outside_feature');
    refused(await w.c.call('save_pane_edit', { repo: 'BELAY', kind: 'spec', ref: String(p.number), base_revision: revision, path: 'spec.md', content: 'stale' }), 'pane_edit_pending');
  } finally { await w.close(); }
});

test('US9-AC3 FR-036 two server processes, one clone root: a pane save in one is what the model reads in the other, with pane_changes, and a stale model write is refused', async () => {
  const { w, p, revision } = await started();
  const other = await w.second();
  try {
    const s = await other.call('save_pane_edit', { repo: 'BELAY', kind: 'spec', ref: String(p.number), base_revision: revision, path: 'spec.md', content: '# Feature Specification: Pane probe\n\n- typed in the pane\n' });
    ok(s);
    const polled = await w.c.call('read_pane_document', { repo: 'BELAY', kind: 'spec', ref: String(p.number) });
    assert.equal(polled.payload.revision, s.payload.revision);
    refused(await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: '# chat edit\n', base_revision: revision }), 'pane_edit_pending');
    const g = await w.c.call('get_spec', { repo: 'BELAY', number: p.number });
    assert.equal(g.payload.revision, s.payload.revision);
    assert.deepEqual(g.payload.pane_changes.map((c) => c.path), ['spec.md']);
    assert.match(g.payload.pane_changes[0].diff, /^\+ - typed in the pane$/m);
    // read once, so the next read reports nothing new
    assert.deepEqual((await w.c.call('get_spec', { repo: 'BELAY', number: p.number })).payload.pane_changes, []);
  } finally { await other.close(); await w.close(); }
});

test('US9-AC4 FR-037 a spec at in-engineering opens read-only, and a pane save is refused document_locked whatever the page sends', async () => {
  const { w, p, revision } = await started();
  try {
    const issue = w.forge.issue('BELAY', p.number);
    const label = (name) => w.forge.state.labels.belay.find((l) => l.name === name);
    issue.labels = issue.labels.filter((l) => l.name !== 'status/spec-in-progress').concat([{ ...label('status/in-engineering') }]);
    const r = await w.c.call('show_document', { repo: 'BELAY', kind: 'spec', number: p.number });
    assert.equal(r.payload.read_only, true);
    refused(await w.c.call('save_pane_edit', { repo: 'BELAY', kind: 'spec', ref: String(p.number), base_revision: revision, path: 'spec.md', content: 'x' }), 'document_locked');
  } finally { await w.close(); }
});

test('US9 proposal: a new proposal\'s draft is created and refreshed by show_document from the chat, edited in the pane, and saved by create_proposal with its revision', async () => {
  const w = await specWorld();
  try {
    const sections = { feature_name: 'Pane probe', problem: 'p', proposed_value: 'v', personas: 'c', goals_success: 'g', rough_scope: 'r', open_questions: '', out_of_scope: '', priority: 'p2' };
    const r = await w.c.call('show_document', { repo: 'BELAY', kind: 'proposal', sections, priority: 'p2' });
    ok(r);
    assert.equal(r.payload.draft_id, 'draft01');
    assert.equal(r.payload.read_only, false);
    const draftFile = join(w.cloneRoot, '.pdlc-drafts', 'BELAY', 'draft01.json');
    assert.ok(existsSync(draftFile));
    // the author types in the pane
    const s = await w.c.call('save_pane_edit', { repo: 'BELAY', kind: 'proposal', ref: 'draft01', base_revision: r.payload.revision, sections: { ...sections, problem: 'typed in the pane' } });
    ok(s);
    // the model, holding the old revision, cannot overwrite it from the chat
    refused(await w.c.call('show_document', { repo: 'BELAY', kind: 'proposal', draft_id: 'draft01', base_revision: r.payload.revision, sections }), 'pane_edit_pending');
    const d = await w.c.call('get_proposal_draft', { repo: 'BELAY', draft_id: 'draft01' });
    assert.equal(d.payload.sections.problem, 'typed in the pane');
    assert.deepEqual(d.payload.pane_changes.map((c) => c.section), ['problem']);
    refused(await w.c.call('create_proposal', { repo: 'BELAY', title: 'Proposal: Pane probe', sections, priority: 'p2', status: 'draft', draft_id: 'draft01', draft_revision: r.payload.revision }), 'pane_edit_pending');
    const c = await w.c.call('create_proposal', { repo: 'BELAY', title: 'Proposal: Pane probe', sections: d.payload.sections, priority: 'p2', status: 'draft', draft_id: 'draft01', draft_revision: d.payload.revision });
    ok(c);
    assert.ok(!existsSync(draftFile), 'the draft is deleted once saved');
  } finally { await w.close(); }
});

test('US9 proposal: an existing proposal opens from the forge; a pane edit makes update_proposal without the draft\'s revision refuse; a closed one is read-only', async () => {
  const w = await specWorld();
  try {
    const p = w.ready();
    const r = await w.c.call('show_document', { repo: 'BELAY', kind: 'proposal', number: p.number });
    ok(r);
    assert.equal(r.payload.document.sections.problem, 'A problem.');
    const s = await w.c.call('save_pane_edit', { repo: 'BELAY', kind: 'proposal', ref: String(p.number), base_revision: r.payload.revision, sections: { ...r.payload.document.sections, problem: 'typed in the pane' } });
    ok(s);
    const issue = await w.c.call('get_proposal', { repo: 'BELAY', number: p.number });
    refused(await w.c.call('update_proposal', { repo: 'BELAY', number: p.number, expected_updated_at: issue.payload.updated_at, sections: { problem: 'chat edit' } }), 'pane_edit_pending');
    const u = await w.c.call('update_proposal', { repo: 'BELAY', number: p.number, expected_updated_at: issue.payload.updated_at, sections: { problem: 'typed in the pane' }, draft_revision: s.payload.revision });
    ok(u);
    assert.ok(!existsSync(join(w.cloneRoot, '.pdlc-drafts', 'BELAY', `${p.number}.json`)));
    // R16: an old skill that sends no draft_revision, with no draft present, still works
    const again = await w.c.call('get_proposal', { repo: 'BELAY', number: p.number });
    ok(await w.c.call('update_proposal', { repo: 'BELAY', number: p.number, expected_updated_at: again.payload.updated_at, sections: { open_questions: 'none' } }));
    const closed = w.ready({ title: 'Proposal: Old', state: 'closed' });
    const rc = await w.c.call('show_document', { repo: 'BELAY', kind: 'proposal', number: closed.number });
    assert.equal(rc.payload.read_only, true);
    refused(await w.c.call('save_pane_edit', { repo: 'BELAY', kind: 'proposal', ref: String(closed.number), base_revision: rc.payload.revision, sections: rc.payload.document.sections }), 'document_locked');
  } finally { await w.close(); }
});

test('show_document refuses a spec kind without a number, and a kind other than proposal or spec is invalid_input', async () => {
  const w = await specWorld();
  try {
    refused(await w.c.call('show_document', { repo: 'BELAY', kind: 'spec' }), 'invalid_input');
    refused(await w.c.call('show_document', { repo: 'BELAY', kind: 'plan', number: 1 }), 'invalid_input');
  } finally { await w.close(); }
});
