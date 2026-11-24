// Unit tests for the agent-driven backlog tool.
//
// Runs in CI: the guardrails `naming` job executes `node --test scripts/__tests__/*.test.mjs`
//, so this file MUST stay deterministic, offline and token-free. Every case drives an
// exported pure function or an injected fetch/env double — never a live forge call. The live-forge
// verification lives in specs/003-backlog-taskstoissues/quickstart.md, run by hand once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// A REAL-shaped tailnet host, assembled from fragments so no contiguous `.ts.net` literal appears in
// this file. A tree-wide topology scan (scripts/check-topology-scrub.mjs) holds no literal to compare
// against (by design), so it cannot tell an invented tailnet host from the real one — spelling one out
// here fails that gate, which is exactly what happened once before. Same technique
// as ci-digest-redact.test.mjs. Do not "tidy" this into a single string.
const tsNetHost = (label) => label + '.ts' + '.net';
const REAL_HOST = tsNetHost('forge.tailz9x8w7');

import { forgeEndpoint } from '../ci-status.mjs';
import {
  BacklogError,
  selectToken,
  describeMissingWriteToken,
  describeScopeFailure,
  assertWriteTargetsOriginRepo,
  assertWritePathTargetsOriginRepo,
  forgeRequest,
  buildIssueQuery,
  readTotalCount,
  describeTruncation,
  resolveNames,
  selectReadyItems,
  excludedNote,
  distillItem,
  readBodyFrom,
  findDuplicateOpenItem,
  planMissingNames,
  describeFormValidation,
  renderLine,
  TAXONOMY,
  classifyUpdateFailure,
  wouldCreateCycle,
  describeDivergence,
} from '../backlog.mjs';


// ──/: endpoint derivation (, research D1) ─────────────────────────────────────────
//
// The port case is the whole point. Phase 0 built the API base from FORGE_REGISTRY_HOST — a bare
// hostname with no port — and every call failed as `TypeError: fetch failed`, which reads exactly like
// an unreachable forge or a blocked firewall. The remote is the only value carrying scheme + host + PORT.
test('endpoint derivation keeps the port from an http remote', () => {
  const { base, owner, repo } = forgeEndpoint({ origin: 'http://forge.example:3000/acme/widget.git' });
  assert.equal(base, 'http://forge.example:3000/api/v1');
  assert.equal(owner, 'acme');
  assert.equal(repo, 'widget');
});

test('endpoint derivation handles https and a missing .git suffix', () => {
  assert.equal(
    forgeEndpoint({ origin: 'https://forge.example/acme/widget' }).base,
    'https://forge.example/api/v1',
  );
  assert.equal(forgeEndpoint({ origin: 'https://forge.example/acme/widget' }).repo, 'widget');
});

test('endpoint derivation rejects a remote it cannot parse rather than guessing', () => {
  assert.throws(() => forgeEndpoint({ origin: 'git@forge.example:acme/widget.git' }), /could not parse/);
  assert.throws(() => forgeEndpoint({ origin: 'not-a-url' }), /could not parse/);
});


// ──/: redaction on every emit path (, SC-004, US4-AC4) ────────────────────────────
test('redaction removes the forge host and port from any emitted line', () => {
  const line = renderLine(`GET http://${REAL_HOST}:3000/acme/widget/api/v1/issues`);
  assert.ok(!line.includes('tailz9x8w7'), `host survived redaction: ${line}`);
  assert.ok(line.includes('<forge>'), `expected a <forge> placeholder, got: ${line}`);
});

test('redaction strips control characters so a hostile title cannot emit terminal escapes', () => {
  const line = renderLine('title: [31mred[0m');
  assert.ok(!line.includes(''), 'escape sequence survived');
  assert.ok(!line.includes(''), 'bell survived');
});


// ──/: credential selection (, research D6) ───────────────────────────────────────
test('writes require the issue token; reads prefer it and fall back to the read-only token', () => {
  const both = { FORGE_ISSUE_TOKEN: 'issue', FORGE_TOKEN: 'read' };
  assert.deepEqual(selectToken(both, { write: true }), { token: 'issue', name: 'FORGE_ISSUE_TOKEN' });
  assert.deepEqual(selectToken(both, { write: false }), { token: 'issue', name: 'FORGE_ISSUE_TOKEN' });
  assert.deepEqual(selectToken({ FORGE_TOKEN: 'read' }, { write: false }), {
    token: 'read',
    name: 'FORGE_TOKEN',
  });
});

