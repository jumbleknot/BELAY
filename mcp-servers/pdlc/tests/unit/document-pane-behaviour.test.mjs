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

class El {
  constructor(tag) { Object.assign(this, { tag, children: [], attrs: {}, dataset: {}, listeners: {}, hidden: false, value: '', style: {}, parent: null, _text: '' }); }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  set textContent(t) { this._text = t; if (t === '') this.children = []; }
  get textContent() { return this._text; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
  click() { for (const f of this.listeners.click ?? []) f({ preventDefault() {} }); }
  focus() {}
  setSelectionRange() {}
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  visible() { for (let e = this; e; e = e.parent) if (e.hidden) return false; return true; }
  querySelectorAll(sel) {
    const [, tag, attr] = sel.match(/^(\w+)?(?:\[data-([\w-]+)\])?$/);
    return [...this.walk()].filter((e) => (!tag || e.tag === tag) && (!attr || e.dataset[attr] !== undefined));
  }
}

/** A page in a fake host. `docs` answers read_pane_document by `<kind>:<ref>`. */
async function page() {
  const ids = Object.fromEntries(['title', 'status', 'save', 'beside', 'notice', 'editors', 'kept'].map((id) => [id, new El('div')]));
  ids.beside.hidden = true;
  const root = new El('body');
  root.append(...Object.values(ids));
  const document = {
    getElementById: (id) => ids[id] ?? [...root.walk()].find((e) => e.id === id),
    createElement: (t) => new El(t),
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
        if (m.method === 'ui/request-display-mode') { host.mode = m.params.mode; return reply({ jsonrpc: '2.0', id: m.id, result: { mode: host.mode } }); }
        if (m.method === 'tools/call') {
          host.calls.push(`${m.params.name}:${m.params.arguments.kind}:${m.params.arguments.ref}`);
          const d = host.docs[`${m.params.arguments.kind}:${m.params.arguments.ref}`];
          return reply({ jsonrpc: '2.0', id: m.id, result: d ? { structuredContent: structuredClone(d) } : { isError: true, structuredContent: { code: 'not_found', reason: 'none' } } });
        }
      },
    },
  };
  runInNewContext(script, { window, document, setTimeout, clearTimeout, setInterval: (fn) => { host.poll = fn; return 0; }, Promise, Error, JSON, Map, String, Boolean, Number });
  await settle();
  const tabs = () => ids.editors.querySelectorAll('button').filter((b) => b.attrs.role === 'tab');
  return {
    host, ids,
    tabs: () => tabs().map((t) => t.textContent),
    shown: () => ids.editors.querySelectorAll('div').filter((d) => d.attrs.role === 'tabpanel' && d.visible()).map((d) => d.dataset.tab),
    choose: (text) => tabs().find((t) => t.textContent === text).click(),
    showDocument: async (payload) => { host.listener({ data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: payload } } }); await settle(); },
    poll: async () => { await host.poll(); await settle(); },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
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
