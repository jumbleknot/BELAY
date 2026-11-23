// Tests for .devcontainer/ensure-rtk-hook.sh (feature 004, T030).
// RTK compresses only through the `rtk hook claude` PreToolUse entry; a binary without the hook is
// installed-but-inactive. This script wires the hook idempotently and never damages settings.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsShell } from './shell-probe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, '.devcontainer', 'ensure-rtk-hook.sh');
const needsBash = needsShell('bash', SCRIPT);

function setup({ rtk = true, settings } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'rtk-home-'));
  const bin = join(home, '.claude', 'tools', 'bin');
  mkdirSync(bin, { recursive: true });
  if (rtk) {
    writeFileSync(join(bin, 'rtk'), '#!/usr/bin/env bash\necho rtk 0.0.0\n');
    chmodSync(join(bin, 'rtk'), 0o755);
  }
  const file = join(home, '.claude', 'settings.json');
  if (settings !== undefined) writeFileSync(file, settings);
  return { home, file };
}
const run = ({ home }) => {
  const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  return { code: r.status, log: `${r.stdout}${r.stderr}` };
};
const hookCount = (file) => JSON.stringify(JSON.parse(readFileSync(file, 'utf8')).hooks?.PreToolUse ?? []).split('rtk hook claude').length - 1;

test('no RTK binary → exit 0, settings untouched, and the message names the dotfiles install', needsBash, () => {
  const s = setup({ rtk: false, settings: '{"theme":"dark"}' });
  const r = run(s);
  assert.equal(r.code, 0, r.log);
  assert.equal(readFileSync(s.file, 'utf8'), '{"theme":"dark"}');
  assert.match(r.log, /devcontainer up [\s\S]*--dotfiles-repository/);
  assert.match(r.log, /\/workspaces\/belay/);
});

test('with RTK installed, one Bash PreToolUse hook is wired, and a re-run adds none', needsBash, () => {
  const s = setup({ settings: '{"theme":"dark","hooks":{"PreToolUse":[]}}' });
  assert.equal(run(s).code, 0);
  assert.equal(hookCount(s.file), 1, 'hook not wired');
  const entry = JSON.parse(readFileSync(s.file, 'utf8')).hooks.PreToolUse[0];
  assert.equal(entry.matcher, 'Bash');
  assert.equal(JSON.parse(readFileSync(s.file, 'utf8')).theme, 'dark', 'existing settings must survive');
  run(s);
  assert.equal(hookCount(s.file), 1, 'a second run must not add a duplicate');
});

test('settings.json is backed up before the first write', needsBash, () => {
  const s = setup({ settings: '{"theme":"dark"}' });
  run(s);
  assert.equal(readFileSync(`${s.file}.pre-rtk-hook.bak`, 'utf8'), '{"theme":"dark"}');
});

test('invalid JSON in settings.json is never overwritten', needsBash, () => {
  const s = setup({ settings: '{ not json' });
  const r = run(s);
  assert.equal(r.code, 0, 'must never block container start');
  assert.equal(readFileSync(s.file, 'utf8'), '{ not json');
});

test('a missing settings.json is created with the hook', needsBash, () => {
  const s = setup();
  run(s);
  assert.ok(existsSync(s.file), 'settings.json not created');
  assert.equal(hookCount(s.file), 1);
});
