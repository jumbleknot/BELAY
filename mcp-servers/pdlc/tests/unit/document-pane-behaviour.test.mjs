// The pane page's behaviour, run (feature 016, US9; T082 findings). The page's own script runs in node:vm against a
// minimal fake DOM and a fake Claude Desktop host that answers exactly the JSON-RPC T003 measured. There is no DOM
// dependency in the repository, so the fake implements only what the page touches. The static checks in
// document-pane-page.test.mjs could not see that a spec's files were stacked; these do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../../ui/document-pane.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class Txt {
  constructor(v) { Object.assign(this, { nodeType: 3, nodeName: '#text', nodeValue: v, parent: null, children: [], childNodes: [] }); }
  get textContent() { return this.nodeValue; }
  *walk() {}
}
class El {
  constructor(tag) { Object.assign(this, { tag, nodeType: 1, nodeName: tag.toUpperCase(), children: [], attrs: {}, dataset: {}, listeners: {}, hidden: false, value: '', style: {}, parent: null, _text: '' }); }
  get childNodes() { return this.children; }
  append(...kids) { for (const k of kids) { const n = typeof k === 'string' ? new Txt(k) : k; n.parent = this; this.children.push(n); } }
  set textContent(t) { this.children = []; this._text = ''; if (t !== '') this.append(new Txt(t)); this._text = t; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  set contentEditable(v) { this.attrs.contenteditable = String(v); }
  get contentEditable() { return this.attrs.contenteditable ?? 'inherit'; }
  get className() { return this.attrs.class ?? ''; }
  set className(v) { this.attrs.class = v; }
  scrollIntoView() {}
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
  click() { for (const f of this.listeners.click ?? []) f({ preventDefault() {} }); }
  focus() {}
  setSelectionRange() {}
  *walk() { for (const c of this.children) { if (c.nodeType === 1) { yield c; yield* c.walk(); } } }
  visible() { for (let e = this; e; e = e.parent) if (e.hidden) return false; return true; }
  querySelectorAll(sel) {
    const [, tag, attr] = sel.match(/^(\w+)?(?:\[data-([\w-]+)\])?$/);
    return [...this.walk()].filter((e) => (!tag || e.tag === tag) && (!attr || e.dataset[attr] !== undefined));
  }
}

/** A page in a fake host. `docs` answers read_pane_document by `<kind>:<ref>`. */
async function page({ ignoreBeside = 0 } = {}) {
  const ids = Object.fromEntries(['title', 'status', 'save', 'beside', 'notice', 'editors', 'kept'].map((id) => [id, new El('div')]));
  ids.beside.hidden = true;
  const root = new El('body');
  root.append(...Object.values(ids));
  const document = {
    getElementById: (id) => ids[id] ?? [...root.walk()].find((e) => e.id === id),
    createElement: (t) => new El(t),
    createTextNode: (v) => new Txt(v),
    querySelectorAll: (s) => root.querySelectorAll(s),
  };
  const host = { docs: {}, mode: 'inline', calls: [], listener: null, poll: null };
  const reply = (data) => setTimeout(() => host.listener({ data }), 0);
  const window = {
    addEventListener: (ev, fn) => { if (ev === 'message') host.listener = fn; },
    parent: {
      postMessage(m) {
        if (m.id === undefined) return;
        if (m.method === 'ui/initialize') return reply({ jsonrpc: '2.0', id: m.id, result: { hostContext: { availableDisplayModes: ['inline', 'fullscreen'], displayMode: host.mode } } });
        if (m.method === 'ui/request-display-mode') {
          host.besideRequests = (host.besideRequests ?? 0) + 1;
          if (host.besideRequests > ignoreBeside) host.mode = m.params.mode;
          return reply({ jsonrpc: '2.0', id: m.id, result: { mode: host.mode } });
        }
        if (m.method === 'tools/call') {
          host.calls.push(`${m.params.name}:${m.params.arguments.kind}:${m.params.arguments.ref}`);
          const d = host.docs[`${m.params.arguments.kind}:${m.params.arguments.ref}`];
          return reply({ jsonrpc: '2.0', id: m.id, result: d ? { structuredContent: structuredClone(d) } : { isError: true, structuredContent: { code: 'not_found', reason: 'none' } } });
        }
      },
    },
  };
  const ctx = { window, document, setTimeout, clearTimeout, setInterval: (fn) => { host.poll = fn; return 0; }, Promise, Error, JSON, Map, Set, String, Boolean, Number, Object, Array, RegExp, Math };
  runInNewContext(script, ctx);
  await settle();
  const tabs = () => ids.editors.querySelectorAll('button').filter((b) => b.attrs.role === 'tab');
  return {
    host, ids, ctx,
    tabs: () => tabs().map((t) => t.textContent),
    shown: () => ids.editors.querySelectorAll('div').filter((d) => d.attrs.role === 'tabpanel' && d.visible()).map((d) => d.dataset.tab),
    choose: (text) => tabs().find((t) => t.textContent === text).click(),
    showDocument: async (payload) => { host.listener({ data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: payload } } }); await settle(); },
    poll: async () => { await host.poll(); await settle(); },
  };
}
// The fake host answers on zero-delay timers, so draining timer rounds settles the page whatever the machine's load
// (a wall-clock wait flaked under coverage).
const settle = async () => { for (let i = 0; i < 50; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const proposal = (ref, hasSpec, revision = 'p1') => ({ repo: 'ci-smoke', kind: 'proposal', ref, revision, read_only: false, has_spec: hasSpec, document: { sections: { feature_name: 'Smoke test summary', problem: 'x' }, priority: 'p3' } });
const spec = (ref, revision = 's1') => ({ repo: 'ci-smoke', kind: 'spec', ref, revision, read_only: true, document: { files: [{ path: 'checklists/requirements.md', content: '# Checklist\n' }, { path: 'spec.md', content: '# Spec\n\n## User Scenarios\n' }] } });
const ALL = ['Proposal #39', 'spec.md', 'checklists/requirements.md'];

test('it asks to move beside the chat on load, and offers a button only while it is shown inline', async () => {
  const p = await page();
  assert.equal(p.host.mode, 'fullscreen');
  assert.equal(p.ids.beside.hidden, true);
  p.host.listener({ data: { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'inline' } } });
  assert.equal(p.ids.beside.hidden, false, 'shown inline: the button appears');
  p.ids.beside.click();
  await settle();
  assert.equal(p.host.mode, 'fullscreen');
  assert.equal(p.ids.beside.hidden, true);
});

test('a proposal with a spec opens as tabs, proposal chosen, one document shown; the chosen tab survives the 2 s refresh', async () => {
  const p = await page();
  p.host.docs = { 'proposal:39': proposal(39, true), 'spec:39': spec(39) };
  await p.showDocument(proposal(39, true));
  assert.deepEqual(p.tabs(), ALL);
  assert.deepEqual(p.shown(), ['proposal']);
  assert.equal(p.ids.title.textContent, 'Proposal #39: Smoke test summary');
  p.choose('spec.md');
  assert.deepEqual(p.shown(), ['spec.md']);
  p.host.docs['spec:39'] = spec(39, 's2');
  await p.poll();
  assert.deepEqual(p.shown(), ['spec.md']);
});

test('a spec opens with its proposal beside it, spec.md chosen', async () => {
  const p = await page();
  p.host.docs = { 'proposal:39': proposal(39, true), 'spec:39': spec(39) };
  await p.showDocument(spec(39));
  assert.deepEqual(p.tabs(), ALL);
  assert.deepEqual(p.shown(), ['spec.md']);
});

test('only what exists has a tab: a proposal without a spec, or a new draft, has one; the spec appears, chosen, once it is started', async () => {
  const p = await page();
  p.host.docs = { 'proposal:40': proposal(40, false) };
  await p.showDocument(proposal(40, false));
  assert.deepEqual(p.tabs(), ['Proposal #40']);
  assert.ok(!p.host.calls.some((c) => c.startsWith('read_pane_document:spec')), 'no spec read for a proposal without one');
  p.host.docs = { 'proposal:40': proposal(40, true, 'p2'), 'spec:40': spec(40) };
  await p.poll();
  assert.deepEqual(p.tabs(), ['Proposal #40', 'spec.md', 'checklists/requirements.md']);
  assert.deepEqual(p.shown(), ['spec.md']);
  await p.showDocument({ ...proposal('d1', false), ref: 'd1' });
  assert.deepEqual(p.tabs(), ['Proposal']);
});

test('a pane edit in a hidden tab is still saved, and the refresh never overwrites unsaved typing', async () => {
  const p = await page();
  const editable = { ...spec(39), read_only: false };
  p.host.docs = { 'proposal:39': proposal(39, true), 'spec:39': editable };
  await p.showDocument(proposal(39, true));
  const area = p.ids.editors.querySelectorAll('textarea[data-path]').find((a) => a.dataset.path === 'spec.md');
  area.value = '# Spec\n\ntyped\n';
  for (const f of area.listeners.input) f();
  p.host.docs['spec:39'] = { ...editable, revision: 's9', document: { files: [{ path: 'spec.md', content: 'from the chat' }] } };
  await p.poll();
  assert.equal(area.value, '# Spec\n\ntyped\n', 'unsaved typing left alone');
  p.ids.save.click();
  await settle();
  assert.ok(p.host.calls.includes('save_pane_edit:spec:39'), p.host.calls.join(' '));
});

// ── Preview and Markdown (FR-036a, T084) ──────────────────────────────────────────────────────────────────────────
const SPEC_MD = readFileSync(new URL('../../../../specs/016-pdlc-spec-intake/spec.md', import.meta.url), 'utf8');
const editableSpec = (content) => ({ repo: 'ci-smoke', kind: 'spec', ref: 39, revision: 's1', read_only: false,
  document: { files: [{ path: 'spec.md', content }, { path: 'checklists/requirements.md', content: '# Checklist\n\n- [ ] One\n- [x] Two\n' }] } });
const panel = (p, tab) => p.ids.editors.querySelectorAll('div').find((d) => d.attrs.role === 'tabpanel' && d.dataset.tab === tab);
const areaOf = (p, path) => p.ids.editors.querySelectorAll('textarea[data-path]').find((a) => a.dataset.path === path);
const blocksOf = (p, tab) => panel(p, tab).querySelectorAll('div').filter((d) => d.dataset.block !== undefined);
const fire = (el, ev = 'input') => { for (const f of el.listeners[ev] ?? []) f({ preventDefault() {} }); };

test('the block model: an unedited round trip of a real spec is byte-identical', async () => {
  const p = await page();
  const model = p.ctx.parseBlocks(SPEC_MD);
  assert.ok(model.blocks.length > 50, `parsed ${model.blocks.length} blocks`);
  assert.equal(p.ctx.rebuild(model, new Map()), SPEC_MD);
  const kinds = new Set(model.blocks.map((b) => b.kind));
  for (const k of ['heading', 'para', 'list', 'table']) assert.ok(kinds.has(k), `found a ${k} block`);
});

test('render then serialize gives back the Markdown for the shapes a spec uses', async () => {
  const p = await page();
  for (const md of [
    '## User Scenarios & Testing *(mandatory)*',
    '**Independent Test**: After more than 30 runs, see `the summary` and [the runbook](docs/x.md).',
    'Line one\nline two',
    '- **FR-001**: Every run MUST produce a summary.\n- **FR-002**: Visible without the log.',
    '1. **Given** a run, **When** it fails, **Then** it says so.\n2. Second.',
    '- Parent\n  - Child one\n  - Child two\n- Next',
    '- [ ] Open item\n- [x] Done item',
    '> A quoted line',
  ]) {
    const [block] = p.ctx.parseBlocks(md).blocks;
    assert.equal(p.ctx.mdBlocks(p.ctx.renderBlock(block, true)), md, md);
  }
});

test('what the toolbar produces in the browser serializes to Markdown: headings, bold, italics, bullets', async () => {
  const p = await page();
  const d = p.ctx.document;
  const box = d.createElement('div');
  const h = d.createElement('h2'); h.append('Title');
  const para = d.createElement('div'); const b = d.createElement('b'); b.append('bold '); const i = d.createElement('i'); i.append('it');
  para.append('a ', b, i);
  const ul = d.createElement('ul'); for (const t of ['x', 'y']) { const li = d.createElement('li'); li.append(t); ul.append(li); }
  box.append(h, para, ul);
  assert.equal(p.ctx.mdBlocks(box), '## Title\n\na **bold** *it*\n\n- x\n- y');
});

test('a spec file opens in Preview; the Markdown switch shows the source; the choice survives the refresh', async () => {
  const p = await page();
  p.host.docs = { 'proposal:39': proposal(39, true), 'spec:39': editableSpec('# Spec\n\nText.\n') };
  await p.showDocument(editableSpec('# Spec\n\nText.\n'));
  const pnl = panel(p, 'spec.md');
  const preview = pnl.querySelectorAll('div').find((d) => d.className.includes('preview'));
  assert.ok(preview && preview.visible(), 'the preview is shown');
  assert.equal(areaOf(p, 'spec.md').visible(), false, 'the source is hidden');
  pnl.querySelectorAll('button').find((b) => b.textContent === 'Markdown').click();
  assert.equal(areaOf(p, 'spec.md').visible(), true);
  p.host.docs['spec:39'] = { ...editableSpec('# Spec\n\nText.\n'), revision: 's2' };
  await p.poll();
  assert.equal(areaOf(p, 'spec.md').visible(), true, 'still the Markdown view after a refresh');
  assert.equal(panel(p, 'checklists/requirements.md').querySelectorAll('textarea').some((a) => a.visible()), false, 'each file keeps its own mode');
});

test('an edit in the preview changes only that block\'s lines, and is saved', async () => {
  const p = await page();
  const content = '# Spec\n\n**Input**: x  \n\nFirst paragraph.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- item\n';
  p.host.docs = { 'proposal:39': proposal(39, true), 'spec:39': editableSpec(content) };
  await p.showDocument(editableSpec(content));
  const blocks = blocksOf(p, 'spec.md');
  const para = blocks.find((b) => b.textContent === 'First paragraph.');
  assert.equal(para.contentEditable, 'true');
  assert.equal(blocks.find((b) => b.dataset.kind === 'table').contentEditable, 'false', 'tables are edited in the Markdown view');
  para.children[0].children[0].nodeValue = 'First paragraph, edited.';
  fire(para);
  assert.equal(areaOf(p, 'spec.md').value, content.replace('First paragraph.', 'First paragraph, edited.'), 'every other byte kept (the trailing spaces too)');
  p.ids.save.click();
  await settle();
  assert.ok(p.host.calls.includes('save_pane_edit:spec:39'));
});

test('a checklist box toggles in the preview', async () => {
  const p = await page();
  p.host.docs = { 'proposal:39': proposal(39, true), 'spec:39': editableSpec('# Spec\n') };
  await p.showDocument(editableSpec('# Spec\n'));
  const box = panel(p, 'checklists/requirements.md').querySelectorAll('span').find((s) => s.dataset.ui === 'task');
  box.click();
  assert.equal(areaOf(p, 'checklists/requirements.md').value, '# Checklist\n\n- [x] One\n- [x] Two\n');
});

test('a read-only spec previews with nothing editable and no formatting controls', async () => {
  const p = await page();
  p.host.docs = { 'proposal:39': proposal(39, true), 'spec:39': spec(39) };
  await p.showDocument(spec(39));
  assert.ok(blocksOf(p, 'spec.md').length > 0, 'the preview has blocks');
  assert.ok(blocksOf(p, 'spec.md').every((b) => b.contentEditable !== 'true'));
  const bold = panel(p, 'spec.md').querySelectorAll('button').find((b) => b.dataset.cmd === 'bold');
  assert.ok(!bold || !bold.visible(), 'no bold button on a read-only spec');
});

test('when the host keeps the page inline on load, it asks once more when the document arrives, and keeps the button', async () => {
  const p = await page({ ignoreBeside: 1 });
  assert.equal(p.host.mode, 'inline');
  assert.equal(p.ids.beside.hidden, false, 'inline: the button shows');
  p.host.docs = { 'proposal:40': proposal(40, false) };
  await p.showDocument(proposal(40, false));
  assert.equal(p.host.besideRequests, 2);
  assert.equal(p.host.mode, 'fullscreen');
  assert.equal(p.ids.beside.hidden, true);
  await p.showDocument(proposal(40, false));
  assert.equal(p.host.besideRequests, 2, 'only once: never fights the author who moved it back');
});
