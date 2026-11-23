// Tests for the topology-scrub gate (scripts/check-topology-scrub.mjs).
//
// Runs in CI under `pnpm nx run scripts:test`, so it stays deterministic, offline and token-free:
// every tree scan runs against a throwaway git repository built in a temp dir, through the gate's
// `--dir <root>` seam, never against this checkout.
//
// A REAL-shaped tailnet host is assembled from fragments at run time, so no contiguous `.ts.net`
// literal of a non-placeholder host appears in this file — otherwise the gate would (correctly) fail
// on its own test. Do not "tidy" these into single strings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-topology-scrub.mjs');

const tsNetHost = (label) => label + '.ts' + '.net';
const REAL_HOST = tsNetHost('beelink.tailz9x8w7');

const run = (...args) => spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });

/** A git repository holding `files` (path → text), all tracked. Caller removes it. */
function fixtureRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'topology-scrub-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

test('placeholder tailnet hosts pass the tree scan', () => {
  const dir = fixtureRepo({
    'notes.md': [
      'server.tailnet.ts.net:3000',
      'forge.tailnet-example.ts.net',
      'example-host.ts.net',
      'beelink.<tailnet>.ts.net',
    ].join('\n'),
  });
  try {
    const r = run('--dir', dir);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real-shaped tailnet host fails the scan and is named with its file and line', () => {
  const dir = fixtureRepo({ 'clean.md': 'nothing here\n', 'leak.env': `A=1\nREGISTRY_HOST=${REAL_HOST}:3000\n` });
  try {
    const r = run('--dir', dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(`leak.env:2:`), `finding should name leak.env:2 — got:\n${r.stderr}`);
    assert.ok(r.stderr.includes(REAL_HOST), 'finding should name the offending host');
    assert.equal(r.stderr.includes('clean.md'), false, 'a clean file must not be reported');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an untracked file is outside the scan', () => {
  const dir = fixtureRepo({ 'clean.md': 'ok\n' });
  try {
    writeFileSync(join(dir, 'untracked.md'), REAL_HOST + '\n');
    assert.equal(run('--dir', dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--selftest exits 0', () => {
  const r = run('--selftest');
  assert.equal(r.status, 0, r.stderr);
});

test('--help exits 0 and prints usage', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage/);
});

test('an unknown flag exits 2', () => {
  assert.equal(run('--no-such-flag').status, 2);
});

test('--dir without a value exits 2', () => {
  assert.equal(run('--dir').status, 2);
});
