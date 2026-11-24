// install-trivy.mjs: the one Trivy pin, and an install that refuses anything whose sha256 is not
// the pin (feature 010, research R1). Every effect is injected: no network, no real binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { TRIVY_PIN, installTrivy, main } from '../install-trivy.mjs';

const BYTES = Buffer.from('a pretend trivy tarball');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PIN = { version: '9.9.9', asset: 'trivy_9.9.9_Linux-64bit.tar.gz', sha256: sha(BYTES) };

function deps(over = {}) {
  const calls = { fetched: [], extracted: 0 };
  return {
    calls,
    pin: PIN,
    fetchBytes: async (url) => { calls.fetched.push(url); return BYTES; },
    extractTrivy: async (_bytes, dest) => { calls.extracted += 1; const p = join(dest, 'trivy'); writeFileSync(p, ''); return p; },
    runVersion: () => 'Version: 9.9.9\n',
    sleep: async () => {},
    log: () => {},
    ...over,
  };
}

const withDir = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'belay-trivy-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('the pin is one version and one 64-hex sha256, for the Linux x86-64 release asset', () => {
  assert.match(TRIVY_PIN.version, /^\d+\.\d+\.\d+$/);
  assert.match(TRIVY_PIN.sha256, /^[0-9a-f]{64}$/);
  assert.equal(TRIVY_PIN.asset, `trivy_${TRIVY_PIN.version}_Linux-64bit.tar.gz`);
});

test('pinned bytes are installed into <bindir>, then --version is checked against the pin', async () => {
  await withDir(async (bindir) => {
    const d = deps();
    const path = await installTrivy({ bindir, ...d });
    assert.equal(path, join(bindir, 'trivy'));
    assert.ok(existsSync(path));
    assert.equal(d.calls.fetched[0], `https://github.com/aquasecurity/trivy/releases/download/v9.9.9/${PIN.asset}`);
    assert.equal(d.calls.extracted, 1);
  });
});

test('a sha256 mismatch refuses, printing both digests, and writes NOTHING to <bindir>', async () => {
  await withDir(async (bindir) => {
    const d = deps({ fetchBytes: async () => Buffer.from('tampered') });
    await assert.rejects(installTrivy({ bindir, ...d }),
      (e) => e.exitCode === 1 && e.message.includes(PIN.sha256) && e.message.includes(sha(Buffer.from('tampered'))));
    assert.equal(d.calls.extracted, 0);
    assert.deepEqual(readdirSync(bindir), []);
  });
});

test('a download failure is retried, boundedly, then fails naming the URL', async () => {
  await withDir(async (bindir) => {
    let n = 0;
    const d = deps({ fetchBytes: async () => { n += 1; throw new Error('ECONNRESET'); } });
    await assert.rejects(installTrivy({ bindir, ...d }),
      (e) => e.exitCode === 1 && /download failed after 3 attempts/.test(e.message) && e.message.includes('releases/download/v9.9.9'));
    assert.equal(n, 3);
  });
});

test('a binary whose --version is not the pin is refused', async () => {
  await withDir(async (bindir) => {
    const d = deps({ runVersion: () => 'Version: 9.9.8\n' });
    await assert.rejects(installTrivy({ bindir, ...d }), (e) => e.exitCode === 1 && /reports version '9\.9\.8', expected 9\.9\.9/.test(e.message));
  });
});

test('--print-pin prints "trivy <version> <sha256>"; no <bindir> is a usage error', async () => {
  const out = [];
  assert.equal(await main(['--print-pin'], { log: (l) => out.push(l) }), 0);
  assert.deepEqual(out, [`trivy ${TRIVY_PIN.version} ${TRIVY_PIN.sha256}`]);
  assert.equal(await main([], { log: () => {}, error: () => {} }), 2);
});

test('the real default extractor unpacks a real tarball (tar -xzf)', async () => {
  // Build a genuine .tar.gz holding an executable "trivy" script, so the default extractor is
  // exercised without the network or a real Trivy binary.
  await withDir(async (dir) => {
    const src = join(dir, 'src');
    spawnSync('mkdir', ['-p', src]);
    writeFileSync(join(src, 'trivy'), '#!/bin/sh\necho "Version: 9.9.9"\n');
    chmodSync(join(src, 'trivy'), 0o755);
    const tgz = join(dir, 'x.tar.gz');
    assert.equal(spawnSync('tar', ['-czf', tgz, '-C', src, 'trivy']).status, 0);
    const bytes = (await import('node:fs')).readFileSync(tgz);
    const bindir = join(dir, 'bin');
    const path = await installTrivy({ bindir, pin: { ...PIN, sha256: sha(bytes) }, fetchBytes: async () => bytes, log: () => {}, sleep: async () => {} });
    assert.equal(path, join(bindir, 'trivy'));
    assert.ok(existsSync(path));
  });
});
