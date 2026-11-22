// THROWAWAY (feature 001 task T026): deliberately fails so the guardrails failure digest can be
// observed live on PR #3. Removed by the next commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('digest probe: deliberate failure #1', () => {
  assert.equal('probe-one', 'expected-value', 'deliberate failure #1 for the live digest check');
});
