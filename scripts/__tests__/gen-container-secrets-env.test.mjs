// Tests for .devcontainer/gen-container-secrets-env.sh (feature 004, T028).
// Contract: specs/004-devcontainer-sandbox/contracts/cli.md. Rules: data-model.md, Container
// secrets file. The output is passed to `docker run --env-file`, which does NO quote processing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsShell } from './shell-probe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, '.devcontainer', 'gen-container-secrets-env.sh');
const needsBash = needsShell('bash', SCRIPT);

const READ_TOKEN = 'rt-0123 value';            // contains a space: proves no quoting is emitted
const ISSUE_TOKEN = 'line-one\nline-two';     // contains a newline: must be refused

function run(source) {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-env-'));
  const src = join(dir, 'sandbox-env');
  const out = join(dir, 'secrets.env');
  if (source !== null) writeFileSync(src, source);
  const env = { ...process.env, BELAY_SANDBOX_ENV_FILE: src, BELAY_CONTAINER_SECRETS_ENV: out };
  for (const k of ['FORGE_TOKEN', 'FORGE_ISSUE_TOKEN', 'ANTHROPIC_API_KEY']) delete env[k];
  const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env });
  return { code: r.status, log: `${r.stdout}${r.stderr}`, out, text: existsSync(out) ? readFileSync(out, 'utf8') : null };
}

const SOURCE = [
  `FORGE_TOKEN='${READ_TOKEN}'`,
  `FORGE_ISSUE_TOKEN='${ISSUE_TOKEN}'`,
  "ANTHROPIC_API_KEY='must-never-be-forwarded'",
  "BELAY_DEVCONTAINER_IMAGE='forge.example.test/owner/belay-devcontainer@sha256:abc'",
  '',
].join('\n');

test('writes bare KEY=value lines, unquoted, for the forge read token', needsBash, () => {
  const r = run(SOURCE);
  assert.equal(r.code, 0, r.log);
  assert.ok(r.text.split('\n').includes(`FORGE_TOKEN=${READ_TOKEN}`), `missing FORGE_TOKEN=${READ_TOKEN}`);
  assert.doesNotMatch(r.text, /FORGE_TOKEN='/);
});

test('a value with a newline is skipped, naming only the variable', needsBash, () => {
  const r = run(SOURCE);
  assert.doesNotMatch(r.text, /FORGE_ISSUE_TOKEN=/);
  assert.match(r.log, /FORGE_ISSUE_TOKEN/);
});

test('only the two forge tokens are ever written: never ANTHROPIC_API_KEY, never the pin', needsBash, () => {
  const r = run(SOURCE);
  const keys = r.text.split('\n').filter(Boolean).map((l) => l.split('=')[0]);
  assert.deepEqual(keys, ['FORGE_TOKEN']);
});

test('the output file is mode 600', needsBash, (t) => {
  if (process.platform === 'win32') return t.skip('POSIX file modes are not representable on Windows; CI (Linux) runs this');
  const r = run(SOURCE);
  assert.equal(statSync(r.out).mode & 0o777, 0o600);
});

test('logs name variables and lengths, never values', needsBash, () => {
  const r = run(SOURCE);
  assert.equal(r.log.includes(READ_TOKEN), false, 'a credential value reached the log');
  assert.equal(r.log.includes('line-one'), false);
  assert.equal(r.log.includes('must-never-be-forwarded'), false);
  assert.match(r.log, /FORGE_TOKEN \(\d+ chars\)/);
});

test('a missing source file gives an empty output file and exit 0', needsBash, () => {
  const r = run(null);
  assert.equal(r.code, 0, r.log);
  assert.equal(r.text, '');
  assert.match(r.log, /not found/);
});
