#!/usr/bin/env node
// Move a version-and-checksum pair together (feature 011, research R7, FR-009).
//
// WHY THIS EXISTS. Three installers pin a release by version AND by the sha256 of its bytes:
//   - Trivy (`TRIVY_PIN`);
//   - rustup-init;
//   - cargo-audit.
// The dependency bot moves a version string, but it cannot know the new sha256. A PR that moves the
// version alone is refused by the installer, or (for the two that CI only runs when a Cargo.lock
// exists) it merges unseen and fails the first time it is needed.
//
// So the bot runs this as a post-upgrade task, which downloads the new release, hashes it, and only
// writes the hash if the PUBLISHER's own checksum agrees:
//   - Trivy's checksums file;
//   - rustup's .sha256 file;
//   - the digest GitHub's release API reports for the cargo-audit asset.
// A bot-derived hash is never trusted alone. The guardrails job runs `--verify-changed` as the
// second barrier, so a PR whose pair disagrees cannot merge.
//
// The installers' constants stay their single source: this script reads the version out of the
// file by regex, and never holds a copy.
//
// Usage:
//   node scripts/refresh-pin-checksum.mjs <trivy|rustup-init|cargo-audit>     # rewrite the pair's sha256
//   node scripts/refresh-pin-checksum.mjs --verify-changed [--base <ref>]      # check pairs that moved
//   node scripts/refresh-pin-checksum.mjs --selftest
//
// Exit codes: 0 done / agrees · 1 a download, checksum or agreement failure · 2 bad arguments.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: refresh-pin-checksum.mjs <trivy|rustup-init|cargo-audit> | --verify-changed [--base <ref>] | --selftest';
const TIMEOUT_MS = 120_000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

/** The publisher checksum for an asset, from its checksums file (`<hex>  <name>` lines). */
async function fromChecksumsFile(get, url, name) {
  const text = await get(url, 'text');
  const line = text.split('\n').map((l) => l.trim().split(/\s+/)).find(([h, n]) => HEX64.test(h ?? '') && n?.replace(/^\*/, '') === name);
  if (!line) throw new PinChecksumError(`${url} lists no checksum for ${name}`);
  return line[0];
}

/** The version-and-checksum pairs (research R7). `versionName` / `shaName` are the detector's names. */
export const CHECKSUM_PAIRS = Object.freeze([
  {
    pin: 'trivy', depName: 'aquasecurity/trivy', file: 'scripts/install-trivy.mjs',
    versionName: 'TRIVY_PIN.version', shaName: 'TRIVY_PIN.sha256',
    version: /^\s*version:\s*'([^']+)'/m, sha: /^(\s*sha256:\s*')([0-9a-f]{64})(')/m,
    asset: /^\s*asset:\s*'([^']+)'/m, assetName: (v) => `trivy_${v}_Linux-64bit.tar.gz`,
    url: (v) => `https://github.com/aquasecurity/trivy/releases/download/v${v}/trivy_${v}_Linux-64bit.tar.gz`,
    published: (v, get) => fromChecksumsFile(get, `https://github.com/aquasecurity/trivy/releases/download/v${v}/trivy_${v}_checksums.txt`, `trivy_${v}_Linux-64bit.tar.gz`),
  },
  {
    pin: 'rustup-init', depName: 'rust-lang/rustup', file: 'scripts/sast-prepare.mjs',
    versionName: 'RUSTUP_VERSION', shaName: 'RUSTUP_INIT_SHA256',
    version: /\bRUSTUP_VERSION\s*=\s*'([^']+)'/, sha: /(\bRUSTUP_INIT_SHA256\s*=\s*')([0-9a-f]{64})(')/,
    url: (v) => `https://static.rust-lang.org/rustup/archive/${v}/x86_64-unknown-linux-gnu/rustup-init`,
    published: (v, get) => fromChecksumsFile(get, `https://static.rust-lang.org/rustup/archive/${v}/x86_64-unknown-linux-gnu/rustup-init.sha256`, 'rustup-init'),
  },
  {
    pin: 'cargo-audit', depName: 'cargo-audit', file: 'scripts/sast-prepare.mjs',
    versionName: 'CARGO_AUDIT_VERSION', shaName: 'CARGO_AUDIT_SHA256',
    version: /\bCARGO_AUDIT_VERSION\s*=\s*'([^']+)'/, sha: /(\bCARGO_AUDIT_SHA256\s*=\s*')([0-9a-f]{64})(')/,
    url: (v) => `https://github.com/rustsec/rustsec/releases/download/cargo-audit%2Fv${v}/cargo-audit-x86_64-unknown-linux-musl-v${v}.tgz`,
    async published(v, get) {
      const api = `https://api.github.com/repos/rustsec/rustsec/releases/tags/cargo-audit%2Fv${v}`;
      const name = `cargo-audit-x86_64-unknown-linux-musl-v${v}.tgz`;
      const digest = (await get(api, 'json'))?.assets?.find((a) => a.name === name)?.digest;
      const m = /^sha256:([0-9a-f]{64})$/.exec(digest ?? '');
      if (!m) throw new PinChecksumError(`${api} has no published digest for ${name}: the downloaded bytes are not trusted alone`);
      return m[1];
    },
  },
]);