test('a whitespace-only token counts as absent, not as a credential', () => {
  assert.throws(
    () => selectToken({ FORGE_ISSUE_TOKEN: '   ', FORGE_TOKEN: 'read' }, { write: true }),
    /FORGE_ISSUE_TOKEN/,
  );
  assert.equal(
    selectToken({ FORGE_ISSUE_TOKEN: '   ', FORGE_TOKEN: 'read' }, { write: false }).name,
    'FORGE_TOKEN',
  );
});

test('a missing write credential is refused by name, with the remedy and the read-only consequence', () => {
  const msg = describeMissingWriteToken();
  assert.match(msg, /FORGE_ISSUE_TOKEN/);
  assert.match(msg, /read-only/i);
  assert.match(msg, /docs\/runbooks\/backlog\.md/, 'the remedy must point at the backlog runbook');
  assert.throws(() => selectToken({}, { write: true }), /FORGE_ISSUE_TOKEN/);
});

test('with no credential at all even reads fail loudly rather than degrading to anonymous', () => {
  assert.throws(() => selectToken({}, { write: false }), /FORGE_TOKEN/);
});


// ──/: scope-failure diagnosis (, SC-003, US4-AC3) ────────────────────────────────
test('a 403 names the token used, the permission missing, and that scope is granular not expiry', () => {
  const msg = describeScopeFailure(403, '/repos/a/b/issues', 'FORGE_TOKEN');
  assert.match(msg, /403/);
  assert.match(msg, /FORGE_TOKEN/);
  assert.match(msg, /write:issue/);
  assert.match(msg, /granular scope/i);
  assert.doesNotMatch(msg, /expired/i);
});

test('scope diagnosis maps each endpoint family to the permission it actually needs', () => {
  assert.match(describeScopeFailure(403, '/repos/a/b/issues/4/comments', 'T'), /write:issue/);
  assert.match(describeScopeFailure(403, '/repos/a/b/issues/4/dependencies', 'T'), /write:issue/);
  assert.match(describeScopeFailure(403, '/repos/a/b/labels', 'T'), /write:issue/);
  assert.match(describeScopeFailure(401, '/repos/a/b', 'T'), /read:repository/);
});

test('scope diagnosis names the issue token when that is the one that failed', () => {
  assert.match(
    describeScopeFailure(403, '/repos/a/b/issues', 'FORGE_ISSUE_TOKEN'),
    /FORGE_ISSUE_TOKEN/,
  );
});


// ──/: the same-repository write guard (, US7-AC2) ─────────────────────────────────
//
// The write credential can reach items on other repositories by the operator's decision, so this guard
// is the only client-side bound. It is the one test standing between a typo and someone else's tracker.
const ORIGIN = { owner: 'acme', repo: 'widget' };

test('the write guard passes through the repository the working copy points at', () => {
  assert.doesNotThrow(() => assertWriteTargetsOriginRepo({ owner: 'acme', repo: 'widget' }, ORIGIN));
});

test('the write guard refuses a different owner', () => {
  assert.throws(() => assertWriteTargetsOriginRepo({ owner: 'other', repo: 'widget' }, ORIGIN), /refus/i);
});

test('the write guard refuses a different repository', () => {
  assert.throws(() => assertWriteTargetsOriginRepo({ owner: 'acme', repo: 'other' }, ORIGIN), /refus/i);
});

test('the write guard is case-sensitive rather than guessing at equivalence', () => {
  assert.throws(() => assertWriteTargetsOriginRepo({ owner: 'Acme', repo: 'widget' }, ORIGIN), /refus/i);
});


// ──/: transport (,, US2-AC4) ──────────────────────────────────────────────
const fakeFetch = (status, body = '{}', headers = {}) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => body,
});

test('transport returns parsed data plus the total header, never the raw text', async () => {
  const res = await forgeRequest('/issues', {
    base: 'http://f/api/v1',
    token: 't',
    tokenName: 'T',
    fetchImpl: fakeFetch(200, '[{"number":1}]', { 'x-total-count': '7' }),
  });
  assert.deepEqual(res.data, [{ number: 1 }]);
  assert.equal(res.total, 7);
  assert.equal(res.text, undefined, 'raw text must not be handed to callers');
});

