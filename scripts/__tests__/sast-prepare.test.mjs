// Feature 008 — the dormant stage-2/3 toolchain steps of the `sast` job (items #39, #40).
//
// Every effect (download, write, exec, PATH) is injected, so these run with no network and install
// nothing. The real install is verified on the runner (spec SC-002, research R7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  CARGO_AUDIT_SHA256, CARGO_AUDIT_URL, PrepareError, RUST_TOOLCHAIN, RUSTUP_INIT_SHA256, RUSTUP_INIT_URL,
  prepare, verifyDigest,
} from '../sast-prepare.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../sast-prepare.mjs');
const REPO_ROOT = resolve(dirname(SCRIPT), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** A recording fake of every effect. `bytes` maps URL → Buffer; `fail` maps a command → exit status. */
function fakeEffects({ bytes = {}, fail = {} } = {}) {
  const calls = { fetched: [], written: [], exec: [], path: [], log: [] };
  return {
    calls,
    fx: {
      home: '/home/runner',
      tmp: '/tmp/prep',
      fetchBytes: async (url) => {
        calls.fetched.push(url);
        if (!(url in bytes)) throw new Error(`unexpected fetch ${url}`);
        return bytes[url];
      },
      writeFile: (path, data, mode) => calls.written.push({ path, mode, size: data.length }),
      exec: (cmd, args, opts = {}) => {
        calls.exec.push({ cmd, args, cwd: opts.cwd ?? null });
        const key = [cmd, ...args].join(' ');
        const hit = Object.entries(fail).find(([k]) => key.includes(k));
        return { status: hit ? hit[1] : 0 };
      },
      appendPath: (dir) => calls.path.push(dir),
      log: (m) => calls.log.push(m),
    },
  };
}

// Payloads whose digests ARE the pins can't be forged, so the happy path swaps the pins for the
// digests of the fake payloads — through the same `pins` seam the CLI never uses.
const RUSTUP_BYTES = Buffer.from('fake rustup-init');
const AUDIT_BYTES = Buffer.from('fake cargo-audit tgz');
const testPins = { rustupInitSha256: sha(RUSTUP_BYTES), cargoAuditSha256: sha(AUDIT_BYTES) };
const okBytes = { [RUSTUP_INIT_URL]: RUSTUP_BYTES, [CARGO_AUDIT_URL]: AUDIT_BYTES };

// ── the pins ────────────────────────────────────────────────────────────────────────────────────────

test('the pins are versioned URLs and full sha256 digests', () => {
  assert.match(RUSTUP_INIT_URL, /^https:\/\/static\.rust-lang\.org\/rustup\/archive\/\d+\.\d+\.\d+\/x86_64-unknown-linux-gnu\/rustup-init$/);
  assert.match(CARGO_AUDIT_URL, /^https:\/\/github\.com\/rustsec\/rustsec\/releases\/download\/cargo-audit%2Fv\d+\.\d+\.\d+\/cargo-audit-x86_64-unknown-linux-musl-v\d+\.\d+\.\d+\.tgz$/);
  assert.match(RUSTUP_INIT_SHA256, /^[0-9a-f]{64}$/);
  assert.match(CARGO_AUDIT_SHA256, /^[0-9a-f]{64}$/);
});

test('the Rust toolchain pin equals the dev-container image\'s (FR-003)', () => {
  const dockerfile = readFileSync(resolve(REPO_ROOT, '.devcontainer/toolchain.Dockerfile'), 'utf8');
  const image = /--default-toolchain\s+(\S+)/.exec(dockerfile)?.[1];
  assert.ok(image, 'toolchain.Dockerfile no longer pins --default-toolchain — update this guard rather than deleting it');
  assert.equal(RUST_TOOLCHAIN, image, 'bump the job and the image together');
});

// ── verification ────────────────────────────────────────────────────────────────────────────────────

test('verifyDigest passes a match and refuses a mismatch, naming both digests', () => {
  verifyDigest('x', RUSTUP_BYTES, sha(RUSTUP_BYTES));
  assert.throws(() => verifyDigest('rustup-init', RUSTUP_BYTES, 'a'.repeat(64)), (e) =>
    e instanceof PrepareError && e.message.includes('rustup-init') && e.message.includes('a'.repeat(64)) && e.message.includes(sha(RUSTUP_BYTES)));
});

// ── rust ────────────────────────────────────────────────────────────────────────────────────────────

test('rust: no tracked Cargo.lock installs nothing and says why', async () => {
  const { fx, calls } = fakeEffects();
  await prepare('rust', { fx, discover: { rust: () => [] } });
  assert.deepEqual([calls.fetched, calls.exec, calls.path], [[], [], []]);
  assert.match(calls.log.join('\n'), /no tracked Cargo\.lock/);
});

test('rust: a tracked Cargo.lock installs the pinned, verified toolchain and cargo-audit', async () => {
  const { fx, calls } = fakeEffects({ bytes: okBytes });
  await prepare('rust', { fx, discover: { rust: () => ['tools/x/Cargo.lock'] }, pins: testPins });
  assert.deepEqual(calls.fetched, [RUSTUP_INIT_URL, CARGO_AUDIT_URL]);
  const rustup = calls.exec.find((c) => c.cmd.endsWith('/rustup-init'));
  assert.deepEqual(rustup.args, ['-y', '--profile', 'minimal', '--default-toolchain', RUST_TOOLCHAIN, '--no-modify-path']);
  assert.ok(calls.written.find((w) => w.path.endsWith('/rustup-init')).mode === 0o755, 'rustup-init must be executable');
  assert.ok(calls.exec.some((c) => c.cmd === 'tar' && c.args.includes('-xzf')), 'the cargo-audit archive is extracted');
  assert.ok(calls.exec.some((c) => c.cmd === 'install' && c.args.at(-1) === '/home/runner/.cargo/bin/cargo-audit'));
  assert.deepEqual(calls.path, ['/home/runner/.cargo/bin']);
  // The scanner calls `cargo audit`, so prove that exact form resolves before the scan needs it.
  assert.ok(calls.exec.some((c) => c.cmd === '/home/runner/.cargo/bin/cargo' && c.args.join(' ') === 'audit --version'));
});

test('rust: a digest mismatch fails BEFORE anything downloaded is executed or written', async () => {
  const { fx, calls } = fakeEffects({ bytes: okBytes });
  await assert.rejects(
    prepare('rust', { fx, discover: { rust: () => ['Cargo.lock'] }, pins: { ...testPins, rustupInitSha256: 'b'.repeat(64) } }),
    PrepareError,
  );
  assert.deepEqual([calls.written, calls.exec], [[], []]);
});

test('rust: a failing rustup-init fails the step', async () => {
  const { fx } = fakeEffects({ bytes: okBytes, fail: { 'rustup-init': 1 } });
  await assert.rejects(prepare('rust', { fx, discover: { rust: () => ['Cargo.lock'] }, pins: testPins }), PrepareError);
});

// ── python ──────────────────────────────────────────────────────────────────────────────────────────

test('python: no tracked project syncs nothing and says why', async () => {
  const { fx, calls } = fakeEffects();
  await prepare('python', { fx, discover: { python: () => [] } });
  assert.deepEqual(calls.exec, []);
  assert.match(calls.log.join('\n'), /no tracked uv\.lock/);
});

test('python: every locked project is synced, frozen, in its own directory', async () => {
  const { fx, calls } = fakeEffects();
  await prepare('python', { fx, discover: { python: () => ['agents/a', 'tools/b'] } });
  assert.deepEqual(calls.exec.map((c) => [c.cmd, c.args.join(' '), c.cwd]), [
    ['uv', 'sync --frozen', resolve(REPO_ROOT, 'agents/a')],
    ['uv', 'sync --frozen', resolve(REPO_ROOT, 'tools/b')],
  ]);
});

test('python: one failing sync fails the step, naming the project — never skipped', async () => {
  const { fx } = fakeEffects({ fail: { 'sync --frozen': 2 } });
  await assert.rejects(prepare('python', { fx, discover: { python: () => ['agents/a'] } }), /agents\/a/);
});

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

const cli = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT });

