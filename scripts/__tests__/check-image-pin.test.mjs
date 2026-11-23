// Tests for .devcontainer/check-image-pin.sh (feature 004, T016).
// Contract: specs/004-devcontainer-sandbox/contracts/cli.md. The thin Dockerfile falls back to the
// local `belay-devcontainer` tag when the pin is missing; this script makes that fallback visible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsShell } from './shell-probe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, '.devcontainer', 'check-image-pin.sh');
const needsBash = needsShell('bash', SCRIPT);

const DIGEST = `sha256:${'ab12'.repeat(16)}`;
const run = (pin) => {
  const env = { ...process.env };
  if (pin === undefined) delete env.BELAY_DEVCONTAINER_IMAGE;
  else env.BELAY_DEVCONTAINER_IMAGE = pin;
  const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('a digest-pinned reference reports the digest only, never the registry host', needsBash, () => {
  const r = run(`forge.example.test:3000/owner/belay-devcontainer@${DIGEST}`);
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp(`✓ pinned: ${DIGEST}`));
  assert.equal(r.out.includes('forge.example.test'), false, 'the registry host is topology and must not be printed');
});

for (const [label, pin] of [['unset', undefined], ['empty', ''], ['a bare local tag', 'belay-devcontainer'], ['a tag without a digest', 'forge.example.test/owner/belay-devcontainer:abc']]) {
  test(`${label} → a warning naming set -a and the runbook, exit 0`, needsBash, () => {
    const r = run(pin);
    assert.equal(r.code, 0, 'never blocks: an offline local build must stay possible');
    assert.match(r.out, /⚠/);
    assert.match(r.out, /set -a/);
    assert.match(r.out, /docs\/runbooks\/devcontainer\.md/);
    assert.doesNotMatch(r.out, /✓ pinned/);
  });
}
