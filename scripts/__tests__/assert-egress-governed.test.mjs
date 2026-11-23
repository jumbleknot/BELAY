// Tests for .devcontainer/assert-egress-governed.sh (feature 004, T008).
// Contract: specs/004-devcontainer-sandbox/contracts/cli.md. A stub `curl` on PATH decides, per
// probe, whether the request "succeeds", so both failure directions are exercised without a network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsShell } from './shell-probe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, '.devcontainer', 'assert-egress-governed.sh');
const needsBash = needsShell('bash', SCRIPT);

// The stub exits STUB_BLOCKED_RC for the blocked probe's URL and STUB_ALLOWED_RC otherwise.
function stubDir() {
  const dir = mkdtempSync(join(tmpdir(), 'egress-stub-'));
  const curl = join(dir, 'curl');
  writeFileSync(curl, [
    '#!/usr/bin/env bash',
    'for a in "$@"; do case "$a" in *"${STUB_BLOCKED_HOST:-example.com}"*) exit "${STUB_BLOCKED_RC:-6}";; esac; done',
    'exit "${STUB_ALLOWED_RC:-0}"',
    '',
  ].join('\n'));
  chmodSync(curl, 0o755);
  return dir;
}

const run = (env, { withCurl = true } = {}) => {
  if (!withCurl) {
    // node must still find bash, so PATH is emptied INSIDE bash: it re-execs itself by its own
    // absolute path ($BASH) with a PATH that holds no curl.
    const r = spawnSync('bash', ['-c', 'export PATH=/nonexistent-belay-test-path; exec "$BASH" "$1"', '_', SCRIPT], {
      encoding: 'utf8', env: { ...process.env, ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }
  const dir = stubDir();
  const r = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, ...env, PATH: `${dir}${delimiter}${process.env.PATH}` },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('blocked refused and allowed reached → exit 0 and PASS', needsBash, () => {
  const r = run({ STUB_BLOCKED_RC: '6', STUB_ALLOWED_RC: '0' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS/);
});

test('a reachable blocked host → exit 1, naming the host', needsBash, () => {
  const r = run({ STUB_BLOCKED_RC: '0', STUB_ALLOWED_RC: '0' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /example\.com is REACHABLE/);
});

test('an unreachable allowed host → exit 1: severed is not secure', needsBash, () => {
  const r = run({ STUB_BLOCKED_RC: '6', STUB_ALLOWED_RC: '6' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /severed rather than filtered/);
});

test('no curl → exit 1, refusing to claim egress is governed', needsBash, () => {
  const r = run({}, { withCurl: false });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /curl absent/);
});

test('EGRESS_BLOCKED_PROBE and EGRESS_ALLOWED_PROBE override the defaults', needsBash, () => {
  const r = run({
    EGRESS_BLOCKED_PROBE: 'blocked.example.test',
    EGRESS_ALLOWED_PROBE: 'https://allowed.example.test/',
    STUB_BLOCKED_HOST: 'blocked.example.test',
    STUB_BLOCKED_RC: '6',
    STUB_ALLOWED_RC: '0',
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /blocked\.example\.test refused/);
  assert.match(r.out, /https:\/\/allowed\.example\.test\/ reachable/);
});
