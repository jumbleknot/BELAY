#!/usr/bin/env node
// Attach the test-result collector to a node --test run by an explicit, opt-in argument (feature 016; research R12).
//
//   node scripts/lib/node-test-with-results.mjs "<results path or empty>" --test <node --test args…>
//
// The Nx targets pdlc:test and pdlc:integration call this with "{args.results}", which Nx makes "" when no --results is
// given (measured 2026-11-28): then it is exactly the node --test it wraps. guardrails passes --results on a push to main,
// so its own run writes one JSON line per test case for the merged commit's outcomes comment (M10: no second run).
//
// NEVER through NODE_OPTIONS (measured, T007: every node child a test starts inherits it, which changed two
// check-coverage tests and interleaved the report). The pair goes right after --test, before any path, because node's
// flags after a path are not flags (AGENTS.md instrument trap); and a reporter given alone replaces the default output
// (measured, T007), so spec to stdout is added when the args name no reporter of their own.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './is-main.mjs';

const COLLECTOR = fileURLToPath(new URL('./collect-test-results.mjs', import.meta.url));

/** The collector's reporter pair for a results path, or [] for none. */
export function resultsReporterArgs(results) {
  if (typeof results !== 'string' || results.trim() === '') return [];
  return [`--test-reporter=${COLLECTOR}`, `--test-reporter-destination=${resolve(results)}`];
}

/** `args` (which start with --test) with the collector attached for `results`, keeping the target's own output. */
export function withResults(args, results) {
  const pair = resultsReporterArgs(results);
  if (pair.length === 0) return [...args];
  if (args[0] !== '--test') throw new Error('node-test-with-results wraps a node --test command: its first argument must be --test');
  const hasReporter = args.some((a) => a.startsWith('--test-reporter='));
  return ['--test', ...pair, ...(hasReporter ? [] : ['--test-reporter=spec', '--test-reporter-destination=stdout']), ...args.slice(1)];
}

if (isMain(import.meta.url)) {
  const [results, ...args] = process.argv.slice(2);
  if (results) mkdirSync(dirname(resolve(results)), { recursive: true });
  const r = spawnSync(process.execPath, withResults(args, results), { stdio: 'inherit' });
  process.exitCode = r.error ? 1 : (r.status ?? 1);
}
