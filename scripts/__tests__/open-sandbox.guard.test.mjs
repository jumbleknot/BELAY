// Static guard for scripts/open-sandbox.ps1 (feature 004, T023).
//
// CI runs in a Linux container with no pwsh, so the launcher cannot execute there. This pins the
// properties that each cost a session upstream; the behaviour is verified by hand (tasks.md T027).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, 'scripts', 'open-sandbox.ps1');
const raw = () => readFileSync(FILE, 'utf8');
// Code only: the comment-based help and # comments may name things the code must not do.
const code = () => raw().replace(/<#[\s\S]*?#>/g, '').split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

test('defaults target the belay sandbox, workspace and config', () => {
  const c = code();
  assert.match(c, /\[string\]\$Sandbox\s*=\s*'belay'/);
  assert.match(c, /\[string\]\$Workspace\s*=\s*'\/workspaces\/belay'/);
  assert.match(c, /\[string\]\$Config\s*=\s*'\/workspaces\/belay\/\.devcontainer\/devcontainer\.json'/);
});

test('the descriptor keeps VS Code\'s key order, and the URI percent-encodes +', () => {
  const c = code();
  const order = ['"hostPath":', '"localDocker":false', '"configFile":{"$mid":1', '"path":', '"scheme":"vscode-fileHost"'].map((k) => c.indexOf(k));
  assert.ok(order.every((i) => i >= 0), 'descriptor keys missing');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'descriptor key order changed');
  assert.match(c, /dev-container%2B/);
  assert.match(c, /ssh-remote%2B/);
});

test('waits for SSH by deadline, never trusting sbx run\'s exit code alone', () => {
  const c = code();
  assert.match(c, /\$deadlineSeconds\s*=\s*120/);
  assert.match(c, /Stopwatch/);
});

test('restarts with sbx run --name, reads sbx ls as JSON, and never calls sbx start', () => {
  const c = code();
  assert.match(c, /'run', '--name', \$Sandbox, '-d'/);
  assert.match(c, /'ls', '--format', 'json'/);
  assert.doesNotMatch(c, /sbx start/);
});

test('the sbx ls JSON array is unrolled before filtering by name', () => {
  // Windows PowerShell 5.1's ConvertFrom-Json emits a JSON array as ONE pipeline object. Filtering
  // that by name then matches the whole array, `.status` becomes every sandbox's status, and
  // `-eq 'running'` is true when ANY sandbox runs. Measured 2026-11-23 with two sandboxes: the
  // launcher reported a stopped `belay` as "already running" because `mcm` was up.
  const c = code();
  assert.match(c, /ConvertFrom-Json\)\s*\|\s*ForEach-Object\s*\{\s*\$_\s*\}/, 'unroll the parsed array with ForEach-Object { $_ }');
  assert.match(c, /\$entry\.status -eq 'running'/);
});

test('every native call goes through Invoke-Native', () => {
  const lines = code().split('\n');
  const bare = lines.filter((l) => /(^|[\s;(])&\s*(sbx|ssh)\b/.test(l) || /^\s*(sbx|ssh)\s/.test(l));
  assert.deepEqual(bare, [], 'a bare sbx/ssh call bypasses the PowerShell 5.1 stderr trap');
  assert.match(code(), /function Invoke-Native/);
});

test('-PrintOnly exists, and the not-found error names the runbook (US1-AC4)', () => {
  const c = code();
  assert.match(c, /\[switch\]\$PrintOnly/);
  assert.match(c, /if \(\$PrintOnly\)/);
  assert.match(c, /does not exist\.[^"]*docs\/runbooks\/devcontainer\.md/);
});

test('the file is saved with CRLF line endings, as .gitattributes declares for .ps1', () => {
  const text = raw();
  assert.ok(text.includes('\r\n'), 'no CRLF');
  assert.equal(/[^\r]\n/.test(text), false, 'a bare LF line ending');
});
