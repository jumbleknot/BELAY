// check-image-findings.mjs: the image-scan gate (feature 010). Pure: a report, an allowlist and
// `today` in, a verdict out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, formatVerdict } from '../check-image-findings.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-image-findings.mjs');
const TODAY = '2026-11-24';
const IMG = 'node:26-bookworm@sha256:' + 'b'.repeat(64);

const finding = (over = {}) => ({
  image: IMG, locations: ['.devcontainer/toolchain.Dockerfile:20'], id: 'CVE-2026-0001', pkg: 'libfoo', installed: '1.2.3',
  fixedVersion: '1.2.4', layer: 'sha256:' + 'c'.repeat(64), severity: 'Critical', fixAvailable: true, blocking: true, ...over,
});
const report = (findings, over = {}) => ({ schemaVersion: 1, mode: 'sweep', scannedImages: [IMG], platform: 'linux/amd64', notScannable: [], findings, ...over });

test('a clean report passes, and the verdict line says how many images were scanned', () => {
  const v = evaluate(report([]), [], TODAY);
  assert.equal(v.ok, true);
  assert.equal(v.scanned, 1);
  assert.match(formatVerdict(v).at(-1), /^\[image-scan\] ✅ 1 image scanned: 0 blocking · 0 allowlisted · 0 warnings$/);
});

test('a fixable Critical fails, naming the advisory, package, installed → fixed, image and layer', () => {
  const v = evaluate(report([finding()]), [], TODAY);
  assert.equal(v.ok, false);
  assert.equal(v.blocking.length, 1);
  const lines = formatVerdict(v);
  assert.ok(lines.some((l) => l === `[image-scan] ✗ BLOCKING CVE-2026-0001 libfoo 1.2.3 → 1.2.4 (Critical) in ${IMG} (layer sha256:${'c'.repeat(12)}…)`), lines.join('\n'));
  assert.match(lines.at(-1), /^\[image-scan\] ❌ 1 image scanned: 1 blocking · 0 allowlisted/);
});

test('an unfixable Critical is a warning: the gate passes and counts it', () => {
  const v = evaluate(report([finding({ fixedVersion: '', fixAvailable: false, blocking: false })]), [], TODAY);
  assert.equal(v.ok, true);
  assert.match(formatVerdict(v).at(-1), /✅ 1 image scanned: 0 blocking · 0 allowlisted · 1 Critical \(no fix\) \(warnings\)$/);
});

test('warnings are COUNTS by severity in the verdict line, never one line per finding', () => {
  const many = [
    ...Array.from({ length: 3 }, (_, i) => finding({ id: `H-${i}`, severity: 'High', blocking: false })),
    ...Array.from({ length: 41 }, (_, i) => finding({ id: `M-${i}`, severity: 'Medium', blocking: false })),
    ...Array.from({ length: 102 }, (_, i) => finding({ id: `L-${i}`, severity: 'Low', blocking: false })),
  ];
  const lines = formatVerdict(evaluate(report(many), [], TODAY));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /✅ 1 image scanned: 0 blocking · 0 allowlisted · 3 High · 41 Medium · 102 Low \(warnings\)$/);
});

test('zero images scanned fails, and says so: a skipped scan is never "clean" (FR-005)', () => {
  const v = evaluate(report([], { scannedImages: [] }), [], TODAY);
  assert.equal(v.ok, false);
  assert.match(formatVerdict(v).at(-1), /^\[image-scan\] ❌ 0 images scanned/);
});

test('a not-scannable reference fails the verdict, naming it and where it is (spec US2-AC3)', () => {
  const v = evaluate(report([], { notScannable: [{ ref: '${REGISTRY}/x:1', locations: ['infrastructure-as-code/a.yaml:4'] }] }), [], TODAY);
  assert.equal(v.ok, false);
  assert.ok(formatVerdict(v).some((l) => l.includes('✗ NOT SCANNABLE ${REGISTRY}/x:1 (infrastructure-as-code/a.yaml:4)')));
});

test('a report without a scannedImages array is refused: unmatched detection needs the scanned set', () => {
  assert.throws(() => evaluate({ schemaVersion: 1, findings: [] }, [], TODAY), (e) => e.exitCode === 1 && /scannedImages/.test(e.message));
});

