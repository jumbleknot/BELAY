// Tests for .devcontainer/persist-claude-config.sh (feature 004, T029).
// CLAUDE_CONFIG_DIR moves ~/.claude.json onto the belay-claude volume; this script carries an
// existing config across ONCE, without a symlink (Claude Code replaces the file by rename, which
// would silently swap a symlink back to a plain overlay file).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsShell } from './shell-probe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, '.devcontainer', 'persist-claude-config.sh');
const needsBash = needsShell('bash', SCRIPT);

function setup({ volume = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'claude-home-'));
  const dir = join(home, '.claude');
  if (volume) mkdirSync(join(dir, 'backups'), { recursive: true });
  return { home, dir, target: join(dir, '.claude.json'), legacy: join(home, '.claude.json') };
}
const run = ({ home, dir }) => {
  const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: dir } });
  return { code: r.status, log: `${r.stdout}${r.stderr}` };
};

test('no config volume → exit 0 and nothing created', needsBash, () => {
  const s = setup({ volume: false });
  const r = run(s);
  assert.equal(r.code, 0, r.log);
  assert.equal(existsSync(s.target), false);
});

test('an existing valid target is left untouched', needsBash, () => {
  const s = setup();
  writeFileSync(s.target, '{"keep":true}');
  writeFileSync(s.legacy, '{"keep":false}');
  run(s);
  assert.equal(readFileSync(s.target, 'utf8'), '{"keep":true}');
});

test('a legacy ~/.claude.json is copied (not moved) onto the volume, as a regular file', needsBash, () => {
  const s = setup();
  writeFileSync(s.legacy, '{"oauthAccount":{"x":1}}');
  const r = run(s);
  assert.equal(r.code, 0, r.log);
  assert.ok(existsSync(s.target), 'target not created');
  assert.equal(readFileSync(s.target, 'utf8'), '{"oauthAccount":{"x":1}}');
  assert.ok(existsSync(s.legacy), 'the legacy file must be copied, not moved');
  assert.equal(lstatSync(s.target).isSymbolicLink(), false);
});

test('with no legacy file, the newest PARSEABLE backup is restored', needsBash, () => {
  const s = setup();
  const older = join(s.dir, 'backups', '.claude.json.backup.1');
  const newerBroken = join(s.dir, 'backups', '.claude.json.backup.2');
  writeFileSync(older, '{"from":"older-valid"}');
  writeFileSync(newerBroken, '{ this is not json');
  utimesSync(older, new Date(2026, 0, 1), new Date(2026, 0, 1));
  utimesSync(newerBroken, new Date(2026, 5, 1), new Date(2026, 5, 1));
  const r = run(s);
  assert.equal(r.code, 0, r.log);
  assert.ok(existsSync(s.target), 'target not created');
  assert.equal(readFileSync(s.target, 'utf8'), '{"from":"older-valid"}');
});

test('nothing to carry over → exit 0, and no file invented', needsBash, () => {
  const s = setup();
  const r = run(s);
  assert.equal(r.code, 0, r.log);
  assert.equal(existsSync(s.target), false);
  assert.match(r.log, /no existing config/);
});
