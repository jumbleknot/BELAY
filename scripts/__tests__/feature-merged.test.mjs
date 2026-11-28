// feature-merged.mjs (feature 016; contracts/feature-merged.md; research R10 to R12, decision M10). Two forms, every
// effect injected (a fake forge, a fake git, a fake counter), no network and no test run:
//   close     on a push to main: the created count from git, the closing comment, the label swap, the close;
//   outcomes  from guardrails' own run on main: the whole suite's passed/failed/skipped/todo per target, as a comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFeatureMerged, findProposalNumbers } from '../feature-merged.mjs';

const MERGE = '9'.repeat(40);
const PARENT = '8'.repeat(40);
const BRANCH = '017-pane-probe';
const SPEC_FOLDER = `specs/${BRANCH}/`;
const spec = (input) => `# Feature Specification: Pane probe\n\n**Feature Branch**: \`${BRANCH}\`\n\n**Input**: User description: "${input}"\n\n## Requirements\n`;
const LABELS = { 'type/proposal': 1, 'status/spec-in-progress': 2, 'status/ready-to-plan': 3, 'status/in-engineering': 4, 'status/merged': 5, 'status/needs-spec': 6, 'priority/p2': 7, 'status/bot-managed': 8 };

function world({ pullApi = true, specText = spec('Proposal #42: Proposal: Pane probe\n\nbody'), issue, comments = [], counts = { [MERGE]: 1730, [PARENT]: 1723 },
  auth = {}, failWrites = false } = {}) {
  const state = { issue: issue ?? { number: 42, state: 'open', labels: [{ name: 'type/proposal' }, { name: 'status/in-engineering' }, { name: 'priority/p2' }] },
    comments: [...comments], writes: [], tokens: [] };
  const request = async (path, { method = 'GET', body, token } = {}) => {
    state.tokens.push(token);
    if (auth[token]) { const e = new Error(`HTTP ${auth[token]}`); e.status = auth[token]; throw e; }
    if (method !== 'GET') {
      if (failWrites) { const e = new Error('transport'); e.status = 0; throw e; }
      state.writes.push({ method, path, body });
    }
    if (method === 'GET' && path.endsWith(`/commits/${MERGE}/pull`)) {
      if (!pullApi) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
      return { number: 77, merged: true, head: { ref: BRANCH } };
    }
    if (method === 'GET' && /\/issues\/42$/.test(path)) return state.issue;
    if (method === 'GET' && /\/issues\/42\/comments/.test(path)) return state.comments;
    if (method === 'GET' && /\/labels/.test(path)) return Object.entries(LABELS).map(([name, id]) => ({ id, name }));
    if (method === 'POST' && /\/comments$/.test(path)) { state.comments.push({ body: body.body }); return { id: 1 }; }
    if (method === 'DELETE' && /\/labels\/\d+$/.test(path)) { const id = Number(path.split('/').pop()); state.issue.labels = state.issue.labels.filter((l) => LABELS[l.name] !== id); return null; }
    if (method === 'POST' && /\/labels$/.test(path)) { for (const id of body.labels) state.issue.labels.push({ name: Object.keys(LABELS).find((n) => LABELS[n] === id) }); return []; }
    if (method === 'PATCH') { state.issue.state = body.state; return state.issue; }
    const e = new Error(`no route ${method} ${path}`); e.status = 404; throw e;
  };
  const git = (args) => {
    const k = args.join(' ');
    if (k === `rev-parse ${MERGE}^1`) return `${PARENT}\n`;
    if (k === `log -1 --format=%s ${MERGE}`) return `Merge pull request 'Feature 017' (#77) from ${BRANCH} into main\n`;
    if (k === `show ${MERGE}:${SPEC_FOLDER}spec.md`) { if (specText === null) throw new Error('no such path'); return specText; }
    throw new Error(`fake git: ${k}`);
  };
  const measure = (rev) => { if (!(rev in counts)) throw new Error(`unknown rev ${rev}`); return counts[rev]; };
  const log = [];
  const fm = createFeatureMerged({ request, git, measure, log: (l) => log.push(l), tokens: { GITHUB_TOKEN: 'run-token', CI_DIGEST_TOKEN: 'digest-token' }, defaultBranch: 'main', repoPath: '/repos/op/BELAY' });
  return { fm, state, log };
}

const CLOSING = `Merged into \`main\` in 9999999 by pull request #77 from branch \`${BRANCH}\`.

Tests created by this feature: 7 test declarations (1723 at 8888888 → 1730 at 9999999; counted by \`scripts/count-repo-metrics.mjs\`).

Suite outcomes follow from this commit's \`guardrails\` run. If none follows, that run was cancelled or did not report.

<!-- pdlc-stage: stage=merged branch=${BRANCH} spec=${SPEC_FOLDER} -->`;

