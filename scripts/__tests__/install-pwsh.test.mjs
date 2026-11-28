// install-pwsh.mjs: the one PowerShell pin for CI, and an install that refuses anything whose sha256 is not the pin
// (feature 016, research M9). pdlc:integration runs the target repository's real Spec Kit PowerShell scripts, and the
// `belay` runner image (node:26-bookworm) has no pwsh (measured 2026-11-27). Every effect is injected: no network.
//
// Unlike Trivy, PowerShell is a folder, not one binary (763 files in 7.7.0's linux-x64 tarball, measured), so the
// install unpacks the whole tarball into <dir> and the workflow puts <dir> on the PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { PWSH_PIN, installPwsh, main } from '../install-pwsh.mjs';

const BYTES = Buffer.from('a pretend powershell tarball');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PIN = { version: '9.9.9', asset: 'powershell-9.9.9-linux-x64.tar.gz', sha256: sha(BYTES) };

function deps(over = {}) {
  const calls = { fetched: [], extracted: 0 };
  return {
    calls,
    pin: PIN,
    fetchBytes: async (url) => { calls.fetched.push(url); return BYTES; },
    extract: async (_bytes, dest) => { calls.extracted += 1; writeFileSync(join(dest, 'pwsh'), ''); writeFileSync(join(dest, 'pwsh.dll'), ''); },
    runVersion: () => 'PowerShell 9.9.9\n',
    sleep: async () => {},
    log: () => {},
    ...over,
  };
}

const withDir = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'belay-pwsh-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('the pin is one version and one 64-hex sha256, for the Linux x64 release tarball', () => {
  assert.match(PWSH_PIN.version, /^\d+\.\d+\.\d+$/);
  assert.match(PWSH_PIN.sha256, /^[0-9a-f]{64}$/);
  assert.equal(PWSH_PIN.asset, `powershell-${PWSH_PIN.version}-linux-x64.tar.gz`);
});

test('the pin is the dev container\'s PowerShell version, so CI and the dev container run the same scripts the same way', () => {
  const dockerfile = readFileSync(new URL('../../.devcontainer/toolchain.Dockerfile', import.meta.url), 'utf8');
  assert.equal(/ARG POWERSHELL_VERSION=(\S+)/.exec(dockerfile)?.[1], PWSH_PIN.version);
});

test('pinned bytes are unpacked into <dir>, then pwsh --version is checked against the pin', async () => {
  await withDir(async (root) => {
    const dir = join(root, 'pwsh');
    const d = deps();
    const path = await installPwsh({ dir, ...d });
    assert.equal(path, join(dir, 'pwsh'));
    assert.ok(existsSync(path));
    assert.ok(existsSync(join(dir, 'pwsh.dll')), 'the whole folder is installed, not one file');
    assert.equal(d.calls.fetched[0], `https://github.com/PowerShell/PowerShell/releases/download/v9.9.9/${PIN.asset}`);
    assert.equal(d.calls.extracted, 1);
  });
});

test('a sha256 mismatch refuses, printing both digests, and installs NOTHING', async () => {
  await withDir(async (root) => {
    const dir = join(root, 'pwsh');
    const d = deps({ fetchBytes: async () => Buffer.from('tampered') });
    await assert.rejects(installPwsh({ dir, ...d }),
      (e) => e.exitCode === 1 && e.message.includes(PIN.sha256) && e.message.includes(sha(Buffer.from('tampered'))));
    assert.equal(d.calls.extracted, 0);
    assert.ok(!existsSync(dir) || readdirSync(dir).length === 0);
  });
});

test('a download failure is retried three times, then fails naming the URL', async () => {
  await withDir(async (root) => {
    let n = 0;
    const d = deps({ fetchBytes: async () => { n += 1; throw new Error('ECONNRESET'); } });
    await assert.rejects(installPwsh({ dir: join(root, 'pwsh'), ...d }),
      (e) => e.exitCode === 1 && /download failed after 3 attempts/.test(e.message) && e.message.includes('releases/download/v9.9.9'));
    assert.equal(n, 3);
  });
});

test('a pwsh whose --version is not the pin is refused, and the installed folder is removed', async () => {
  await withDir(async (root) => {
    const dir = join(root, 'pwsh');
    const d = deps({ runVersion: () => 'PowerShell 9.9.8\n' });
    await assert.rejects(installPwsh({ dir, ...d }), (e) => e.exitCode === 1 && /reports version '9\.9\.8', expected 9\.9\.9/.test(e.message));
    assert.ok(!existsSync(join(dir, 'pwsh')));
  });
});

test('a non-empty <dir> is refused rather than mixed with another install', async () => {
  await withDir(async (root) => {
    const dir = join(root, 'pwsh');
    mkdirSync(dir);
    writeFileSync(join(dir, 'leftover'), '');
    await assert.rejects(installPwsh({ dir, ...deps() }), (e) => e.exitCode === 1 && /not empty/.test(e.message));
  });
});

test('--print-pin prints "pwsh <version> <sha256>"; no <dir> or an option is a usage error (exit 2)', async () => {
  const out = [];
  assert.equal(await main(['--print-pin'], { log: (l) => out.push(l) }), 0);
  assert.deepEqual(out, [`pwsh ${PWSH_PIN.version} ${PWSH_PIN.sha256}`]);
  assert.equal(await main([], { log: () => {}, error: () => {} }), 2);
  assert.equal(await main(['--force', '/x'], { log: () => {}, error: () => {} }), 2);
});

test('the real default extractor unpacks a real tarball (tar -xzf) into the folder', async () => {
  await withDir(async (root) => {
    const src = join(root, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'pwsh'), '#!/bin/sh\necho "PowerShell 9.9.9"\n');
    chmodSync(join(src, 'pwsh'), 0o644); // the installer must set the execute bit itself
    writeFileSync(join(src, 'pwsh.dll'), 'x');
    const tgz = join(root, 'x.tar.gz');
    assert.equal(spawnSync('tar', ['-czf', tgz, '-C', src, 'pwsh', 'pwsh.dll']).status, 0);
    const bytes = readFileSync(tgz);
    const dir = join(root, 'pwsh');
    const path = await installPwsh({ dir, pin: { ...PIN, sha256: sha(bytes) }, fetchBytes: async () => bytes, log: () => {}, sleep: async () => {} });
    assert.equal(path, join(dir, 'pwsh'));
    assert.ok(existsSync(join(dir, 'pwsh.dll')));
  });
});

test('guardrails installs pwsh through install-pwsh.mjs, puts it on the PATH, before the pdlc:integration step', () => {
  const wf = parseYaml(readFileSync(new URL('../../.forgejo/workflows/guardrails.yml', import.meta.url), 'utf8'));
  const steps = wf.jobs.guardrails.steps;
  const install = steps.findIndex((s) => /node scripts\/install-pwsh\.mjs /.test(s.run ?? ''));
  const integration = steps.findIndex((s) => /pnpm nx run pdlc:integration/.test(s.run ?? ''));
  assert.ok(install >= 0, 'no step runs scripts/install-pwsh.mjs');
  assert.ok(integration > install, 'pwsh must be installed before pdlc:integration runs');
  assert.match(steps[install].run, /GITHUB_PATH/, 'the install step must put its folder on the PATH');
  assert.equal(wf.jobs.guardrails['timeout-minutes'], 10, 'the guardrails budget is unchanged');
});
