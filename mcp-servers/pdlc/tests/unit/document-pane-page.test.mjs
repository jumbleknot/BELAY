// The pane page itself, checked statically (feature 016, US9; M7: one hand-written, self-contained file, no dependency,
// no build step). Its JSON-RPC is the subset T003 measured working in Claude Desktop, and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../ui/document-pane.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

test('one self-contained file: no external src or href, one inline script, no eval or new Function', () => {
  assert.doesNotMatch(html, /\s(src|href)\s*=\s*["']?(https?:|\/\/|\.\.?\/)/i);
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  assert.doesNotMatch(script, /\beval\s*\(|new\s+Function\s*\(/);
});

test('the JSON-RPC it uses is the measured subset (T003), and never ui/update-model-context (the model does not see it)', () => {
  const used = new Set([...script.matchAll(/['"`](ui\/[a-z/-]+|tools\/call)['"`]/g)].map((m) => m[1]));
  const MEASURED = ['ui/initialize', 'ui/notifications/initialized', 'ui/notifications/tool-result', 'ui/notifications/host-context-changed', 'ui/request-display-mode', 'tools/call'];
  for (const m of used) assert.ok(MEASURED.includes(m), `unmeasured method ${m}`);
  for (const m of MEASURED) assert.ok(used.has(m), `does not use ${m}`);
  assert.doesNotMatch(script, /update-model-context/);
});

test('it asks for the side pane (fullscreen) on load, and says so when the host offers only inline (FR-037 fallback)', () => {
  assert.match(script, /'ui\/request-display-mode',\s*\{\s*mode:\s*'fullscreen'\s*\}/);
  assert.match(script, /availableDisplayModes/);
  assert.match(html, /The side pane is not available/);
});

test('it polls read_pane_document every 2 s, saves through save_pane_edit, and never overwrites text the author is typing', () => {
  assert.match(script, /(name:\s*|callTool\()'read_pane_document'/);
  assert.match(script, /(name:\s*|callTool\()'save_pane_edit'/);
  assert.match(script, /'tools\/call',\s*\{\s*name,\s*arguments/);
  assert.match(script, /setInterval\([^,]+,\s*2000\)/);
  assert.match(script, /if \(dirty\)/, 'a poll leaves unsaved typing alone');
});

test('read-only mode disables every editor and the save button', () => {
  assert.match(script, /readOnly\s*=\s*true|\.readOnly\s*=\s*readOnly/);
  assert.match(script, /disabled\s*=\s*readOnly/);
});

test('one tab per document that exists: the proposal, and each spec file once it has a spec; one shown at a time, the chosen tab kept across a refresh (T082 findings)', () => {
  assert.match(script, /setAttribute\('role',\s*'tablist'\)/, 'a tab strip');
  assert.match(script, /setAttribute\('role',\s*'tab'\)/, 'one tab per document');
  assert.match(script, /setAttribute\('role',\s*'tabpanel'\)/, 'one panel per document');
  assert.match(script, /aria-selected/, 'the chosen tab is marked');
  assert.match(script, /\.hidden\s*=/, 'the other documents are hidden, not stacked');
  assert.match(script, /let activeTab\b/, 'the chosen tab outlives a re-render (the 2 s poll)');
  assert.match(script, /Proposal #\$\{/, 'a proposal tab');
  assert.match(script, /has_spec/, 'a spec tab appears only when the proposal has a spec');
  assert.match(script, /kind:\s*'spec'/, 'the page reads the spec itself');
  assert.match(script, /kind:\s*'proposal'/, 'and the proposal itself');
});

test('it offers a button to move beside the chat whenever it is shown inline (the host may ignore the request on load)', () => {
  assert.match(html, /id="beside"/);
  assert.match(script, /displayMode/);
  assert.match(script, /\$\('beside'\)\.addEventListener\('click'/);
});
