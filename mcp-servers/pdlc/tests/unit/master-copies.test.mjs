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

test('form copy: BELAY\'s own .forgejo/issue_template/proposal.yaml equals the master byte for byte (FR-029)', () => {
  const belayCopy = readFileSync(new URL('../../../../.forgejo/issue_template/proposal.yaml', import.meta.url));
  assert.ok(belayCopy.equals(readFileSync(contract('proposal.yaml'))), 'BELAY\'s copy drifted from the master: copy contract/proposal.yaml over it');
});

// Feature 016: the four stage labels a proposal moves through after `status/needs-spec` (data-model.md
// "Label contract"; contracts/stages.md). Names, colours and descriptions are the contract, exactly.
const STAGE_LABELS_016 = [
  { name: 'status/spec-in-progress', color: '#fbca04', description: 'Spec being written and clarified by its author; not ready to plan' },
  { name: 'status/ready-to-plan', color: '#0e8a16', description: 'Spec approved and published on its feature branch; pick up with /speckit-plan' },
  { name: 'status/in-engineering', color: '#5319e7', description: 'Planning has started; the spec is locked from Claude Desktop' },
  { name: 'status/merged', color: '#6f42c1', description: 'Feature branch merged into the default branch; the issue is closed' },
];

test('stage labels: proposal-labels.json holds the four stage labels with their contract colour and description (FR-011)', () => {
  for (const want of STAGE_LABELS_016) {
    const row = labels.find((l) => l.name === want.name);
    assert.ok(row, `missing label ${want.name}`);
    assert.deepEqual(row, want, want.name);
  }
});
