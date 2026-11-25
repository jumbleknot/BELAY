// The master copies held in BELAY (FR-011, FR-021, FR-022, FR-029). The form's field labels ARE the
// body headings, so the form and the server's heading list cannot drift apart unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { HEADINGS } from '../../src/proposal-body.mjs';

const contract = (name) => new URL(`../../contract/${name}`, import.meta.url);
const form = parse(readFileSync(contract('proposal.yaml'), 'utf8'));
const labels = JSON.parse(readFileSync(contract('proposal-labels.json'), 'utf8'));

test('the master form\'s field labels equal the server\'s headings, in order', () => {
  const fieldLabels = form.body.filter((f) => f.type !== 'markdown').map((f) => f.attributes.label);
  assert.deepEqual(fieldLabels, HEADINGS);
});

test('the master form files issues with exactly type/proposal and status/proposal-draft', () => {
  assert.deepEqual([...form.labels].sort(), ['status/proposal-draft', 'type/proposal']);
});

test('the master form\'s title starts with "Proposal: "', () => {
  assert.equal(form.title, 'Proposal: ');
});

test('every row of proposal-labels.json has a name, a six-hex colour and a description', () => {
  assert.ok(labels.length > 0);
  for (const l of labels) {
    assert.deepEqual(Object.keys(l).sort(), ['color', 'description', 'name'], JSON.stringify(l));
    assert.match(l.name, /^[a-z]+\/[a-z0-9-]+$/);
    assert.match(l.color, /^#[0-9a-f]{6}$/);
    assert.ok(l.description.trim().length > 0, l.name);
  }
  for (const name of ['type/proposal', 'status/proposal-draft', 'status/needs-spec', 'priority/p1', 'priority/p2', 'priority/p3', 'status/bot-managed']) {
    assert.ok(labels.some((l) => l.name === name), name);
  }
});
