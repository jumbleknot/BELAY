// THROWAWAY (feature 001 task T026): deliberately fails so the guardrails failure digest can be
// observed live on PR #3. Removed by the next commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('digest probe: deliberate failure #2', () => {
  assert.equal('probe-two', 'expected-value', 'deliberate failure #2 for the live digest check');
});