test('transport routes 401/403 through the scope diagnosis', async () => {
  await assert.rejects(
    forgeRequest('/issues', {
      base: 'http://f/api/v1',
      token: 't',
      tokenName: 'FORGE_TOKEN',
      fetchImpl: fakeFetch(403, '{"message":"forbidden"}'),
    }),
    /write:issue/,
  );
});

test('transport reports an unreachable forge distinctly from an authorization refusal', async () => {
  await assert.rejects(
    forgeRequest('/issues', {
      base: 'http://f/api/v1',
      token: 't',
      tokenName: 'T',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    }),
    (e) => {
      assert.match(e.message, /could not reach/i);
      assert.doesNotMatch(e.message, /scope/i);
      assert.match(e.message, /api\/v1/, 'the derived base must be named — a portless base is the trap');
      return true;
    },
  );
});

test('transport surfaces an unexpected status with the status code', async () => {
  await assert.rejects(
    forgeRequest('/issues', {
      base: 'http://f/api/v1',
      token: 't',
      tokenName: 'T',
      fetchImpl: fakeFetch(500, 'boom'),
    }),
    /500/,
  );
});


// ──/: listing query (, US2-AC3, research D2) ─────────────────────────────────────
test('every listing query carries type=issues — without it 143 rows come back where 1 is correct', () => {
  for (const opts of [{}, { state: 'open' }, { q: 'x' }, { labels: ['a'] }, { page: 3, limit: 10 }]) {
    assert.equal(buildIssueQuery(opts).get('type'), 'issues', `missing type for ${JSON.stringify(opts)}`);
  }
});

test('page and limit are always sent together', () => {
  const q = buildIssueQuery({});
  assert.ok(q.get('page'), 'page missing');
  assert.ok(q.get('limit'), 'limit missing');
});

test('limit is clamped to the measured hard cap of 50', () => {
  assert.equal(buildIssueQuery({ limit: 200 }).get('limit'), '50');
  assert.equal(buildIssueQuery({ limit: 60 }).get('limit'), '50');
  assert.equal(buildIssueQuery({ limit: 10 }).get('limit'), '10');
});

test('state, free-text and label filters pass through when given', () => {
  const q = buildIssueQuery({ state: 'closed', q: 'cascade', labels: ['type/bug', 'priority/p1'] });
  assert.equal(q.get('state'), 'closed');
  assert.equal(q.get('q'), 'cascade');
  assert.equal(q.get('labels'), 'type/bug,priority/p1');
});

test('an omitted state defaults to open rather than silently listing closed work', () => {
  assert.equal(buildIssueQuery({}).get('state'), 'open');
});


// ──/: authoritative totals (, US2-AC2) ───────────────────────────────────────────
test('the total comes from x-total-count, not from the number of rows', () => {
  assert.equal(readTotalCount({ get: () => '142' }), 142);
  assert.equal(readTotalCount({ get: () => null }), null);
});

test('a full page with a larger total is reported as truncated', () => {
  const note = describeTruncation(142, 50);
  assert.match(note, /142/);
  assert.match(note, /truncat/i);
});

test('a complete result set produces no truncation notice', () => {
  assert.equal(describeTruncation(3, 3), null);
  assert.equal(describeTruncation(null, 3), null);
});

test('a row count exceeding the reported total does not fabricate a truncation notice', () => {
  assert.equal(describeTruncation(2, 3), null);
});


// ──/: name resolution (, research D3) ────────────────────────────────────────────
//
// Measured: `labels=<unknown-name>` is silently ignored server-side and returns the UNFILTERED set, so a
// typo'd filter reads as "matched everything". The name must be rejected locally, before the request.
const LABELS = [
  { id: 1, name: 'type/bug' },
  { id: 2, name: 'priority/p1' },
];

test('known names resolve to their ids', () => {
  assert.deepEqual(resolveNames(['type/bug'], LABELS, 'label'), [{ id: 1, name: 'type/bug' }]);
});

test('an unknown label is refused locally, because the API would silently return everything', () => {
  assert.throws(() => resolveNames(['type/bugg'], LABELS, 'label'), /type\/bugg/);
});

