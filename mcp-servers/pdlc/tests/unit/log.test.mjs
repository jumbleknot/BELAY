// The JSON-lines stderr logger (research R17). Stdout belongs to the MCP protocol, so nothing is ever
// written there, and every line passes through the redactor at the point of logging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/log.mjs';
import { createRedactor } from '../../src/redact.mjs';

const CANARY = 'canary-0123456789abcdef0123456789abcdef';
const FIXED = new Date('2026-11-25T10:00:00.000Z');

function capture(opts = {}) {
  const lines = [];
  const stream = { write: (s) => { lines.push(s); return true; } };
  const log = createLogger({ stream, redact: createRedactor({ secrets: [CANARY] }), clock: () => FIXED, ...opts });
  return { log, lines, parsed: () => lines.map((l) => JSON.parse(l)) };
}

test('a log line is one JSON object per line with the required fields', () => {
  const { log, lines, parsed } = capture();
  log.info('created proposal', { correlation_id: 7, tool: 'create_proposal', repo: 'BELAY', number: 12 });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith('\n'));
  assert.equal(lines[0].trim().split('\n').length, 1);
  assert.deepEqual(parsed()[0], {
    ts: '2026-11-25T10:00:00.000Z', level: 'INFO', service: 'pdlc', correlation_id: 7,
    tool: 'create_proposal', repo: 'BELAY', number: 12, msg: 'created proposal',
  });
});

test('repo and number are optional; correlation_id and tool default to null', () => {
  const { log, parsed } = capture();
  log.warn('starting');
  assert.deepEqual(parsed()[0], { ts: FIXED.toISOString(), level: 'WARN', service: 'pdlc', correlation_id: null, tool: null, msg: 'starting' });
});

test('every line is redacted at the point of logging', () => {
  const { log, lines } = capture();
  log.error(`forge said no to ${CANARY}`, { tool: 'list_repos', detail: { header: `Authorization: token ${CANARY}` } });
  assert.doesNotMatch(lines.join(''), /canary-/);
});

test('nothing is written to stdout', (t) => {
  const writes = [];
  t.mock.method(process.stdout, 'write', (s) => { writes.push(s); return true; });
  const { log } = capture();
  log.info('x');
  log.audit({ correlation_id: 1, tool: 'list_repos', decision: 'allowed', outcome: 'ok' });
  t.mock.restoreAll();
  assert.deepEqual(writes, []);
});

test('levels below the configured one are dropped', () => {
  const { log, parsed } = capture({ level: 'WARN' });
  log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
  assert.deepEqual(parsed().map((l) => l.level), ['WARN', 'ERROR']);
});

test('audit writes exactly one event:"audit" line with the R17 fields', () => {
  const { log, parsed } = capture();
  log.audit({ correlation_id: 3, tool: 'update_proposal', repo: 'BELAY', number: 9, decision: 'refused', code: 'stale', outcome: 'refused: stale' });
  const lines = parsed();
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    ts: FIXED.toISOString(), level: 'INFO', service: 'pdlc', event: 'audit', correlation_id: 3,
    tool: 'update_proposal', repo: 'BELAY', number: 9, decision: 'refused', code: 'stale', outcome: 'refused: stale',
  });
});

test('audit is emitted even when a higher log level is configured', () => {
  const { log, parsed } = capture({ level: 'ERROR' });
  log.info('dropped');
  log.audit({ correlation_id: 1, tool: 'list_repos', decision: 'allowed', outcome: 'ok' });
  assert.deepEqual(parsed().map((l) => l.event ?? l.msg), ['audit']);
});

test('audit rejects a record carrying a body or section text, and writes nothing', () => {
  const { log, lines } = capture();
  for (const extra of [{ body: 'the proposal' }, { sections: { problem: 'x' } }, { text: 'x' }, { comment: 'x' }]) {
    assert.throws(() => log.audit({ correlation_id: 1, tool: 'create_proposal', decision: 'allowed', outcome: 'ok', ...extra }), TypeError);
  }
  assert.deepEqual(lines, []);
});

test('audit requires a decision of allowed or refused', () => {
  const { log } = capture();
  assert.throws(() => log.audit({ correlation_id: 1, tool: 'x', decision: 'maybe', outcome: 'ok' }), TypeError);
});

test('a failing stream never crashes an ordinary log call', () => {
  const log = createLogger({ stream: { write: () => { throw new Error('EPIPE'); } }, redact: (x) => x });
  assert.doesNotThrow(() => log.info('x'));
});

test('016: an audit line may name the feature branch a spec tool acted on, and still never carries spec text', () => {
  const { log, parsed, lines } = capture();
  log.audit({ correlation_id: 4, tool: 'start_spec', repo: 'BELAY', number: 91, branch: '017-pane-probe', decision: 'allowed', outcome: 'ok' });
  assert.equal(parsed()[0].branch, '017-pane-probe');
  for (const extra of [{ content: '# spec' }, { files: [] }, { path: 'spec.md' }]) {
    assert.throws(() => log.audit({ correlation_id: 5, tool: 'write_spec_file', decision: 'allowed', outcome: 'ok', ...extra }), TypeError);
  }
  assert.equal(lines.length, 1);
});