// ── close ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('close: the PR from the API, the proposal from the branch\'s spec, then comment → label swap → close, with the contract text', async () => {
  const w = world();
  assert.equal(await w.fm.close({ sha: MERGE }), 0);
  assert.deepEqual(w.state.writes.map((x) => `${x.method} ${x.path.replace('/repos/op/BELAY', '')}`), [
    'POST /issues/42/comments', 'DELETE /issues/42/labels/4', 'POST /issues/42/labels', 'PATCH /issues/42']);
  assert.equal(w.state.comments.at(-1).body, CLOSING);
  assert.deepEqual(w.state.writes[2].body, { labels: [5] });
  assert.equal(w.state.issue.state, 'closed');
});

test('close: the PR from the merge commit title when the API has none', async () => {
  const w = world({ pullApi: false });
  assert.equal(await w.fm.close({ sha: MERGE }), 0);
  assert.equal(w.state.comments.at(-1).body, CLOSING);
});

test('close: not from a proposal (no spec folder for the branch, or no marker) logs it, writes nothing, exits 0', async () => {
  for (const specText of [null, spec('a plain description')]) {
    const w = world({ specText });
    assert.equal(await w.fm.close({ sha: MERGE }), 0);
    assert.deepEqual(w.state.writes, []);
    assert.match(w.log.join('\n'), /not from a proposal/);
  }
});

test('close: two different Proposal markers is ambiguous: a warning, nothing written, exit 0', async () => {
  const w = world({ specText: spec('Proposal #42: x and Proposal #43: y') });
  assert.equal(await w.fm.close({ sha: MERGE }), 0);
  assert.deepEqual(w.state.writes, []);
  assert.match(w.log.join('\n'), /more than one proposal/i);
});

test('close: an issue that is not an open proposal, or is bot-managed, is left alone (exit 0)', async () => {
  for (const issue of [
    { number: 42, state: 'closed', labels: [{ name: 'type/proposal' }, { name: 'status/in-engineering' }] },
    { number: 42, state: 'open', labels: [{ name: 'type/feature' }] },
    { number: 42, state: 'open', labels: [{ name: 'type/proposal' }, { name: 'status/bot-managed' }] },
  ]) {
    const w = world({ issue });
    assert.equal(await w.fm.close({ sha: MERGE }), 0);
    assert.deepEqual(w.state.writes, []);
  }
});

test('close: a stage skipped (the VS Code route, straight from spec in progress) still closes (spec Edge Cases)', async () => {
  const w = world({ issue: { number: 42, state: 'open', labels: [{ name: 'type/proposal' }, { name: 'status/spec-in-progress' }] } });
  assert.equal(await w.fm.close({ sha: MERGE }), 0);
  assert.equal(w.state.issue.state, 'closed');
});

test('close: created may be negative; an unreadable parent is "unknown (<reason>)", never 0 (FR-039)', async () => {
  const neg = world({ counts: { [MERGE]: 1700, [PARENT]: 1723 } });
  await neg.fm.close({ sha: MERGE });
  assert.match(neg.state.comments.at(-1).body, /Tests created by this feature: -23 test declarations \(1723 at 8888888 → 1700 at 9999999;/);
  const unk = world({ counts: { [MERGE]: 1730 } });
  assert.equal(await unk.fm.close({ sha: MERGE }), 0);
  const body = unk.state.comments.at(-1).body;
  assert.match(body, /Tests created by this feature: unknown \(the parent commit 8888888 could not be counted: /);
  assert.doesNotMatch(body, /: 0 test declarations/);
  assert.equal(unk.state.issue.state, 'closed', 'a missing count never blocks the close');
});

test('close: idempotent: a closing comment for this merge already posted means no second comment; the swap and close complete', async () => {
  const w = world({ comments: [{ body: CLOSING }] });
  assert.equal(await w.fm.close({ sha: MERGE }), 0);
  assert.equal(w.state.comments.length, 1);
  assert.deepEqual(w.state.writes.map((x) => x.method), ['DELETE', 'POST', 'PATCH']);
});

test('close: the run token first; CI_DIGEST_TOKEN only when the run token is refused (401/403) (R11)', async () => {
  const ok = world();
  await ok.fm.close({ sha: MERGE });
  assert.ok(ok.state.tokens.every((t) => t === 'run-token'));
  const refused = world({ auth: { 'run-token': 403 } });
  assert.equal(await refused.fm.close({ sha: MERGE }), 0);
  assert.ok(refused.state.tokens.includes('digest-token'));
  assert.equal(refused.state.issue.state, 'closed');
});

test('close: --dry-run prints the comment and the label change, and writes nothing', async () => {
  const w = world();
  assert.equal(await w.fm.close({ sha: MERGE, dryRun: true }), 0);
  assert.deepEqual(w.state.writes, []);
  assert.ok(w.log.join('\n').includes(CLOSING));
  assert.match(w.log.join('\n'), /status\/in-engineering → status\/merged/);
});

test('close: a write that fails exits 1 (the digest reports it; a re-run is safe)', async () => {
  const w = world({ failWrites: true });
  assert.equal(await w.fm.close({ sha: MERGE }), 1);
});

// ── outcomes ──────────────────────────────────────────────────────────────────────────────────────────────────

const report = (rows) => rows.map(([outcome, n]) => Array.from({ length: n }, (_, i) => JSON.stringify({ file: 'f', name: `${outcome}${i}`, outcome })).join('\n')).filter(Boolean).join('\n') + '\n';
const TARGETS = [{ target: 'scripts:test', report: 'scripts-test.jsonl' }, { target: 'pdlc:test', report: 'pdlc-test.jsonl' }, { target: 'pdlc:integration', report: 'pdlc-integration.jsonl' }];

function reportsDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'outcomes-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('outcomes: per-target passed, failed, skipped and todo from the reports, whole suite, with the trailer; no label, no close', async () => {
  const r = reportsDir({ 'scripts-test.jsonl': report([['pass', 3], ['skip', 1]]), 'pdlc-test.jsonl': report([['pass', 2], ['fail', 1], ['todo', 1]]), 'pdlc-integration.jsonl': report([['pass', 4]]) });
  try {
    const w = world();
    assert.equal(await w.fm.outcomes({ sha: MERGE, dir: r.dir, jobStatus: 'success', targets: TARGETS }), 0);
    assert.deepEqual(w.state.writes.map((x) => x.method), ['POST']);
    assert.equal(w.state.comments.at(-1).body, `Suite outcomes for \`main\` at 9999999 (whole suite, executed test cases, from this commit's \`guardrails\` run):

| Target | Passed | Failed | Skipped | Todo |
| --- | ---: | ---: | ---: | ---: |
| scripts:test | 3 | 0 | 1 | 0 |
| pdlc:test | 2 | 1 | 0 | 1 |
| pdlc:integration | 4 | 0 | 0 | 0 |

<!-- pdlc-outcomes: sha=${MERGE} -->`);
  } finally { r.cleanup(); }
});