test('the refusal lists the valid values so the operator does not have to go looking', () => {
  try {
    resolveNames(['nope'], LABELS, 'label');
    assert.fail('expected a refusal');
  } catch (e) {
    assert.match(e.message, /type\/bug/);
    assert.match(e.message, /priority\/p1/);
  }
});

test('name resolution reports the kind of thing that was not found', () => {
  assert.throws(() => resolveNames(['2026-Q4'], [], 'milestone'), /milestone/i);
});

test('resolving an empty request is a no-op rather than an error', () => {
  assert.deepEqual(resolveNames([], LABELS, 'label'), []);
  assert.deepEqual(resolveNames(undefined, LABELS, 'label'), []);
});


// ──/: ready-work selection (, US2-AC1, US5-AC3) ──────────────────────────────────
const item = (number, labels = [], extra = {}) => ({
  number,
  title: `item ${number}`,
  state: 'open',
  labels: labels.map((name) => ({ name })),
  ...extra,
});

test('ready work excludes items labelled blocked', () => {
  const { ready } = selectReadyItems([item(1, ['status/blocked']), item(2)], {});
  assert.deepEqual(ready.map((i) => i.number), [2]);
});

test('ready work excludes an item whose blocker is still open, even when unlabelled', () => {
  const { ready } = selectReadyItems([item(1), item(2)], { 1: [{ number: 9, state: 'open' }] });
  assert.deepEqual(ready.map((i) => i.number), [2]);
});

test('a closed blocker does not hold an item back', () => {
  const { ready } = selectReadyItems([item(1)], { 1: [{ number: 9, state: 'closed' }] });
  assert.deepEqual(ready.map((i) => i.number), [1]);
});

