// collect-test-results.mjs: a node:test reporter that writes one JSON line per test case (feature 016; research R12,
// decision M10). guardrails attaches it to its own test run on a push to main, through each target's opt-in results
// argument (never NODE_OPTIONS: measured, T007, that leaks into the child node processes tests start). The merged
// commit's outcomes are then counted from that run, with no second test run.
//
//   { "file": "<path from the repository root>", "name": "<outer > inner > test>", "outcome": "pass|fail|skip|todo" }
//
// A suite (describe) is not a test case. Skipped and todo cases are their own outcomes and never counted as passed.
import { relative } from 'node:path';

const ROOT = process.cwd();
const OUTCOMES = new Set(['pass', 'fail', 'skip', 'todo']);

export default async function* collectTestResults(source) {
  const stacks = new Map(); // file → names by nesting level, from test:start
  for await (const event of source) {
    const data = event.data ?? {};
    const file = data.file ? relative(ROOT, data.file).split('\\').join('/') : '';
    if (event.type === 'test:start') {
      const stack = stacks.get(file) ?? [];
      stack.length = data.nesting;
      stack[data.nesting] = data.name;
      stacks.set(file, stack);
      continue;
    }
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    if (data.details?.type === 'suite') continue;
    const stack = [...(stacks.get(file) ?? [])].slice(0, data.nesting);
    const name = [...stack, data.name].join(' > ');
    const outcome = data.todo !== undefined ? 'todo' : data.skip !== undefined ? 'skip' : event.type === 'test:fail' ? 'fail' : 'pass';
    yield `${JSON.stringify({ file, name, outcome })}\n`;
  }
}

/** { passed, failed, skipped, todo } from one report's text. Throws on any line it cannot read (FR-039: never a guess). */
export function summarise(text) {
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0 };
  const key = { pass: 'passed', fail: 'failed', skip: 'skipped', todo: 'todo' };
  for (const [i, line] of String(text).split('\n').entries()) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`report line ${i + 1} is unparsable`); }
    if (!OUTCOMES.has(row?.outcome)) throw new Error(`report line ${i + 1} is unparsable: outcome ${JSON.stringify(row?.outcome)}`);
    counts[key[row.outcome]] += 1;
  }
  return counts;
}
