// refresh-pin-checksum.mjs (feature 011, research R7): a version-and-checksum pair moves together.
// The bot moves the version, and this script re-derives the sha256 from the release, requiring the
// publisher's own checksum to agree. Every test injects `fetch`; nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CHECKSUM_PAIRS, refreshPair, verifyChanged, pinChecksumSelftest } from '../refresh-pin-checksum.mjs';

const hex = (b) => createHash('sha256').update(b).digest('hex');
const OLD = 'a'.repeat(64);
const BYTES = Buffer.from('release bytes v2');
const GOOD = hex(BYTES);

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'pin-checksum-'));
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), t); }
  return root;
}
const TRIVY = (v, sha) => `export const TRIVY_PIN = Object.freeze({\n  version: '${v}',\n  asset: 'trivy_${v}_Linux-64bit.tar.gz',\n  sha256: '${sha}',\n});\n`;
const SAST = (rv, rs, cv, cs) => `export const RUSTUP_VERSION = '${rv}';\nexport const RUSTUP_INIT_SHA256 = '${rs}';\nexport const CARGO_AUDIT_VERSION = '${cv}';\nexport const CARGO_AUDIT_SHA256 = '${cs}';\n`;

// A fake fetch: url → Buffer (bytes), string (text) or object (json). An unknown url is a 404.
function fakeFetch(routes) {
  const seen = [];
  const f = async (url) => {
    seen.push(url);
    if (!(url in routes)) return { ok: false, status: 404 };
    const v = routes[url];
    return { ok: true, status: 200,
      arrayBuffer: async () => (Buffer.isBuffer(v) ? v : Buffer.from(String(v))),
      text: async () => (Buffer.isBuffer(v) ? v.toString() : typeof v === 'string' ? v : JSON.stringify(v)),
      json: async () => v };
  };
  f.seen = seen;
  return f;
}
const TRIVY_ASSET = 'https://github.com/aquasecurity/trivy/releases/download/v0.77.0/trivy_0.77.0_Linux-64bit.tar.gz';
const TRIVY_SUMS = 'https://github.com/aquasecurity/trivy/releases/download/v0.77.0/trivy_0.77.0_checksums.txt';
const trivyRoutes = (published = GOOD) => ({ [TRIVY_ASSET]: BYTES, [TRIVY_SUMS]: `${'c'.repeat(64)}  trivy_0.77.0_Linux-ARM64.tar.gz\n${published}  trivy_0.77.0_Linux-64bit.tar.gz\n` });

test('CHECKSUM_PAIRS names the three pairs, each with its installer file', () => {
  assert.deepEqual(CHECKSUM_PAIRS.map((p) => [p.pin, p.file]), [
    ['trivy', 'scripts/install-trivy.mjs'], ['rustup-init', 'scripts/sast-prepare.mjs'], ['cargo-audit', 'scripts/sast-prepare.mjs']]);
});

test('refreshPair(trivy) rewrites only the sha256, when the bytes match the published checksums file', async () => {
  const root = repo({ 'scripts/install-trivy.mjs': TRIVY('0.77.0', OLD) });
  const r = await refreshPair('trivy', { root, fetch: fakeFetch(trivyRoutes()), log: () => {} });
  assert.equal(r.changed, true);
  assert.equal(readFileSync(join(root, 'scripts/install-trivy.mjs'), 'utf8'), TRIVY('0.77.0', GOOD));
});

test('refreshPair: a publisher mismatch fails, naming the pair, the URL and both digests, and changes nothing', async () => {
  const root = repo({ 'scripts/install-trivy.mjs': TRIVY('0.77.0', OLD) });
  await assert.rejects(refreshPair('trivy', { root, fetch: fakeFetch(trivyRoutes('d'.repeat(64))), log: () => {} }),
    (e) => /trivy/.test(e.message) && e.message.includes(TRIVY_ASSET) && e.message.includes(GOOD) && e.message.includes('d'.repeat(64)));
  assert.equal(readFileSync(join(root, 'scripts/install-trivy.mjs'), 'utf8'), TRIVY('0.77.0', OLD));
});

test('refreshPair: a download that fails changes nothing', async () => {
  const root = repo({ 'scripts/install-trivy.mjs': TRIVY('0.77.0', OLD) });
  await assert.rejects(refreshPair('trivy', { root, fetch: fakeFetch({}), log: () => {} }), /404/);
  assert.equal(readFileSync(join(root, 'scripts/install-trivy.mjs'), 'utf8'), TRIVY('0.77.0', OLD));
});

test('refreshPair(trivy): an asset name still on the old version fails (the version moved alone)', async () => {
  const root = repo({ 'scripts/install-trivy.mjs': TRIVY('0.77.0', OLD).replace("trivy_0.77.0_Linux", "trivy_0.76.2_Linux") });
  await assert.rejects(refreshPair('trivy', { root, fetch: fakeFetch(trivyRoutes()), log: () => {} }), /asset/);
});

