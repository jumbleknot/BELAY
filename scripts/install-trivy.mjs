#!/usr/bin/env node
// install-trivy.mjs: install the pinned Trivy, refusing any bytes whose sha256 is not the pin
// (feature 010, research R1).
//
// THE ONE PLACE the Trivy version is stated (spec FR-010). Renovate (item 47) tracks TRIVY_PIN with a
// regex manager; the version and the sha256 must move in the same PR.
//
// WHY THE SHA256 LIVES HERE, NOT IN THE RELEASE'S checksums.txt: a checksum read from the same
// release as the tarball catches corruption, not tampering, because one origin controls both. The
// pin below was read ONCE from the release's published trivy_0.76.2_checksums.txt (2026-11-24) and is
// now frozen: a changed upstream file is refused, never trusted. Same pattern as sast-prepare.mjs.
//
// NEVER a piped installer: MovieCollectionManager measured Trivy's install.sh resolving a version
// and then downloading nothing, with no error and no binary (2026-08-30; twice in CI, 2026-11-04).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMain } from './lib/is-main.mjs';

export const TRIVY_PIN = Object.freeze({
  version: '0.76.2',
  asset: 'trivy_0.76.2_Linux-64bit.tar.gz',
  sha256: 'bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf',
});

const RELEASES = 'https://github.com/aquasecurity/trivy/releases/download';
const ATTEMPTS = 3;
const USAGE = 'Usage: install-trivy.mjs <bindir> | --print-pin';

export class InstallError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

async function defaultFetchBytes(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function defaultExtractTrivy(bytes, dest) {
  const tgz = join(dest, 'trivy.tar.gz');
  writeFileSync(tgz, bytes);
  const r = spawnSync('tar', ['-xzf', tgz, '-C', dest, 'trivy'], { encoding: 'utf8' });
  if (r.status !== 0) throw new InstallError(`the tarball has no 'trivy' binary: ${(r.stderr || '').trim()}`);
  return join(dest, 'trivy');
}

function defaultRunVersion(path) {
  const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

/** Download, verify against the pin, extract, install into `bindir`, then check --version. */
export async function installTrivy({
  bindir,
  pin = TRIVY_PIN,
  fetchBytes = defaultFetchBytes,
  extractTrivy = defaultExtractTrivy,
  runVersion = defaultRunVersion,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
} = {}) {
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
  log(`install-trivy: sha256 verified for ${pin.asset}`);

  const work = mkdtempSync(join(tmpdir(), 'belay-trivy-'));
  try {
    const extracted = await extractTrivy(bytes, work);
    if (!existsSync(extracted)) throw new InstallError(`extraction produced no binary at ${extracted}`);
    mkdirSync(bindir, { recursive: true });
    const target = join(bindir, 'trivy');
    copyFileSync(extracted, target);
    chmodSync(target, 0o755);
    const got = /^Version:\s*(\S+)/m.exec(String(runVersion(target)))?.[1];
    if (got !== pin.version) {
      rmSync(target, { force: true });
      throw new InstallError(`installed ${target} reports version '${got ?? '<none>'}', expected ${pin.version}`);
    }
    log(`install-trivy: installed Trivy ${pin.version} at ${target}`);
    return target;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function main(argv, { log = console.log, error = console.error, install = installTrivy } = {}) {
  if (argv[0] === '--print-pin' && argv.length === 1) {
    log(`trivy ${TRIVY_PIN.version} ${TRIVY_PIN.sha256}`);
    return 0;
  }
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    error(USAGE);
    return 2;
  }
  try {
    await install({ bindir: argv[0], log });
    return 0;
  } catch (e) {
    error(`install-trivy: ${e.message}`);
    return e.exitCode ?? 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