export class PinChecksumError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

function getter(doFetch) {
  return async (url, as) => {
    const res = await doFetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new PinChecksumError(`GET ${url}: HTTP ${res.status}`);
    if (as === 'bytes') return Buffer.from(await res.arrayBuffer());
    return as === 'json' ? res.json() : res.text();
  };
}

function readPair(pair, text) {
  const version = pair.version.exec(text)?.[1];
  const sha = pair.sha.exec(text)?.[2];
  if (!version || !sha) throw new PinChecksumError(`${pair.pin}: cannot find ${pair.versionName} and ${pair.shaName} in ${pair.file}`);
  return { version, sha };
}

/** The sha256 the pair's version SHOULD carry: the downloaded bytes, agreed by the publisher. */
async function deriveSha(pair, version, get) {
  const url = pair.url(version);
  const actual = sha256(await get(url, 'bytes'));
  const published = await pair.published(version, get);
  if (actual !== published) {
    throw new PinChecksumError(`${pair.pin} ${version}: ${url} hashes to ${actual}, but the publisher says ${published}. Refusing it`);
  }
  return actual;
}

const findPair = (pin) => {
  const pair = CHECKSUM_PAIRS.find((p) => p.pin === pin);
  if (!pair) throw new PinChecksumError(`unknown pair "${pin}": one of ${CHECKSUM_PAIRS.map((p) => p.pin).join(', ')}`, 2);
  return pair;
};

/** The post-upgrade task: rewrite the pair's sha256 for the version now in the file. Atomic; no partial write. */
export async function refreshPair(pin, { root = REPO_ROOT, fetch: doFetch = fetch, log = console.log } = {}) {
  const pair = findPair(pin);
  const path = join(root, pair.file);
  const text = readFileSync(path, 'utf8');
  const { version, sha } = readPair(pair, text);
  if (pair.asset) {
    const asset = pair.asset.exec(text)?.[1];
    if (asset !== pair.assetName(version)) throw new PinChecksumError(`${pin}: the asset is "${asset}" but the version is ${version}: the version moved alone`);
  }
  const want = await deriveSha(pair, version, getter(doFetch));
  if (want === sha) { log(`[pin-checksum] ${pin} ${version}: sha256 already ${want}`); return { changed: false, sha: want }; }
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text.replace(pair.sha, `$1${want}$3`));
  renameSync(tmp, path);
  log(`[pin-checksum] ${pin} ${version}: sha256 ${sha} → ${want} (publisher agrees)`);
  return { changed: true, sha: want };
}

