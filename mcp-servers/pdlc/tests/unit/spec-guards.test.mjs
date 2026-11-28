// The spec tools' guards, swept (feature 016, T044; US8-AC5, US8-AC6, FR-023 to FR-025; constitution Logging).
//   - a stage change only ever targets the issue the spec came from (FR-023);
//   - the token is in no result, audit line, git argument, Spec Kit child environment or state file (FR-024), and no
//     spec text is a process argument;
//   - every refusal changes nothing (FR-025), checked with tests/helpers/assert-unchanged.mjs;
//   - every call, allowed or refused, writes exactly one audit line before its result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { specWorld } from './helpers/spec-world.mjs';
import { snapshot, assertUnchanged } from '../helpers/assert-unchanged.mjs';
import { CANARY } from './helpers/fixtures.mjs';
import { TOOL_NAMES } from '../../src/tool-contract.mjs';

const BRANCH = '017-pane-probe';
const SPEC = `# Feature Specification: Pane probe

## Clarifications

### Session 2026-11-28

- No questions: no critical ambiguity found.

## Requirements

- **FR-001**: SECRET-SPEC-TEXT-7f3a must never be a process argument.
`;
const SPEC_TOOLS = TOOL_NAMES.filter((n) => /spec/.test(n));

async function started() {
  const w = await specWorld();
  const p = w.ready();
  const s = await w.c.call('start_spec', { repo: 'BELAY', number: p.number, short_name: 'pane-probe' });
  const wr = await w.c.call('write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: SPEC, base_revision: s.payload.revision });
  return { w, p, revision: wr.payload.revision };
}
const folderOf = (w) => join(w.worktreePath, 'specs', BRANCH);
const isGitWrite = (c) => ['add', 'commit', 'push', 'reset', 'clone'].includes(c.args[0]) || (c.args[0] === 'worktree' && c.args[1] === 'add');

test('FR-023 a stage change never targets an issue other than the one the spec came from: a state file claiming another proposal is refused', async () => {
  const { w, p, revision } = await started();
  try {
    const other = w.ready({ title: 'Proposal: Something else' });
    // tamper: the spec's state file now claims the other proposal
    const file = join(w.cloneRoot, '.pdlc-specs', 'BELAY', `${BRANCH}.state.json`);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), number: other.number }));
    const label = (name) => w.forge.state.labels.belay.find((l) => l.name === name);
    const o = w.forge.issue('BELAY', other.number);
    o.labels = o.labels.filter((l) => l.name !== 'status/needs-spec').concat([{ ...label('status/spec-in-progress') }]);
    const snap = snapshot({ forge: w.forge, folders: [folderOf(w)] });
    const r = await w.c.call('approve_spec', { repo: 'BELAY', number: other.number, base_revision: revision });
    assert.equal(r.isError, true, JSON.stringify(r.payload));
    assert.equal(r.payload.code, 'stage_transition_refused');
    assert.match(r.payload.reason, /stage record/);
    assertUnchanged(snap);
    assert.deepEqual(w.pushes, []);
    assert.ok(w.labelsOf(p.number).includes('status/spec-in-progress'));
  } finally { await w.close(); }
});

test('FR-025 every spec-tool refusal changes nothing: no forge write, no file in the spec folder, no git write', async () => {
  const { w, p, revision } = await started();
  try {
    const refusals = [
      ['start_spec', { repo: 'BELAY', number: p.number, short_name: 'again-please' }, 'spec_already_in_progress'],
      ['write_spec_file', { repo: 'BELAY', number: p.number, path: '../x.md', content: 'x', base_revision: revision }, 'path_outside_feature'],
      ['write_spec_file', { repo: 'BELAY', number: p.number, path: 'spec.md', content: 'x', base_revision: 'f'.repeat(64) }, 'pane_edit_pending'],
      ['approve_spec', { repo: 'BELAY', number: p.number, base_revision: 'f'.repeat(64) }, 'pane_edit_pending'],
      ['take_latest_spec', { repo: 'BELAY', number: p.number }, 'nothing_to_take'],
      ['get_spec', { repo: 'BELAY', number: 999 }, 'not_found'],
    ];
    for (const [tool, args, code] of refusals) {
      const gitWrites = w.calls.filter(isGitWrite).length;
      const snap = snapshot({ forge: w.forge, folders: [folderOf(w)] });
      const r = await w.c.call(tool, args);
      assert.equal(r.payload.code, code, `${tool}: ${JSON.stringify(r.payload)}`);
      assertUnchanged(snap, `${tool} → ${code}`);
      assert.equal(w.calls.filter(isGitWrite).length, gitWrites, `${tool} ran a git write`);
    }
  } finally { await w.close(); }
});

test('FR-024 the token is in no spec-tool result, audit line, git argument or state file, and no spec text is a process argument', async () => {
  const { w, p, revision } = await started();
  try {
    const results = [
      await w.c.call('check_spec_kit', { repo: 'BELAY' }),
      await w.c.call('get_spec', { repo: 'BELAY', number: p.number }),
      await w.c.call('approve_spec', { repo: 'BELAY', number: p.number, base_revision: revision }),
      await w.c.call('take_latest_spec', { repo: 'BELAY', number: p.number }),
    ];
    for (const r of results) assert.doesNotMatch(JSON.stringify(r), /canary-/);
    assert.doesNotMatch(w.c.stderr.join(''), /canary-/);
    for (const c of w.calls) {
      assert.doesNotMatch(c.args.join(' '), /canary-/, c.args.join(' '));
      assert.doesNotMatch(c.args.join(' '), /SECRET-SPEC-TEXT/, `spec text in a git argument: ${c.args[0]}`);
    }
    for (const f of readdirSync(join(w.cloneRoot, '.pdlc-specs', 'BELAY')).filter((n) => n.endsWith('.json'))) {
      assert.doesNotMatch(readFileSync(join(w.cloneRoot, '.pdlc-specs', 'BELAY', f), 'utf8'), /canary-/);
    }
    assert.equal(CANARY.startsWith('canary-'), true);
  } finally { await w.close(); }
});

test('one audit line per call, allowed or refused, for every spec tool', async () => {
  const { w, p, revision } = await started();
  try {
    const calls = {
      check_spec_kit: { repo: 'BELAY' },
      start_spec: { repo: 'BELAY', number: p.number, short_name: 'again-please' },
      get_spec: { repo: 'BELAY', number: p.number },
      write_spec_file: { repo: 'BELAY', number: p.number, path: 'spec.md', content: SPEC, base_revision: revision },
      approve_spec: { repo: 'BELAY', number: p.number, base_revision: 'f'.repeat(64) },
      take_latest_spec: { repo: 'BELAY', number: p.number },
      reopen_spec: { repo: 'BELAY', number: p.number },
      withdraw_spec: { repo: 'BELAY', number: p.number, to: 'ready' },
    };
    assert.deepEqual(Object.keys(calls).sort(), [...SPEC_TOOLS].filter((t) => Object.hasOwn(calls, t)).sort());
    for (const tool of SPEC_TOOLS.filter((t) => Object.hasOwn(calls, t))) {
      const before = w.c.audits().length;
      await w.c.call(tool, calls[tool]);
      const added = w.c.audits().slice(before);
      assert.equal(added.length, 1, `${tool} wrote ${added.length} audit lines`);
      assert.equal(added[0].tool, tool);
      assert.ok(['allowed', 'refused'].includes(added[0].decision));
    }
  } finally { await w.close(); }
});
