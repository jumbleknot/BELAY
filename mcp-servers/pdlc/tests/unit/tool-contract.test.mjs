// The fixed tool contract (contracts/tools.md; FR-001, FR-002, FR-003, SC-006, US3-AC7), read from
// tools/list over the real protocol. A difference from the contract page is a breaking change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers/mcp-client.mjs';
import { Refusal } from '../../src/refusal.mjs';

const SECTION_IDS = ['feature_name', 'problem', 'proposed_value', 'personas', 'goals_success', 'rough_scope',
  'open_questions', 'out_of_scope', 'priority'];

// Transcribed from contracts/tools.md. `enums` lists every enum-valued property.
const CONTRACT = {
  list_repos: { props: [], required: [] },
  repo_status: { props: ['repo'], required: ['repo'] },
  sync_repo: { props: ['repo'], required: ['repo'] },
  check_setup: { props: ['repo'], required: ['repo'] },
  list_proposals: { props: ['repo', 'status', 'query', 'state'], required: ['repo', 'status'],
    enums: { status: ['draft', 'ready', 'all'], state: ['open', 'closed', 'all'] } },
  get_proposal: { props: ['repo', 'number'], required: ['repo', 'number'] },
  create_proposal: { props: ['repo', 'title', 'sections', 'priority', 'status'], required: ['repo', 'title', 'sections', 'priority', 'status'],
    enums: { priority: ['p1', 'p2', 'p3'], status: ['draft', 'ready'] }, sections: { required: ['feature_name'] } },
  update_proposal: { props: ['repo', 'number', 'expected_updated_at', 'title', 'sections', 'priority', 'status'],
    required: ['repo', 'number', 'expected_updated_at'], enums: { priority: ['p1', 'p2', 'p3'], status: ['draft', 'ready'] }, sections: { required: [] } },
  add_comment: { props: ['repo', 'number', 'body'], required: ['repo', 'number', 'body'] },
  // Feature 016 (specs/016-pdlc-spec-intake/contracts/tools.md), added as each user story lands.
  check_spec_kit: { props: ['repo'], required: ['repo'] },
  start_spec: { props: ['repo', 'number', 'short_name'], required: ['repo', 'number', 'short_name'] },
  get_spec: { props: ['repo', 'number'], required: ['repo', 'number'] },
  write_spec_file: { props: ['repo', 'number', 'path', 'content', 'base_revision'], required: ['repo', 'number', 'path', 'content', 'base_revision'] },
  approve_spec: { props: ['repo', 'number', 'base_revision'], required: ['repo', 'number', 'base_revision'] },
  take_latest_spec: { props: ['repo', 'number'], required: ['repo', 'number'] },
  reopen_spec: { props: ['repo', 'number'], required: ['repo', 'number'] },
};

const sorted = (a) => [...a].sort();

test('tools/list names exactly the contract tools (tools/list differs from the contract otherwise)', async () => {
  const c = await connect();
  try {
    const { tools } = await c.client.listTools();
    assert.deepEqual(sorted(tools.map((t) => t.name)), sorted(Object.keys(CONTRACT)));
    for (const t of tools) assert.ok(t.description && t.description.length > 20, `${t.name} has a description`);
  } finally { await c.close(); }
});

test('each input schema matches the contract: property names, required set and enum values', async () => {
  const c = await connect();
  try {
    const { tools } = await c.client.listTools();
    for (const t of tools) {
      const want = CONTRACT[t.name];
      const schema = t.inputSchema;
      assert.equal(schema.type, 'object', t.name);
      assert.deepEqual(sorted(Object.keys(schema.properties ?? {})), sorted(want.props), `${t.name} properties`);
      assert.deepEqual(sorted(schema.required ?? []), sorted(want.required), `${t.name} required`);
      for (const [prop, values] of Object.entries(want.enums ?? {})) {
        assert.deepEqual(sorted(schema.properties[prop].enum), sorted(values), `${t.name}.${prop} enum`);
      }
      if (want.sections) {
        const s = schema.properties.sections;
        assert.deepEqual(sorted(Object.keys(s.properties)), sorted(SECTION_IDS), `${t.name}.sections keys`);
        assert.deepEqual(sorted(s.required ?? []), sorted(want.sections.required), `${t.name}.sections required`);
        assert.equal(s.additionalProperties, false, `${t.name}.sections rejects unknown keys`);
      }
      if (t.name.endsWith('_proposal') && schema.properties.number) assert.equal(schema.properties.number.type, 'integer');
    }
  } finally { await c.close(); }
});

