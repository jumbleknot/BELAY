// The proposal body (contracts/proposal-body.md; FR-010, SC-002; US1-AC4, US1-AC6). The server writes
// exactly what the forge renders for the proposal form, and reads both back the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS, HEADINGS, renderBody, parseBody } from '../../src/proposal-body.mjs';
import { SECTION_IDS } from '../../src/tool-contract.mjs';

const full = {
  feature_name: 'Import export spreadsheet',
  problem: 'Lists live in spreadsheets.',
  proposed_value: 'One import.',
  personas: 'Collector',
  goals_success: '**Goals**\n- a\n\n**Success criteria / done when**\n- [ ] b',
  rough_scope: '**Functional**\n- c',
  open_questions: 'None known',
  out_of_scope: 'Sync',
  priority: 'p2',
};

test('SECTIONS lists the nine ids in contract order, with their headings', () => {
  assert.deepEqual(SECTIONS.map((s) => s.id), SECTION_IDS);
  assert.deepEqual(HEADINGS, ['Proposed feature name', 'Problem', 'Proposed value', 'Personas involved',
    'Goals and success definition', 'Rough scope', 'Open questions', 'Out of scope', 'Priority']);
});

test('renderBody emits the nine ### blocks in order, exactly as the forge renders the form', () => {
  const body = renderBody(full);
  const headings = body.split('\n').filter((l) => l.startsWith('### ')).map((l) => l.slice(4));
  assert.deepEqual(headings, HEADINGS);
  assert.ok(body.startsWith('### Proposed feature name\n\nImport export spreadsheet\n\n### Problem\n\n'));
  assert.ok(body.endsWith('### Priority\n\np2\n\n'));
});

test('an empty or missing optional section is rendered as _No response_', () => {
  const body = renderBody({ ...full, open_questions: '', out_of_scope: undefined });
  assert.match(body, /### Open questions\n\n_No response_\n\n### Out of scope\n\n_No response_\n\n/);
});

test('parseBody reads a rendered body back into every section, with no warnings', () => {
  const { sections, warnings } = parseBody(renderBody(full));
  assert.deepEqual(sections, full);
  assert.deepEqual(warnings, []);
});

test('_No response_ reads back as the empty string', () => {
  const { sections } = parseBody(renderBody({ ...full, open_questions: '', out_of_scope: '' }));
  assert.equal(sections.open_questions, '');
  assert.equal(sections.out_of_scope, '');
});

test('a user-typed ### line, or a known heading out of order, stays content (rule 1)', () => {
  const problem = 'first\n\n### My own heading\n\n### Priority\nstill problem text';
  const { sections, warnings } = parseBody(renderBody({ ...full, problem }));
  assert.equal(sections.problem, problem);
  assert.equal(sections.priority, 'p2');
  assert.deepEqual(warnings, []);
});

test('trailing spaces after a heading are tolerated', () => {
  const { sections } = parseBody(renderBody(full).replace('### Problem\n', '### Problem   \n'));
  assert.equal(sections.problem, full.problem);
});

test('text before the first section is a warning, not an error, and is not lost from the warning', () => {
  const { sections, warnings } = parseBody(`Some preamble\n\n${renderBody(full)}`);
  assert.equal(sections.feature_name, full.feature_name);
  assert.ok(warnings.includes('text before first section'), warnings.join());
});

test('a heading that never appears is a warning naming it; its section reads as empty', () => {
  const body = renderBody(full).replace('### Out of scope\n\nSync\n\n', '');
  const { sections, warnings } = parseBody(body);
  assert.ok(warnings.includes('missing section: Out of scope'), warnings.join());
  assert.equal(sections.out_of_scope, '');
  assert.equal(sections.open_questions, 'None known');
});

test('an empty body warns about every section and returns all ids', () => {
  const { sections, warnings } = parseBody('');
  assert.deepEqual(Object.keys(sections), SECTION_IDS);
  assert.equal(warnings.length, 9);
});

test('round trip holds for generated inputs, with empties normalised to ""', () => {
  // A small deterministic generator: multi-line text, markdown, user ### lines (not the next heading),
  // CR-free lines, empty optional sections, and the literal _No response_ (which reads back empty).
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pieces = ['plain words', '- a bullet', '**bold**', '### Unrelated user heading', '```\ncode\n```', 'tab\there', 'ünïcödé ✓', '> quote', ''];
  const gen = () => {
    const lines = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pieces[Math.floor(rand() * pieces.length)]);
    return lines.join('\n').replace(/^\n+|\n+$/g, '');
  };
  for (let i = 0; i < 200; i++) {
    const input = Object.fromEntries(SECTION_IDS.map((id) => [id, rand() < 0.15 ? '' : gen()]));
    if (rand() < 0.1) input.open_questions = '_No response_';
    const expected = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === '_No response_' ? '' : v]));
    assert.deepEqual(parseBody(renderBody(input)).sections, expected, JSON.stringify(input));
  }
});

test('a web-form submission parses into the same section set as a rendered body', () => {
  // Captured 2026-11-25 from a real submission through ci-smoke's proposal form (issue #10), byte for byte
  // except the feature name's value. The forge joins fields with LF and keeps the browser's CRLF inside
  // textarea values (the form's prefilled Goals and Rough scope templates), and ends the body with "\n\n".
  const text = readFileSync(new URL('./fixtures/web-form-proposal.md', import.meta.url), 'utf8');
  assert.ok(text.includes('\r\n') && text.endsWith('p2\n\n'), 'the fixture keeps the captured line endings');
  const web = parseBody(text);
  assert.deepEqual(web.warnings, []);
  assert.deepEqual(Object.keys(web.sections), SECTION_IDS);
  assert.equal(web.sections.feature_name, 'Example test proposal');
  assert.equal(web.sections.problem, 'This is for testing');
  assert.equal(web.sections.goals_success, '**Goals**\n- This is for testing\n\n**Success criteria / done when**\n- [ ]\n- [ ]');
  assert.equal(web.sections.rough_scope, '**Functional**\n- This is for testing\n\n**Non-functional**\n-');
  assert.equal(web.sections.open_questions, '');
  assert.equal(web.sections.out_of_scope, '');
  assert.equal(web.sections.priority, 'p2');
  assert.deepEqual(parseBody(renderBody(web.sections)).sections, web.sections);
});