function gitShow(root, base) {
  return (file) => {
    const r = spawnSync('git', ['-C', root, 'show', `${base}:${file}`], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout : null;
  };
}

/** The guardrails barrier: every pair whose version or sha256 moved against the base must agree. */
export async function verifyChanged({ root = REPO_ROOT, base = 'origin/main', readBase = gitShow(root, base), fetch: doFetch = fetch, log = console.log } = {}) {
  const get = getter(doFetch);
  const checked = [];
  const failures = [];
  for (const pair of CHECKSUM_PAIRS) {
    const now = readPair(pair, readFileSync(join(root, pair.file), 'utf8'));
    const before = readBase(pair.file);
    let then = null;
    try { then = before == null ? null : readPair(pair, before); } catch { then = null; }
    if (then && then.version === now.version && then.sha === now.sha) continue;
    checked.push(pair.pin);
    try {
      const want = await deriveSha(pair, now.version, get);
      if (want !== now.sha) failures.push(`${pair.pin} ${now.version}: the file pins ${now.sha}, but the release is ${want}. Run node scripts/refresh-pin-checksum.mjs ${pair.pin}`);
    } catch (e) { failures.push(e.message); }
  }
  for (const f of failures) log(`[pin-checksum] ✗ ${f}`);
  log(checked.length ? `[pin-checksum] ${failures.length ? '❌' : '✅'} checked ${checked.join(', ')}` : '[pin-checksum] ✅ no version-and-checksum pair changed');
  return { checked, failures };
}

// ── --selftest: the mismatch path, with injected fixtures and no network ─────────────────────────

export async function pinChecksumSelftest() {
  const failures = [];
  const root = mkdtempSync(join(tmpdir(), 'pin-checksum-selftest-'));
  const file = join(root, 'scripts/sast-prepare.mjs');
  mkdirSync(dirname(file), { recursive: true });
  const original = `export const RUSTUP_VERSION = '9.9.9';\nexport const RUSTUP_INIT_SHA256 = '${'a'.repeat(64)}';\n`;
  writeFileSync(file, original);
  const bytes = Buffer.from('selftest');
  const url = CHECKSUM_PAIRS[1].url('9.9.9');
  const fake = (published) => async (u) => ({ ok: true, status: 200, arrayBuffer: async () => bytes, text: async () => (u === url ? '' : `${published}  rustup-init\n`) });
  try {
    await refreshPair('rustup-init', { root, fetch: fake('b'.repeat(64)), log: () => {} });
    failures.push('a publisher mismatch was accepted');
  } catch (e) { if (!(e instanceof PinChecksumError)) failures.push(`a mismatch threw the wrong error: ${e.message}`); }
  if (readFileSync(file, 'utf8') !== original) failures.push('a mismatch changed the file');
  const r = await refreshPair('rustup-init', { root, fetch: fake(sha256(bytes)), log: () => {} });
  if (!r.changed || !readFileSync(file, 'utf8').includes(sha256(bytes))) failures.push('an agreeing publisher did not refresh the sha256');
  return { failures };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  try {
    if (!argv.length || argv.includes('--help')) { (argv.length ? log : error)(USAGE); return argv.length ? 0 : 2; }
    if (argv[0] === '--selftest') {
      const { failures } = await pinChecksumSelftest();
      for (const f of failures) error(`[pin-checksum] ✗ selftest: ${f}`);
      if (!failures.length) log('[pin-checksum] ✅ selftest: a publisher mismatch is refused and leaves the file unchanged; agreement refreshes it');
      return failures.length ? 1 : 0;
    }
    if (argv[0] === '--verify-changed') {
      const b = argv.indexOf('--base');
      if (b >= 0 && !argv[b + 1]) { error(USAGE); return 2; }
      const { failures } = await verifyChanged({ base: b >= 0 ? argv[b + 1] : 'origin/main', log, error });
      return failures.length ? 1 : 0;
    }
    if (argv.length !== 1 || argv[0].startsWith('-')) { error(USAGE); return 2; }
    await refreshPair(argv[0], { log });
    return 0;
  } catch (e) {
    error(`[pin-checksum] ✗ ${e.message}`);
    return e instanceof PinChecksumError ? e.exitCode : 1;
  }
}

if (isMain(import.meta.url)) main().then((code) => process.exit(code));