test('no tool name offers a close, reopen, delete, label, milestone, assignee, bulk or file-write operation', async () => {
  const c = await connect();
  try {
    const { tools } = await c.client.listTools();
    // Feature 016: `reopen_spec` is the one contract name containing "reopen". It reopens a SPEC for editing (ready to
    // plan → spec in progress) and never an issue, which stays open until merge; FR-027 still forbids an issue reopen.
    const SPEC_LIFECYCLE = new Set(['reopen_spec']);
    for (const t of tools.filter((x) => !SPEC_LIFECYCLE.has(x.name))) {
      assert.doesNotMatch(t.name, /close|reopen|delete|label|milestone|assign|bulk|write_file/);
    }
  } finally { await c.close(); }
});

test('a handler that throws a Refusal yields isError with {refused, code, reason}', async () => {
  const c = await connect({ handlers: { get_proposal: async () => { throw new Refusal('not_a_proposal', 'issue 3 is not a proposal'); } } });
  try {
    const r = await c.call('get_proposal', { repo: 'BELAY', number: 3 });
    assert.equal(r.isError, true);
    assert.deepEqual(r.payload, { refused: true, code: 'not_a_proposal', reason: 'issue 3 is not a proposal' });
  } finally { await c.close(); }
});

test('a schema violation is refused as invalid_input before the handler runs', async () => {
  let ran = false;
  const c = await connect({ handlers: { add_comment: async () => { ran = true; return {}; } } });
  try {
    for (const args of [{ repo: 'BELAY', number: 0, body: 'x' }, { repo: 'BELAY', number: 1, body: '' }, { repo: 'BELAY', number: 1, body: 'x', extra: 1 }]) {
      const r = await c.call('add_comment', args);
      assert.equal(r.isError, true);
      assert.equal(r.payload.code, 'invalid_input', JSON.stringify(args));
    }
    assert.equal(ran, false);
  } finally { await c.close(); }
});

test('a success yields content[0].text and structuredContent holding the same object', async () => {
  const result = { repos: [{ name: 'BELAY', description: 'd', default_branch: 'main', has_clone: false }], truncated: false };
  const c = await connect({ handlers: { list_repos: async () => result } });
  try {
    const r = await c.call('list_repos');
    assert.notEqual(r.isError, true);
    assert.deepEqual(r.payload, result);
    assert.deepEqual(r.structuredContent, result);
  } finally { await c.close(); }
});

test('every call writes exactly one audit line before its result reaches the client', async () => {
  let auditsWhenHandlerRan;
  let c;
  c = await connect({ handlers: {
    list_repos: async () => { auditsWhenHandlerRan = c.audits().length; return { repos: [], truncated: false }; },
    get_proposal: async () => { throw new Refusal('not_found', 'no issue 9'); },
  } });
  try {
    await c.call('list_repos');
    assert.equal(auditsWhenHandlerRan, 0);
    assert.equal(c.audits().length, 1, 'the audit line exists once the client has the result');
    await c.call('get_proposal', { repo: 'belay', number: 9 });
    await c.call('add_comment', { repo: 'BELAY', number: -1, body: 'x' });
    const [ok, refused, invalid] = c.audits();
    assert.equal(c.audits().length, 3);
    assert.deepEqual({ tool: ok.tool, decision: ok.decision }, { tool: 'list_repos', decision: 'allowed' });
    assert.deepEqual({ tool: refused.tool, decision: refused.decision, code: refused.code, repo: refused.repo, number: refused.number },
      { tool: 'get_proposal', decision: 'refused', code: 'not_found', repo: 'belay', number: 9 });
    assert.deepEqual({ tool: invalid.tool, decision: invalid.decision, code: invalid.code }, { tool: 'add_comment', decision: 'refused', code: 'invalid_input' });
    const ids = c.audits().map((a) => a.correlation_id);
    assert.ok(ids.every((id) => id !== null && id !== undefined), 'the request id is the correlation_id');
    assert.equal(new Set(ids).size, 3);
  } finally { await c.close(); }
});

test('016: start_spec.short_name is 2 to 4 kebab words of [a-z0-9], at most 40 characters; write_spec_file.content at most 256 KiB', async () => {
  const c = await connect();
  try {
    const { tools } = await c.client.listTools();
    const short = tools.find((t) => t.name === 'start_spec').inputSchema.properties.short_name;
    assert.equal(short.maxLength, 40);
    assert.equal(short.pattern, '^[a-z0-9]+(?:-[a-z0-9]+){1,3}$');
    const w = tools.find((t) => t.name === 'write_spec_file').inputSchema.properties;
    assert.equal(w.base_revision.pattern, '^[0-9a-f]{64}$');
    assert.equal(w.path.maxLength, 200);
    assert.equal(w.number.type, 'integer');
  } finally { await c.close(); }
});
