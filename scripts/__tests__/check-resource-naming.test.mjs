// Tests for scripts/check-resource-naming.mjs — the compose resource naming grammar.
//
// The grammar's naming CONTEXTS are the project directories under `backend/`, `frontend/`, `agents/`
// and `mcp-servers/`, so a new project is admitted by creating its directory, never by editing the
// gate. These tests pin that derivation and each rule: `<context>-<role>-<engine>-data` volumes (and
// the `-logs` / `-snapshots` forms), `-network` networks, no compose-project underscore, and
// `container_name` equal to its service key.
//
// Runs in CI under `pnpm nx run scripts:test`: offline, token-free, node built-ins only. Each scan runs
// against a throwaway git repository (a fixture monorepo) through the `--dir <root>` seam.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-resource-naming.mjs');
const run = (...args) => spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });

const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A fixture monorepo: `backend/foo-service/` plus `files` (path → text), all tracked. */
function monorepo(files = {}, { projects = ['backend/foo-service'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'resource-naming-'));
  made.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const all = { 'backend/.gitkeep': '', 'frontend/.gitkeep': '', ...files };
  for (const p of projects) all[`${p}/README.md`] = 'project\n';
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

const GOOD = [
  'services:',
  '  foo-service:',
  '    container_name: foo-service',
  '    networks: [foo-service-network]',
  '  foo-service-store-postgres:',
  '    container_name: foo-service-store-postgres',
  'volumes:',
  '  pgdata:',
  '    name: foo-service-store-postgres-data',
  '  logs:',
  '    name: foo-service-trace-logs',
  '  snaps:',
  '    name: foo-service-search-snapshots',
  'networks:',
  '  foo-service-network:',
  '    name: foo-service-network',
  '',
].join('\n');

test('a compose file that follows the grammar for an existing project passes', () => {
  const r = run('--dir', monorepo({ 'compose.yaml': GOOD }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\b1 compose file\(s\) scanned/);
});

test('a volume for an unknown context fails, naming the file, line and token', () => {
  const compose = 'volumes:\n  data:\n    name: billing-store-postgres-data\n';
  const r = run('--dir', monorepo({ 'compose.yaml': compose }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^compose\.yaml:3: volume-grammar: .*billing-store-postgres-data/m);
});

test('a container whose identifier has an unknown context fails', () => {
  const compose = 'services:\n  billing:\n    container_name: billing\n';
  const r = run('--dir', monorepo({ 'compose.yaml': compose }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^compose\.yaml:3: identifier-grammar: .*billing/m);
});

test('an underscore (compose-project-prefixed) name fails', () => {
  const compose = 'volumes:\n  data:\n    name: belay_foo-service-store-postgres-data\n';
  const r = run('--dir', monorepo({ 'compose.yaml': compose }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^compose\.yaml:3: compose-prefix: .*belay_foo-service/m);
});

test('a network whose name does not end in -network fails, external networks included', () => {
  const compose = 'networks:\n  a:\n    name: foo-service-net\n  shared-edge:\n    external: true\n';
  const r = run('--dir', monorepo({ 'compose.yaml': compose }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^compose\.yaml:3: network-grammar: .*foo-service-net\b/m);
  assert.match(r.stderr, /^compose\.yaml:\d+: network-grammar: .*shared-edge/m);
});

test('a container_name that differs from its service key fails', () => {
  const compose = 'services:\n  foo-service:\n    container_name: foo-service-app\n';
  const r = run('--dir', monorepo({ 'compose.yaml': compose }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^compose\.yaml:3: container-name-mismatch: .*foo-service-app/m);
});

test('adding agents/bar/ admits bar-* without editing the gate', () => {
  const compose = 'services:\n  bar:\n    container_name: bar\nvolumes:\n  d:\n    name: bar-memory-redis-data\n';
  assert.equal(run('--dir', monorepo({ 'compose.yaml': compose })).status, 1, 'bar-* is unknown before the directory exists');
  const r = run('--dir', monorepo({ 'compose.yaml': compose }, { projects: ['backend/foo-service', 'agents/bar'] }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('every tracked compose file in the tree is scanned, wherever it lives', () => {
  const r = run('--dir', monorepo({
    'compose.yaml': GOOD,
    'backend/foo-service/compose.dev.yml': 'volumes:\n  d:\n    name: nope-data\n',
  }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^backend\/foo-service\/compose\.dev\.yml:3: volume-grammar: /m);
  assert.match(r.stderr, /\b2 compose file\(s\) scanned/);
});

test('zero compose files passes and prints a scanned count of 0', () => {
  const r = run('--dir', monorepo());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\b0 compose file\(s\) scanned/);
});

test('--section limits the rules that run', () => {
  const dir = monorepo({ 'compose.yaml': 'networks:\n  a:\n    name: foo-service-net\n' });
  assert.equal(run('--dir', dir, '--section=volumes').status, 0);
  assert.equal(run('--dir', dir, '--section=volumes,networks').status, 1);
});

test('an unparseable compose file is an error (exit 2), never a silent pass', () => {
  const r = run('--dir', monorepo({ 'compose.yaml': 'services: [unclosed\n' }));
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test('the exported lists start empty and the grammar is derived, not listed', async () => {
  const gate = await import('../check-resource-naming.mjs');
  assert.deepEqual([...gate.INFRASTRUCTURE_CONTEXTS], []);
  assert.deepEqual([...gate.VENDOR_BUNDLES], []);
  assert.deepEqual([...gate.RETIRED_KEYS], []);
  assert.deepEqual([...gate.APPROVED_NETWORKS], []);
});

test('--selftest passes; --help exits 0; an unknown flag, an unknown section and a bare --dir exit 2', () => {
  assert.equal(run('--selftest').status, 0);
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage/);
  assert.equal(run('--bogus').status, 2);
  assert.equal(run('--section=ollama').status, 2);
  assert.equal(run('--dir').status, 2);
});

test('the real tree passes', () => {
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /compose file\(s\) scanned/);
});