test('CLI: --help exits 0; no subcommand, an unknown one, or an unknown flag exits 2', () => {
  assert.equal(cli(['--help']).status, 0);
  assert.equal(cli([]).status, 2);
  assert.equal(cli(['ruby']).status, 2);
  assert.equal(cli(['rust', '--dry-run']).status, 2);
});

// ── the trigger: a tracked lockfile must have its scanner enabled (research R5) ─────────────────────

test('a tracked Cargo.lock requires cargo-audit, and a project uv.lock requires pip-audit, in scan.yaml', async () => {
  const { discoverPythonProjects } = await import('../sast-scan.mjs');
  const enabled = new Set(parseYaml(readFileSync(resolve(REPO_ROOT, 'security/sast/scan.yaml'), 'utf8')).scanners);
  const cargo = execFileSync('git', ['ls-files', '--', '*Cargo.lock'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (cargo) assert.ok(enabled.has('cargo-audit'), `Cargo.lock is tracked (${cargo.split('\n')[0]}) — enable cargo-audit in security/sast/scan.yaml (item #39)`);
  const python = discoverPythonProjects(REPO_ROOT).locked;
  if (python.length) assert.ok(enabled.has('pip-audit'), `a Python project is locked (${python[0]}) — enable pip-audit in security/sast/scan.yaml (item #40)`);
});