test('outcomes: a missing or unparsable report is a row of unknown with its reason, never 0; a cancelled run says so', async () => {
  const r = reportsDir({ 'scripts-test.jsonl': report([['pass', 3]]), 'pdlc-test.jsonl': 'not json\n' });
  try {
    const w = world();
    assert.equal(await w.fm.outcomes({ sha: MERGE, dir: r.dir, jobStatus: 'cancelled', targets: TARGETS }), 0);
    const body = w.state.comments.at(-1).body;
    assert.match(body, /\| pdlc:test \| unknown \| unknown \| unknown \| unknown \|/);
    assert.match(body, /\| pdlc:integration \| unknown \| unknown \| unknown \| unknown \|/);
    assert.match(body, /pdlc:test: unknown \(the report is unparsable/);
    assert.match(body, /pdlc:integration: unknown \(no report: the step did not run\)/);
    assert.match(body, /Run cancelled by a later push; counts may be partial\./);
  } finally { r.cleanup(); }
});

test('outcomes: idempotent by its trailer; not from a proposal posts nothing; a failed write still exits 0', async () => {
  const r = reportsDir({ 'scripts-test.jsonl': report([['pass', 1]]) });
  try {
    const again = world({ comments: [{ body: `x\n\n<!-- pdlc-outcomes: sha=${MERGE} -->` }] });
    assert.equal(await again.fm.outcomes({ sha: MERGE, dir: r.dir, jobStatus: 'success', targets: TARGETS }), 0);
    assert.deepEqual(again.state.writes, []);
    const none = world({ specText: null });
    assert.equal(await none.fm.outcomes({ sha: MERGE, dir: r.dir, jobStatus: 'success', targets: TARGETS }), 0);
    assert.deepEqual(none.state.writes, []);
    const failing = world({ failWrites: true });
    assert.equal(await failing.fm.outcomes({ sha: MERGE, dir: r.dir, jobStatus: 'success', targets: TARGETS }), 0);
    assert.match(failing.log.join('\n'), /warning/i);
  } finally { r.cleanup(); }
});

// ── the parts shared with backlog.mjs record-tests, and the rule that nothing runs tests ───────────────────────

test('findProposalNumbers reads only the **Input** line, distinct numbers in order', () => {
  assert.deepEqual(findProposalNumbers(spec('Proposal #42: Proposal: x')), [42]);
  assert.deepEqual(findProposalNumbers(spec('Proposal #42 and again Proposal #42')), [42]);
  assert.deepEqual(findProposalNumbers(`${spec('plain')}\n- see Proposal #9 elsewhere\n`), []);
  assert.deepEqual(findProposalNumbers(spec('Proposal #42 and Proposal #43')), [42, 43]);
});

test('neither form runs a test: the script spawns no nx and no node --test (M10)', () => {
  const src = readFileSync(new URL('../feature-merged.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /['"`]nx['"`]|pnpm|['"`]--test['"`]/);
});
