#!/usr/bin/env node
// Feature 008 — install the stage-2/3 scanner toolchains in the `sast` job, but ONLY when there is
// something for them to audit (items #39, #40).
//
// WHY DORMANT STEPS. An enabled scanner with nothing to audit fails the required `sast` job by design
// (feature 006). So cargo-audit and pip-audit cannot be enabled before the first Rust crate or Python
// project lands, and without this script that first PR would also have to design a toolchain install
// under time pressure. These steps are in the job now and do nothing until a lockfile is tracked.
//
//   node scripts/sast-prepare.mjs rust     a tracked Cargo.lock → a pinned Rust toolchain + cargo-audit
//   node scripts/sast-prepare.mjs python   each tracked project uv.lock → `uv sync --frozen` there
//
// DISCOVERY IS THE SCANNERS' OWN. `trackedFiles(['*Cargo.lock'])` is the pathspec cargoAuditSet()
// uses, and `discoverPythonProjects().locked` is exactly the set pip-audit audits. A second copy of
// either rule would drift, and the drift would read as "installed, then audited nothing".
//
// NOTHING IS PIPED INTO A SHELL, AND NOTHING RUNS UNVERIFIED. MCM (and the dev-container image) run
// `curl https://sh.rustup.rs | sh`; a piped script cannot be pinned by digest, and the
// belay-ci-curl-pipe-shell rule accepts only uv's pinned installer. Here every binary is downloaded
// to a file, its sha256 compared with the pin below, and only then written or executed.
//
// THE rustup-init DIGEST IS DERIVED, NOT PUBLISHED (research R1). static.rust-lang.org is excluded
// from the dev container's egress (maintainer, 2026-11-23), so the published `.sha256` could not be
// read. The pin is the sha256 of the dev container's baked `~/.cargo/bin/rustup` (rustup-init installs
// by copying itself; `rustup --version` reports the same release). It was verified on the runner
// before merge (spec SC-002). If it is ever wrong, this fails closed, naming both digests.
//
// Exit codes: 0 prepared (or nothing to prepare) · 1 a download, digest or install failed · 2 usage.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArgvError, dieOnArgvError, partitionArgs, wantsHelp } from './lib/argv-contract.mjs';
import { discoverPythonProjects, trackedFiles } from './sast-scan.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── pins: the ONE source (FR-009). The workflow carries none. ─────────────────────────────────────

/** Equal to `.devcontainer/toolchain.Dockerfile`'s `--default-toolchain` (guarded by a test). */
export const RUST_TOOLCHAIN = '1.100.0';
export const RUSTUP_VERSION = '1.29.3';
export const RUSTUP_INIT_URL = `https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init`;
export const RUSTUP_INIT_SHA256 = 'b1c8cb14e30889e7e2999e6b69e62d9e9b9ffc0f4df8180564d306d9680e6c55';
/** MCM's pin. The musl build, so it does not depend on the runner's glibc. */
export const CARGO_AUDIT_VERSION = '0.23.0';
const CARGO_AUDIT_ASSET = `cargo-audit-x86_64-unknown-linux-musl-v${CARGO_AUDIT_VERSION}`;
export const CARGO_AUDIT_URL = `https://github.com/rustsec/rustsec/releases/download/cargo-audit%2Fv${CARGO_AUDIT_VERSION}/${CARGO_AUDIT_ASSET}.tgz`;
/** As published by GitHub's release API for the asset, and re-hashed after download (research R2). */
export const CARGO_AUDIT_SHA256 = '4f01c74ed84b2dffd0b1d37012a62cdf2a92c96e25bdf8eec7fcc0d4d3eb7811';

const USAGE = `usage: node scripts/sast-prepare.mjs <rust|python>

  rust     when a Cargo.lock is tracked: install Rust ${RUST_TOOLCHAIN} (minimal, via a sha256-verified
           rustup-init ${RUSTUP_VERSION}) and the prebuilt cargo-audit ${CARGO_AUDIT_VERSION}, then put
           ~/.cargo/bin on $GITHUB_PATH
  python   for each tracked uv.lock under a project directory: uv sync --frozen in that directory

With nothing tracked, each subcommand says so and exits 0. See docs/runbooks/sast.md.`;

export class PrepareError extends Error {}

/** Refuse bytes whose sha256 is not the pin. Throws before the caller can write or run them. */
export function verifyDigest(name, bytes, expected) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new PrepareError(`${name}: sha256 ${actual} does not match the pinned ${expected} — refusing to install it`);
  }
}

function mustSucceed(r, what) {
  if (r?.status !== 0) throw new PrepareError(`${what} failed (exit ${r?.status ?? 'none'})`);
}

