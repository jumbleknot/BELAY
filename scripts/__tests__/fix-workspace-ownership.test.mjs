// Tests for .devcontainer/fix-workspace-ownership.sh (feature 004, T022).
// The repair half of the VM-user / container-user uid split (research R6): it must be a no-op on a
// healthy tree, never block start, and always mark the workspace as a git safe.directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsShell } from './shell-probe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, '.devcontainer', 'fix-workspace-ownership.sh');
const needsBash = needsShell('bash', SCRIPT);

const run = (args, home) => {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig') },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('a tree owned by the current user is left alone, and the run exits 0', needsBash, () => {
  const home = mkdtempSync(join(tmpdir(), 'own-home-'));
  const ws = mkdtempSync(join(tmpdir(), 'own-ws-'));
  mkdirSync(join(ws, 'sub'));
  writeFileSync(join(ws, 'sub', 'f.txt'), 'x');
  const r = run([ws], home);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /nothing to repair/);
});

test('a missing workspace is reported and exits 0', needsBash, () => {
  const home = mkdtempSync(join(tmpdir(), 'own-home-'));
  const r = run([join(home, 'no-such-workspace')], home);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /nothing to do/);
});

test('the workspace is added as a git safe.directory', needsBash, () => {
  const home = mkdtempSync(join(tmpdir(), 'own-home-'));
  const ws = mkdtempSync(join(tmpdir(), 'own-ws-'));
  run([ws], home);
  const cfg = join(home, '.gitconfig');
  assert.ok(existsSync(cfg), 'no global gitconfig written');
  assert.match(readFileSync(cfg, 'utf8'), /safe\]/);
});

test('with no argument the default workspace is /workspaces/belay', () => {
  assert.match(readFileSync(SCRIPT, 'utf8'), /\$\{1:-\$\{BELAY_WORKSPACE:-\/workspaces\/belay\}\}/);
});
