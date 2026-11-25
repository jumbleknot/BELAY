// The redactor: every sink (log lines, tool results, errors) passes through it, so the token never
// leaves the process except in the Authorization header and the git child environment (FR-018, SC-008).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor, REDACTED } from '../../src/redact.mjs';

const CANARY = 'canary-0123456789abcdef0123456789abcdef';
const redact = createRedactor({ secrets: [CANARY] });

test('the configured token is removed from a string, wherever it appears', () => {
  const out = redact(`failed with ${CANARY} in the middle and ${CANARY}`);
  assert.doesNotMatch(out, /canary-/);
  assert.equal(out, `failed with ${REDACTED} in the middle and ${REDACTED}`);
});

test('the token is removed from nested objects and arrays, and the input is not mutated', () => {
  const input = { a: { b: [`x ${CANARY}`, { c: CANARY }] }, n: 3, ok: true, none: null };
  const out = redact(input);
  assert.doesNotMatch(JSON.stringify(out), /canary-/);
  assert.deepEqual(out, { a: { b: [`x ${REDACTED}`, { c: REDACTED }] }, n: 3, ok: true, none: null });
  assert.equal(input.a.b[1].c, CANARY);
});

test('Authorization values are removed: token, Bearer and Basic schemes, in any case', () => {
  for (const text of [
    'Authorization: token abcdef0123456789',
    'authorization: Bearer abc.def-ghi_jkl',
    'AUTHORIZATION: basic dXNlcjpwYXNz',
    '{"Authorization":"token abcdef0123456789"}',
    'http.extraHeader=Authorization: token abcdef0123456789',
  ]) {
    const out = redact(text);
    assert.doesNotMatch(out, /abcdef0123456789|abc\.def-ghi_jkl|dXNlcjpwYXNz/, text);
    assert.match(out, /\[REDACTED\]/, text);
  }
});

test('a bare "Bearer <value>" is removed', () => {
  assert.equal(redact('sent Bearer eyJhbGciOi.x.y'), `sent Bearer ${REDACTED}`);
});

test('a key named authorization (any case) has its whole value removed', () => {
  assert.deepEqual(redact({ headers: { Authorization: 'whatever-value', accept: 'json' } }),
    { headers: { Authorization: REDACTED, accept: 'json' } });
});

test('URL userinfo is removed and the rest of the URL is kept', () => {
  assert.equal(redact('clone https://someone:pa55@forge.example/o/r.git failed'),
    `clone https://${REDACTED}@forge.example/o/r.git failed`);
  assert.equal(redact('http://only-user@forge.example/x'), `http://${REDACTED}@forge.example/x`);
});

test('an empty secret is ignored rather than redacting everything', () => {
  const r = createRedactor({ secrets: ['', '   ', undefined] });
  assert.equal(r('plain text'), 'plain text');
});

test('an Error is turned into its redacted message, never its stack', () => {
  const out = redact(new Error(`boom ${CANARY}`));
  assert.equal(out, `boom ${REDACTED}`);
});