test('the CLI: a missing report fails closed, "report missing: nothing was scanned"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'belay-imgfind-'));
  try {
    const r = spawnSync(process.execPath, [CLI, '--report', join(dir, 'nope.json'), '--allowlist', join(dir, 'none.yaml')], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /report missing: nothing was scanned/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI: a passing report exits 0 with the ✅ line last; a blocking one exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'belay-imgfind-'));
  try {
    const allow = join(dir, 'allow.yaml');
    writeFileSync(allow, '[]\n');
    const clean = join(dir, 'clean.json');
    writeFileSync(clean, JSON.stringify(report([])));
    const r1 = spawnSync(process.execPath, [CLI, '--report', clean, '--allowlist', allow], { encoding: 'utf8' });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.match(r1.stdout.trim().split('\n').at(-1), /✅ 1 image scanned/);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify(report([finding()])));
    const r2 = spawnSync(process.execPath, [CLI, '--report', bad, '--allowlist', allow], { encoding: 'utf8' });
    assert.equal(r2.status, 1, r2.stdout + r2.stderr);
    assert.match(r2.stdout.trim().split('\n').at(-1), /❌ 1 image scanned: 1 blocking/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI: --verdict-out writes the verdict line to a file, for the status step to post (pass or fail)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'belay-imgfind-'));
  try {
    const allow = join(dir, 'allow.yaml');
    writeFileSync(allow, '[]\n');
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify(report([finding()])));
    const out = join(dir, 'verdict.txt');
    const r = spawnSync(process.execPath, [CLI, '--report', bad, '--allowlist', allow, '--verdict-out', out], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(readFileSync(out, 'utf8').trim(), /^\[image-scan\] ❌ 1 image scanned: 1 blocking/);
    const missing = join(dir, 'verdict2.txt');
    spawnSync(process.execPath, [CLI, '--report', join(dir, 'nope.json'), '--allowlist', allow, '--verdict-out', missing], { encoding: 'utf8' });
    assert.match(readFileSync(missing, 'utf8'), /report missing: nothing was scanned/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── --publish-verdict: the sweep/verdict commit status ──────────────────────────────────
import { publishVerdict } from '../check-image-findings.mjs';

const ENV = { GITHUB_SERVER_URL: 'https://forge.example', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_NUMBER: '7', GITHUB_TOKEN: 'tok', JOB_STATUS: 'success' };

test('publishVerdict: posts sweep/verdict with the verdict line as its description, on the run sha', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'belay-imgverdict-'));
  try {
    const f = join(dir, 'v.txt');
    writeFileSync(f, '[image-scan] ✅ 1 image scanned: 0 blocking · 0 allowlisted · 0 warnings\n');
    let call;
    const code = await publishVerdict(f, { env: ENV, fetch: async (url, init) => { call = { url, init }; return { ok: true, status: 201 }; }, log: () => {} });
    assert.equal(code, 0);
    assert.equal(call.url, `https://forge.example/api/v1/repos/o/r/statuses/${'a'.repeat(40)}`);
    assert.equal(call.init.headers.Authorization, 'token tok');
    const body = JSON.parse(call.init.body);
    assert.deepEqual([body.state, body.context, body.description], ['success', 'sweep/verdict', '✅ 1 image scanned: 0 blocking · 0 allowlisted · 0 warnings']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('publishVerdict: failure when the job failed or the line is ❌, and "no verdict" when the file is missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'belay-imgverdict-'));
  try {
    const f = join(dir, 'v.txt');
    writeFileSync(f, '[image-scan] ✅ 1 image scanned: 0 blocking · 0 allowlisted · 0 warnings\n');
    const states = [];
    const fetch = async (_u, init) => { states.push(JSON.parse(init.body)); return { ok: true, status: 201 }; };
    await publishVerdict(f, { env: { ...ENV, JOB_STATUS: 'failure' }, fetch, log: () => {} });
    writeFileSync(f, '[image-scan] ❌ 1 image scanned: 1 blocking · 0 allowlisted · 0 warnings\n');
    await publishVerdict(f, { env: ENV, fetch, log: () => {} });
    await publishVerdict(join(dir, 'missing.txt'), { env: ENV, fetch, log: () => {} });
    assert.deepEqual(states.map((s) => s.state), ['failure', 'failure', 'failure']);
    assert.match(states[2].description, /the sweep failed before a verdict/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('publishVerdict: a rejected POST, or a missing token, exits 1 naming the cause', async () => {
  const log = () => {};
  assert.equal(await publishVerdict('/nonexistent', { env: ENV, fetch: async () => ({ ok: false, status: 403 }), log, error: log }), 1);
  const { GITHUB_TOKEN, ...noToken } = ENV;
  const errors = [];
  assert.equal(await publishVerdict('/nonexistent', { env: noToken, fetch: async () => ({ ok: true }), log, error: (m) => errors.push(m) }), 1);
  assert.match(errors.join('\n'), /GITHUB_TOKEN/);
});