test('refreshPair(rustup-init) checks the published .sha256 file', async () => {
  const url = 'https://static.rust-lang.org/rustup/archive/1.30.0/x86_64-unknown-linux-gnu/rustup-init';
  const root = repo({ 'scripts/sast-prepare.mjs': SAST('1.30.0', OLD, '0.23.0', OLD) });
  const r = await refreshPair('rustup-init', { root, fetch: fakeFetch({ [url]: BYTES, [`${url}.sha256`]: `${GOOD}  rustup-init\n` }), log: () => {} });
  assert.equal(r.changed, true);
  assert.equal(readFileSync(join(root, 'scripts/sast-prepare.mjs'), 'utf8'), SAST('1.30.0', GOOD, '0.23.0', OLD));
});

test('refreshPair(cargo-audit) checks the digest the release API reports for the asset', async () => {
  const asset = 'cargo-audit-x86_64-unknown-linux-musl-v0.24.0.tgz';
  const url = `https://github.com/rustsec/rustsec/releases/download/cargo-audit%2Fv0.24.0/${asset}`;
  const api = 'https://api.github.com/repos/rustsec/rustsec/releases/tags/cargo-audit%2Fv0.24.0';
  const root = repo({ 'scripts/sast-prepare.mjs': SAST('1.29.3', OLD, '0.24.0', OLD) });
  const r = await refreshPair('cargo-audit', { root, fetch: fakeFetch({ [url]: BYTES, [api]: { assets: [{ name: asset, digest: `sha256:${GOOD}` }] } }), log: () => {} });
  assert.equal(r.changed, true);
  assert.match(readFileSync(join(root, 'scripts/sast-prepare.mjs'), 'utf8'), new RegExp(`CARGO_AUDIT_SHA256 = '${GOOD}'`));
});

test('refreshPair(cargo-audit): an API answer with no digest for the asset fails, never trusting the bytes alone', async () => {
  const asset = 'cargo-audit-x86_64-unknown-linux-musl-v0.24.0.tgz';
  const url = `https://github.com/rustsec/rustsec/releases/download/cargo-audit%2Fv0.24.0/${asset}`;
  const api = 'https://api.github.com/repos/rustsec/rustsec/releases/tags/cargo-audit%2Fv0.24.0';
  const root = repo({ 'scripts/sast-prepare.mjs': SAST('1.29.3', OLD, '0.24.0', OLD) });
  await assert.rejects(refreshPair('cargo-audit', { root, fetch: fakeFetch({ [url]: BYTES, [api]: { assets: [{ name: asset }] } }), log: () => {} }), /no published digest/);
});

test('verifyChanged checks only pairs whose version or sha256 moved, and passes when they agree', async () => {
  const base = { 'scripts/install-trivy.mjs': TRIVY('0.76.2', OLD), 'scripts/sast-prepare.mjs': SAST('1.29.3', OLD, '0.23.0', OLD) };
  const head = { 'scripts/install-trivy.mjs': TRIVY('0.77.0', GOOD), 'scripts/sast-prepare.mjs': SAST('1.29.3', OLD, '0.23.0', OLD) };
  const root = repo(head);
  const f = fakeFetch(trivyRoutes());
  const r = await verifyChanged({ root, readBase: (file) => base[file], fetch: f, log: () => {} });
  assert.deepEqual(r, { checked: ['trivy'], failures: [] });
  assert.ok(f.seen.every((u) => u.includes('trivy')), 'an unchanged pair must download nothing');
});

test('verifyChanged fails a pair whose version moved alone', async () => {
  const base = { 'scripts/install-trivy.mjs': TRIVY('0.76.2', OLD) };
  const root = repo({ 'scripts/install-trivy.mjs': TRIVY('0.77.0', OLD), 'scripts/sast-prepare.mjs': SAST('1.29.3', OLD, '0.23.0', OLD) });
  const r = await verifyChanged({ root, readBase: (file) => base[file] ?? readFileSync(join(root, file), 'utf8'), fetch: fakeFetch(trivyRoutes()), log: () => {} });
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /trivy/);
  assert.ok(r.failures[0].includes(GOOD) && r.failures[0].includes(OLD));
});

test('verifyChanged with nothing changed downloads nothing and passes', async () => {
  const files = { 'scripts/install-trivy.mjs': TRIVY('0.76.2', OLD), 'scripts/sast-prepare.mjs': SAST('1.29.3', OLD, '0.23.0', OLD) };
  const f = fakeFetch({});
  const r = await verifyChanged({ root: repo(files), readBase: (file) => files[file], fetch: f, log: () => {} });
  assert.deepEqual(r, { checked: [], failures: [] });
  assert.equal(f.seen.length, 0);
});

test('the pairs read each version from the installer\'s own constant (no second copy here)', () => {
  const src = readFileSync(new URL('../refresh-pin-checksum.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /'0\.76\.2'|'1\.29\.3'|'0\.23\.0'/, 'a pinned version is hardcoded in the refresh script');
});

test('selftest passes, using injected fixtures only', async () => {
  assert.deepEqual((await pinChecksumSelftest()).failures, []);
});

test('the CLI refuses an unknown pair with exit 2', () => {
  const r = spawnSync(process.execPath, [new URL('../refresh-pin-checksum.mjs', import.meta.url).pathname, 'nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});
