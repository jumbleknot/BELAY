#!/usr/bin/env node
// install-pwsh.mjs: install the pinned PowerShell for CI, refusing any bytes whose sha256 is not the pin
// (feature 016, research M9; ADR-0006).
//
// WHY CI NEEDS IT. pdlc:integration runs the target repository's real Spec Kit PowerShell scripts (the branch script's
// dry run, resolve-template), and the `belay` runner image (node:26-bookworm) has no pwsh (measured 2026-11-27). The
// maintainer chose a pinned, checksum-verified install in guardrails over moving those tests out of CI (M9).
//
// THE ONE PLACE CI's PowerShell version is stated. Renovate tracks PWSH_PIN under PowerShell/PowerShell, the same
// dependency as the dev container's ARG POWERSHELL_VERSION, so the two move in one PR; the sha256 is moved by
// refresh-pin-checksum.mjs, agreed by the release's published hashes.sha256. A test holds the two versions equal.
//
// WHY THE SHA256 LIVES HERE: a checksum read from the same release as the tarball catches corruption, not tampering.
// The pin below was read ONCE from the v7.7.0 release's hashes.sha256 (2026-11-27) and checked against the downloaded
// bytes; a changed upstream file is refused, never trusted. Same pattern as install-trivy.mjs.
//
// NOT ONE BINARY: the tarball is a 763-file folder (measured), so it is unpacked whole into <dir>, and the workflow puts
// <dir> on the PATH.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMain } from './lib/is-main.mjs';

export const PWSH_PIN = Object.freeze({
  version: '7.7.0',
  asset: 'powershell-7.7.0-linux-x64.tar.gz',
  sha256: 'c89d9c682d2c403dfe726f3df948e359675235a5bd6fab535776de69729ca0cb',
});

const RELEASES = 'https://github.com/PowerShell/PowerShell/releases/download';
const ATTEMPTS = 3;
const USAGE = 'Usage: install-pwsh.mjs <dir> | --print-pin';

export class InstallError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

async function defaultFetchBytes(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function defaultExtract(bytes, dest) {
  const work = mkdtempSync(join(tmpdir(), 'belay-pwsh-'));
  try {
    const tgz = join(work, 'powershell.tar.gz');
    writeFileSync(tgz, bytes);
    const r = spawnSync('tar', ['-xzf', tgz, '-C', dest], { encoding: 'utf8' });
    if (r.status !== 0) throw new InstallError(`the tarball did not unpack: ${(r.stderr || '').trim()}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function defaultRunVersion(path) {
  const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

/** Download, verify against the pin, unpack into `dir`, then check `pwsh --version`. Returns the pwsh path. */
export async function installPwsh({
  dir,
  pin = PWSH_PIN,
  fetchBytes = defaultFetchBytes,
  extract = defaultExtract,
  runVersion = defaultRunVersion,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
} = {}) {
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new InstallError(`${dir} is not empty: refusing to mix this install with another`);
  }
  const url = `${RELEASES}/v${pin.version}/${pin.asset}`;
  let bytes;
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS && !bytes; attempt++) {
    try {
      bytes = await fetchBytes(url);
    } catch (e) {
      lastError = e;
      if (attempt < ATTEMPTS) await sleep(2000 * attempt);
    }
  }
  if (!bytes) throw new InstallError(`download failed after ${ATTEMPTS} attempts: ${url} (${lastError?.message ?? 'no response'})`);

  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== pin.sha256) {
    throw new InstallError(`${pin.asset}: sha256 ${actual} does not match the pinned ${pin.sha256} — refusing to install it`);
  }
  log(`install-pwsh: sha256 verified for ${pin.asset}`);

  mkdirSync(dir, { recursive: true });
  try {
    await extract(bytes, dir);
    const pwsh = join(dir, 'pwsh');
    if (!existsSync(pwsh)) throw new InstallError(`the tarball has no pwsh at its top level (${pwsh})`);
    chmodSync(pwsh, 0o755);
    const got = /^PowerShell\s+(\S+)/m.exec(String(runVersion(pwsh)))?.[1];
    if (got !== pin.version) throw new InstallError(`installed ${pwsh} reports version '${got ?? '<none>'}', expected ${pin.version}`);
    log(`install-pwsh: installed PowerShell ${pin.version} at ${pwsh}`);
    return pwsh;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export async function main(argv, { log = console.log, error = console.error, install = installPwsh } = {}) {
  if (argv[0] === '--print-pin' && argv.length === 1) {
    log(`pwsh ${PWSH_PIN.version} ${PWSH_PIN.sha256}`);
    return 0;
  }
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    error(USAGE);
    return 2;
  }
  try {
    await install({ dir: argv[0], log });
    return 0;
  } catch (e) {
    error(`install-pwsh: ${e.message}`);
    return e.exitCode ?? 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