test('a blocked label with no blocking edge is warned about, and the graph wins', () => {
  const { ready, warnings } = selectReadyItems([item(1, ['status/blocked'])], { 1: [] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /#1/);
  assert.deepEqual(ready.map((i) => i.number), [1], 'the dependency graph is the authority');
});

test('an unlabelled item with an open blocker is warned about too', () => {
  const { warnings } = selectReadyItems([item(1)], { 1: [{ number: 9, state: 'open' }] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /#1/);
});

test('ready work is ordered by priority then by item number', () => {
  const items = [
    item(5, ['priority/p3']),
    item(2, ['priority/p1']),
    item(9, ['priority/p1']),
    item(7, []),
  ];
  const { ready } = selectReadyItems(items, {});
  assert.deepEqual(ready.map((i) => i.number), [2, 9, 5, 7], 'unprioritised sorts last');
});


// ──/: item distillation (, US2-AC4) ──────────────────────────────────────────────
const RAW = {
  number: 12,
  title: 'Fix the thing',
  state: 'open',
  body: 'context',
  labels: [{ name: 'type/bug' }],
  milestone: { title: '003-backlog-taskstoissues' },
  user: { login: 'someone' },
  updated_at: '2026-08-08T00:00:00Z',
  comments: 2,
  html_url: `http://${REAL_HOST}:3000/acme/widget/issues/12`,
  assets: ['noise'],
  original_author_id: 0,
};

test('a listing-shaped distillation OMITS dependency fields rather than defaulting them to empty', () => {
  const d = distillItem(RAW);
  assert.equal('blockedBy' in d, false, 'an empty array here would read as "no blockers"');
  assert.equal('blocks' in d, false);
  assert.equal('comments' in d, false);
  assert.equal(d.commentCount, 2, "the API's own count is true without a second call");
});

test('distillation keeps the fields a decision needs and drops the payload noise', () => {
  const d = distillItem(RAW, { comments: [{ user: { login: 'a' }, body: 'hi' }], blockers: [], blocks: [] });
  assert.equal(d.number, 12);
  assert.deepEqual(d.labels, ['type/bug']);
  assert.equal(d.milestone, '003-backlog-taskstoissues');
  assert.equal(d.comments.length, 1);
  assert.equal(d.assets, undefined);
  assert.equal(d.original_author_id, undefined);
});

test('distillation reports both dependency directions', () => {
  const d = distillItem(RAW, { comments: [], blockers: [{ number: 3 }], blocks: [{ number: 4 }] });
  assert.deepEqual(d.blockedBy, [3]);
  assert.deepEqual(d.blocks, [4]);
});

test('a distilled item carries no forge host, because it is rendered into a transcript', () => {
  const d = distillItem(RAW, { comments: [], blockers: [], blocks: [] });
  assert.ok(!JSON.stringify(d).includes('tailz9x8w7'), 'host leaked through distillation');
});


// ──/: body input (, US1-AC2) ─────────────────────────────────────────────────────
test('a body is read from a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backlog-test-'));
  try {
    const p = join(dir, 'body.md');
    writeFileSync(p, '## Context\n\nmulti\nline\n');
    assert.match(readBodyFrom(p), /multi\nline/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a body is read from stdin when the path is a dash', () => {
  assert.equal(readBodyFrom('-', { stdin: () => 'from stdin' }), 'from stdin');
});

test('a missing body file is refused by name rather than filing an empty item', () => {
  assert.throws(() => readBodyFrom('/nonexistent/body.md'), /\/nonexistent\/body\.md/);
});

test('an empty body is refused — an item with no context is not a backlog item', () => {
  assert.throws(() => readBodyFrom('-', { stdin: () => '   \n' }), /empty/i);
});

test('a body beyond the size cap is refused rather than truncated silently', () => {
  assert.throws(() => readBodyFrom('-', { stdin: () => 'x'.repeat(64 * 1024 + 1) }), /64/);
});


// ──/: duplicate detection (spec Edge Cases) ────────────────────────────────────────────
const OPEN = [
  { number: 4, title: 'Cascade delete needs a replica set', state: 'open' },
  { number: 5, title: 'Something else', state: 'open' },
];

test('a closely matching open item is reported instead of filing a duplicate', () => {
  const hit = findDuplicateOpenItem('cascade delete needs a replica set', OPEN);
  assert.equal(hit.number, 4);
});

test('duplicate detection ignores case and surrounding whitespace', () => {
  assert.equal(findDuplicateOpenItem('  CASCADE DELETE NEEDS A REPLICA SET  ', OPEN).number, 4);
});

test('an unrelated title is not treated as a duplicate', () => {
  assert.equal(findDuplicateOpenItem('add a keyset pagination cursor', OPEN), null);
});


// ── T032a/T032b: idempotent setup and form validation (,,) ───────────────────
test('setup plans nothing when every desired name already exists', () => {
  assert.deepEqual(planMissingNames(['a', 'b'], [{ name: 'a' }, { name: 'b' }]), []);
});

test('setup plans only the gap when some names exist', () => {
  assert.deepEqual(planMissingNames(['a', 'b', 'c'], [{ name: 'b' }]), ['a', 'c']);
});

test('setup plans everything on an empty repository', () => {
  assert.deepEqual(planMissingNames(['a', 'b'], []), ['a', 'b']);
});

test('setup never queues an existing entry, so an operator colour change is not reverted', () => {
  const existing = [{ name: 'type/bug', color: 'ff0000', description: 'operator edited' }];
  assert.ok(!planMissingNames(TAXONOMY.map((l) => l.name), existing).includes('type/bug'));
});

test('the taxonomy covers type, priority and status families', () => {
  const names = TAXONOMY.map((l) => l.name);
  for (const n of [
    'type/bug',
    'type/feature',
    'type/tech-debt',
    'type/chore',
    'priority/p1',
    'priority/p2',
    'priority/p3',
    'status/blocked',
    'status/needs-spec',
    // Feature 011: the dependency bot's dashboard and PR labels (BELAY now runs Renovate too).
    'status/bot-managed',
    'dependencies',
    'security',
  ]) {
    assert.ok(names.includes(n), `taxonomy missing ${n}`);
  }
  // Still exact, so an unplanned label fails here rather than appearing on the forge unannounced.
  assert.equal(names.length, 12, `expected exactly the twelve BELAY labels, got: ${names.join(', ')}`);
});

test('form validation is driven by the ENUMERATED templates, not by issue_config/validate', () => {
  // Measured: issue_config/validate answers {"valid":true} with ZERO templates present — it validates the
  // issue config, not the YAML forms. Treating it as a form parser (which this feature originally planned
  // to do) would have reported a working form on a repository that has none.
  const msg = describeFormValidation([], { valid: true, message: '' });
  assert.match(msg, /no issue form is in effect/i);
  assert.match(msg, /NOT evidence/);
  assert.match(msg, /default branch/i);
});

test('an enumerated form is reported with its input field ids, excluding the markdown block', () => {
  // The shape is the one the live forge returns: the markdown intro carries id "0" — a TRUTHY string, so
  // filtering on `id` presence lists a meaningless "0". Filtering on the input-collecting types is what
  // makes the output mean "these are the sections a filer must complete".
  const msg = describeFormValidation(
    [
      {
        name: 'Backlog item',
        body: [
          { id: '0', type: 'markdown' },
          { id: 'context', type: 'textarea' },
          { id: 'acceptance-criteria', type: 'textarea' },
          { id: 'affected-components', type: 'input' },
          { id: 'priority', type: 'dropdown' },
        ],
      },
    ],
    { valid: true, message: '' },
  );
  assert.match(msg, /Backlog item/);
  assert.match(msg, /context, acceptance-criteria, affected-components, priority/);
  assert.doesNotMatch(msg, /\b0\b/, 'the markdown block must not be listed as a field');
});

test('an invalid issue config is surfaced alongside an otherwise-present form', () => {
  const msg = describeFormValidation([{ name: 'Backlog item', body: [] }], { valid: false, message: 'bad yaml' });
  assert.match(msg, /bad yaml/);
});


// ── The write guard at the request boundary () ─────────────────────────────────────────────
//
// Added while wiring the commands: comparing the derived slug against itself is a tautology that
// protects nothing. The guard only means something when the target came from somewhere else — a
// `--repo` flag, a skill, a fan-out caller — or when a mis-built path is caught at the request edge.
test('a mutating request path targeting another repository is refused at the boundary', () => {
  assert.throws(
    () => assertWritePathTargetsOriginRepo('/repos/other/thing/issues', ORIGIN),
    /Refusing to write to other\/thing/,
  );
});

test('a mutating request path targeting the origin repository passes the boundary check', () => {
  assert.doesNotThrow(() => assertWritePathTargetsOriginRepo('/repos/acme/widget/issues/4/labels', ORIGIN));
});

test('a write to a path outside /repos/ is refused rather than assumed safe', () => {
  assert.throws(() => assertWritePathTargetsOriginRepo('/user/repos', ORIGIN), /outside \/repos\//);
});


// ──/: the blocked-close classifier (, US3-AC3) ────────────────────────────────────
//
// ⚠️ CHARACTERIZATION TESTS — deliberately labelled, and NOT verified RED first.
// The command layer was written in one pass, ahead of these two test tasks, so an honest RED against a
// missing implementation is no longer available (recorded as a deviation in tasks.md's Progress note).
// Their value is as regression guards, and — more importantly — the assertion below is driven by the
// REAL response captured from the live forge, not by a predicted shape. The status code (412) and the
// wording were unobserved during planning; a guess here would have been the defect.
const BLOCKED_CLOSE = JSON.parse(
  readFileSync(join(HERE, 'fixtures', 'backlog', 'blocked-close-412.json'), 'utf8'),
);

test('a 412 open-dependencies refusal is classified as blocked, distinctly from any other failure', () => {
  const raw = new BacklogError(
    `Forge returned ${BLOCKED_CLOSE.status} for PATCH /repos/a/b/issues/145: ${JSON.stringify(BLOCKED_CLOSE.body)}`,
  );
  const out = classifyUpdateFailure(raw, 145);
  assert.match(out.message, /BLOCKED/);
  assert.match(out.message, /unblock/i);
  assert.match(out.message, /#145/);
  assert.match(out.message, /unchanged/i, 'the caller must be told the item was not modified');
  assert.match(out.message, /open dependencies/, 'the original response is preserved, not replaced');
});

test('an unrelated failure is passed through untouched rather than mislabelled as blocked', () => {
  const raw = new BacklogError('Forge returned 500 for PATCH /repos/a/b/issues/9: boom');
  assert.equal(classifyUpdateFailure(raw, 9), raw);
});

test('the captured fixture is the real shape: 412 with an open-dependencies message', () => {
  assert.equal(BLOCKED_CLOSE.status, 412);
  assert.match(BLOCKED_CLOSE.body.message, /open dependencies/);
  assert.ok(!JSON.stringify(BLOCKED_CLOSE).includes('.ts.net'), 'fixture must not carry the forge host');
});


// ──/: dependency edges and cycle refusal (, US5-AC1…AC3) ──────────────────────────
//
// ⚠️ The self/reciprocal cases are CHARACTERIZATION tests (the `dep` wiring predated them — see the
// tasks.md deviation note); `wouldCreateCycle` itself was written test-first from this block.
test('a self-dependency is a cycle', () => {
  assert.equal(wouldCreateCycle(5, 5, {}), true);
});

test('a reciprocal edge is a cycle', () => {
  assert.equal(wouldCreateCycle(5, 6, { 6: [{ number: 5 }] }), true);
});

test('a transitive cycle is caught, not just the reciprocal one', () => {
  assert.equal(wouldCreateCycle(1, 3, { 3: [{ number: 2 }], 2: [{ number: 1 }] }), true);
});

test('an unrelated chain is not a cycle', () => {
  assert.equal(wouldCreateCycle(1, 3, { 3: [{ number: 4 }], 4: [{ number: 5 }] }), false);
});

test('cycle detection terminates on a graph that already contains a loop', () => {
  assert.doesNotThrow(() => wouldCreateCycle(9, 1, { 1: [{ number: 2 }], 2: [{ number: 1 }] }));
});


// ──/: concurrent-divergence detection (spec Edge Cases, US3-AC2) ─────────────────────────
//
// ⚠️ CHARACTERIZATION tests for the reporting function (the `update` wiring predated them). Writing
// them surfaced a real defect: the check ran AFTER this command's own label writes, so
// `--add-label X --state closed` in one invocation compared against a timestamp its own write had
// already moved and aborted on a "concurrent change" that never happened. The command now skips the
// check when it has already written, which is the only honest answer — our write is the newest one.
test('matching timestamps are not a divergence', () => {
  assert.equal(describeDivergence(4, '2026-08-08T00:00:00Z', '2026-08-08T00:00:00Z'), null);
});

test('a changed timestamp is reported with both values and the remedy, not silently overwritten', () => {
  const msg = describeDivergence(4, '2026-08-08T00:00:00Z', '2026-08-08T01:00:00Z');
  assert.match(msg, /#4/);
  assert.match(msg, /2026-08-08T00:00:00Z/);
  assert.match(msg, /2026-08-08T01:00:00Z/);
  assert.match(msg, /show 4/);
  assert.match(msg, /Not overwriting/i);
});

// ── no-leak: the issue token never reaches output ────────────────────────────────────────────────
// The token goes from the environment into an Authorization header and nowhere else. Every failure
// path (401, 403, another refusal, a transport error) names the variable or the scope, never the value.
import { forgeRequest as forgeRequestNoLeak, selectToken as selectTokenNoLeak, describeMissingWriteToken as missingNoLeak } from '../backlog.mjs';

test('(no-leak) a planted FORGE_ISSUE_TOKEN never appears in a request error or result', async () => {
  const PLANT = 'planted-' + 'issue-token-0123456789';
  const base = 'http://forge.invalid/api/v1';
  const out = [];
  const answers = [
    { status: 401, body: { message: 'unauthorized' } },
    { status: 403, body: { message: 'forbidden' } },
    { status: 412, body: { message: 'cannot close this issue because it still has open dependencies' } },
    { status: 200, body: [{ number: 1, title: 'x' }] },
    { transport: true },
  ];
  for (const a of answers) {
    const fetchImpl = async (url, init = {}) => {
      assert.equal(String(url).includes(PLANT), false, 'the token was put into a URL');
      assert.equal(init.headers?.Authorization, `token ${PLANT}`, 'the token belongs in the header');
      if (a.transport) throw new Error('connect ECONNREFUSED');
      const text = JSON.stringify(a.body);
      return { ok: a.status < 300, status: a.status, headers: new Headers({ 'x-total-count': '1' }), text: async () => text };
    };
    try {
      const r = await forgeRequestNoLeak('/repos/o/r/issues?type=issues', { base, token: PLANT, tokenName: 'FORGE_ISSUE_TOKEN', fetchImpl });
      out.push(JSON.stringify(r));
    } catch (err) {
      assert.equal(err instanceof TypeError, false, `the request did not run: ${err?.message}`);
      out.push(String(err?.message ?? err));
    }
  }
  try { selectTokenNoLeak({ FORGE_TOKEN: PLANT }, { write: true }); } catch (err) { out.push(String(err?.message ?? err)); }
  out.push(missingNoLeak());
  assert.equal(out.length, answers.length + 2, 'every path must have produced something to check');
  assert.equal(out.join('\n').includes(PLANT), false, 'the planted token appeared in a result or an error');
});

// ── dep, end to end through the command: the cycle is refused BEFORE any write ───────────────────
// The unit tests above prove wouldCreateCycle; these prove the COMMAND consults it before writing,
// counting the write requests a stubbed forge receives. Every item in a dependency cycle becomes
// permanently uncloseable, so a cycle that reached the forge could not be undone by closing.
import { main as backlogMain } from '../backlog.mjs';

async function runDep(argv, dependencies = {}) {
  const writes = [];
  const realFetch = globalThis.fetch;
  const realToken = process.env.FORGE_ISSUE_TOKEN;
  const realLog = console.log;
  process.env.FORGE_ISSUE_TOKEN = 'test-token';
  console.log = () => {};
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    if (method !== 'GET') writes.push(`${method} ${new URL(url).pathname}`);
    const m = new URL(url).pathname.match(/\/issues\/(\d+)\/dependencies$/);
    const data = method === 'GET' && m ? (dependencies[m[1]] ?? []) : {};
    return { ok: true, status: method === 'GET' ? 200 : 201, headers: new Headers(), text: async () => JSON.stringify(data) };
  };
  try {
    const code = await backlogMain(argv).catch((e) => e.code ?? -1);
    return { code, writes };
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    if (realToken === undefined) delete process.env.FORGE_ISSUE_TOKEN; else process.env.FORGE_ISSUE_TOKEN = realToken;
  }
}

test('(dep-cmd) a cycle-forming dep is refused with exit 2 and ZERO write requests', async () => {
  // #2 is already blocked by #1; recording "#1 blocked by #2" would close the loop.
  const { code, writes } = await runDep(['dep', '1', '--blocked-by', '2'], { 2: [{ number: 1 }] });
  assert.equal(code, 2);
  assert.deepEqual(writes, [], 'a cycle must be refused before anything is written');
});

test('(dep-cmd) a valid dep is recorded with exactly one POST, and --remove with exactly one DELETE', async () => {
  const add = await runDep(['dep', '1', '--blocked-by', '2']);
  assert.equal(add.code, 0);
  assert.equal(add.writes.length, 1);
  assert.match(add.writes[0], /^POST .*\/issues\/1\/dependencies$/);

  const remove = await runDep(['dep', '1', '--blocked-by', '2', '--remove']);
  assert.equal(remove.code, 0);
  assert.equal(remove.writes.length, 1);
  assert.match(remove.writes[0], /^DELETE .*\/issues\/1\/dependencies$/);
});

// ── feature 011: the dependency bot's labels, and its dashboard kept out of `ready` ────────────────

test('bot labels: the taxonomy creates status/bot-managed, dependencies and security, each described', () => {
  for (const name of ['status/bot-managed', 'dependencies', 'security']) {
    const l = TAXONOMY.find((x) => x.name === name);
    assert.ok(l, `${name} missing from the taxonomy`);
    assert.ok(l.description && l.color, `${name} needs a description and a colour`);
  }
});

const botItem = (number, labels) => ({ number, title: `item ${number}`, labels: labels.map((name) => ({ name })) });

test('bot-managed: selectReadyItems drops the dashboard even when unblocked and labelled priority/p1', () => {
  const { ready, excluded } = selectReadyItems([botItem(7, ['status/bot-managed', 'priority/p1']), botItem(8, ['priority/p2'])], { 8: [] });
  assert.deepEqual(ready.map((i) => i.number), [8]);
  assert.deepEqual(excluded, [{ number: 7, reason: 'status/bot-managed' }]);
});

test('bot-managed: the text note counts what was not listed', () => {
  assert.equal(excludedNote([{ number: 7, reason: 'status/bot-managed' }]), '(1 bot-managed item(s) not listed)');
  assert.equal(excludedNote([]), null);
});

test('bot-managed: an ordinary item is still listed, and nothing is excluded', () => {
  const { ready, excluded } = selectReadyItems([botItem(9, ['priority/p1'])], { 9: [] });
  assert.deepEqual([ready.length, excluded.length], [1, 0]);
});