async function prepareRust(lockfiles, fx, pins) {
  if (!lockfiles.length) {
    fx.log('[sast-prepare] rust: no tracked Cargo.lock — nothing to audit, so no Rust toolchain installed (item #39 not triggered).');
    return;
  }
  fx.log(`[sast-prepare] rust: ${lockfiles.length} tracked Cargo.lock(s): ${lockfiles.join(', ')}`);

  // Download and verify BOTH before writing or running either: a bad second pin must not leave a
  // half-installed toolchain behind on a persistent runner.
  const rustupInit = await fx.fetchBytes(RUSTUP_INIT_URL);
  verifyDigest('rustup-init', rustupInit, pins.rustupInitSha256);
  const auditTgz = await fx.fetchBytes(CARGO_AUDIT_URL);
  verifyDigest(`${CARGO_AUDIT_ASSET}.tgz`, auditTgz, pins.cargoAuditSha256);

  const rustupPath = join(fx.tmp, 'rustup-init');
  fx.writeFile(rustupPath, rustupInit, 0o755);
  mustSucceed(
    fx.exec(rustupPath, ['-y', '--profile', 'minimal', '--default-toolchain', RUST_TOOLCHAIN, '--no-modify-path']),
    `rustup-init (Rust ${RUST_TOOLCHAIN})`,
  );

  const bin = join(fx.home, '.cargo', 'bin');
  const tgzPath = join(fx.tmp, `${CARGO_AUDIT_ASSET}.tgz`);
  fx.writeFile(tgzPath, auditTgz, 0o644);
  mustSucceed(fx.exec('tar', ['-xzf', tgzPath, '-C', fx.tmp]), `extracting ${CARGO_AUDIT_ASSET}.tgz`);
  mustSucceed(fx.exec('install', ['-m', '0755', join(fx.tmp, CARGO_AUDIT_ASSET, 'cargo-audit'), join(bin, 'cargo-audit')]), 'installing cargo-audit');

  fx.appendPath(bin);
  // The scanner runs `cargo audit …`, so prove that exact form resolves before the scan needs it.
  mustSucceed(fx.exec(join(bin, 'cargo'), ['audit', '--version']), '`cargo audit --version`');
  fx.log(`[sast-prepare] rust: Rust ${RUST_TOOLCHAIN} and cargo-audit ${CARGO_AUDIT_VERSION} installed in ${bin}`);
}

async function preparePython(projects, fx) {
  if (!projects.length) {
    fx.log('[sast-prepare] python: no tracked uv.lock under a project directory — nothing to sync (item #40 not triggered).');
    return;
  }
  // pip-audit audits each project's INSTALLED venv, so every project must be synced. One failure fails
  // the step: an unsynced project would be audited against a missing env, never skipped (feature 006).
  for (const project of projects) {
    fx.log(`[sast-prepare] python: uv sync --frozen in ${project}`);
    mustSucceed(fx.exec('uv', ['sync', '--frozen'], { cwd: resolve(REPO_ROOT, project) }), `uv sync --frozen in ${project}`);
  }
}

const realDiscovery = {
  rust: () => trackedFiles(['*Cargo.lock'], REPO_ROOT, 'cargo-audit'),
  python: () => discoverPythonProjects(REPO_ROOT).locked,
};

function realEffects() {
  return {
    home: homedir(),
    tmp: mkdtempSync(join(tmpdir(), 'sast-prepare-')),
    fetchBytes: async (url) => {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new PrepareError(`GET ${url} returned ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    writeFile: (path, data, mode) => writeFileSync(path, data, { mode }),
    exec: (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: opts.cwd ?? REPO_ROOT, stdio: 'inherit' }),
    appendPath: (dir) => {
      if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, `${dir}\n`);
      else console.log(`[sast-prepare] GITHUB_PATH is unset (not in CI): add ${dir} to PATH yourself`);
    },
    log: (m) => console.log(m),
  };
}

/**
 * Run one subcommand. `discover`, `fx` and `pins` are seams for tests; the CLI passes none of them,
 * so the real discovery, effects and committed pins are what CI runs.
 */
export async function prepare(what, { discover = realDiscovery, fx = realEffects(), pins } = {}) {
  const p = { rustupInitSha256: RUSTUP_INIT_SHA256, cargoAuditSha256: CARGO_AUDIT_SHA256, ...pins };
  if (what === 'rust') return prepareRust(discover.rust(), fx, p);
  if (what === 'python') return preparePython(discover.python(), fx);
  throw new ArgvError(`unknown subcommand "${what}"\n\n${USAGE}`);
}

export async function main(argv = process.argv.slice(2)) {
  if (wantsHelp(argv)) { console.log(USAGE); return 0; }
  const { positionals } = partitionArgs(argv, { accepted: [], maxPositionals: 1, usage: USAGE });
  if (positionals.length !== 1) throw new ArgvError(`a subcommand is required\n\n${USAGE}`);
  if (!['rust', 'python'].includes(positionals[0])) throw new ArgvError(`unknown subcommand "${positionals[0]}"\n\n${USAGE}`);
  await prepare(positionals[0]);
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (e) {
    if (e instanceof ArgvError) dieOnArgvError(e);
    else {
      console.error(`✗ sast-prepare: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
