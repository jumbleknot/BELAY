// A fixture test file for collect-test-results.test.mjs: one of each outcome, nested by describe and by t.test.
// Named *.fixture.mjs so scripts:test never runs it directly.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

test('passes', () => {});
test('fails', () => { assert.equal(1, 2); });
test('is skipped', { skip: 'not today' }, () => {});
test('is todo', { todo: 'later' }, () => {});
describe('a suite', () => {
  test('inner passes', () => {});
});
test('outer', async (t) => {
  await t.test('sub passes', () => {});
});
