// image-scan.mjs: enumerate image references, scan them with Trivy, normalize the findings
// (feature 010). Trivy is never really run here: `spawn` is injected, or a fake `trivy` is put on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrivy, scanImage } from '../image-scan.mjs';

const MAP = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', UNKNOWN: 'Unknown' };
const IMG = 'node:26-bookworm@sha256:' + 'b'.repeat(64);

const trivyJson = (vulns) => ({ Results: [{ Target: 'debian', Vulnerabilities: vulns }] });
const vuln = (over = {}) => ({
  VulnerabilityID: 'CVE-2026-0001', PkgName: 'libfoo', InstalledVersion: '1.2.3', FixedVersion: '1.2.4',
  Severity: 'CRITICAL', Layer: { DiffID: 'sha256:' + 'c'.repeat(64) }, ...over,
});

// ── normalizeTrivy ──────────────────────────────────────────────────────────────────────────────

test('normalizeTrivy: a fixable Critical is blocking, and carries package, versions, layer and locations', () => {
  const [f] = normalizeTrivy(trivyJson([vuln()]), { image: IMG, locations: ['a/Dockerfile:3'], map: MAP });
  assert.deepEqual(f, {
    image: IMG, locations: ['a/Dockerfile:3'], id: 'CVE-2026-0001', pkg: 'libfoo', installed: '1.2.3',
    fixedVersion: '1.2.4', layer: 'sha256:' + 'c'.repeat(64), severity: 'Critical', fixAvailable: true, blocking: true,
  });
});

test('normalizeTrivy: an unfixable Critical is not blocking, and a fixable High is not blocking', () => {
  const out = normalizeTrivy(trivyJson([vuln({ FixedVersion: '' }), vuln({ VulnerabilityID: 'CVE-2', Severity: 'HIGH' })]),
    { image: IMG, locations: [], map: MAP });
  assert.deepEqual(out.map((f) => [f.severity, f.fixAvailable, f.blocking]), [['Critical', false, false], ['High', true, false]]);
});

test('normalizeTrivy: a missing layer is "" and a result with no vulnerabilities adds nothing', () => {
  const out = normalizeTrivy({ Results: [{ Target: 'x' }, { Target: 'y', Vulnerabilities: [vuln({ Layer: undefined })] }] },
    { image: IMG, locations: [], map: MAP });
  assert.equal(out.length, 1);
  assert.equal(out[0].layer, '');
});

test('normalizeTrivy: an unmapped severity is an error, never a silent default', () => {
  assert.throws(() => normalizeTrivy(trivyJson([vuln({ Severity: 'NEGLIGIBLE' })]), { image: IMG, locations: [], map: MAP }),
    /unmapped Trivy severity "NEGLIGIBLE".*CVE-2026-0001/);
});

// ── scanImage ───────────────────────────────────────────────────────────────────────────────────

const ok = (json) => () => ({ status: 0, stdout: JSON.stringify(json), stderr: '' });

test('scanImage (sweep): remote source, linux/amd64, both databases (ghcr then mirror), vuln scanner only, JSON', () => {
  let seen;
  scanImage(IMG, { imageSrc: 'remote', spawn: (cmd, args) => { seen = [cmd, args]; return ok(trivyJson([]))(); } });
  const [cmd, args] = seen;
  assert.equal(cmd, 'trivy');
  assert.equal(args[0], 'image');
  for (const pair of [['--format', 'json'], ['--scanners', 'vuln'], ['--image-src', 'remote'], ['--platform', 'linux/amd64'],
    ['--db-repository', 'ghcr.io/aquasecurity/trivy-db:2,mirror.gcr.io/aquasec/trivy-db:2'],
    ['--java-db-repository', 'ghcr.io/aquasecurity/trivy-java-db:1,mirror.gcr.io/aquasec/trivy-java-db:1']]) {
    const i = args.indexOf(pair[0]);
    assert.ok(i >= 0 && args[i + 1] === pair[1], `${pair.join(' ')} missing from ${args.join(' ')}`);
  }
  assert.ok(args.includes('--no-progress'));
  assert.equal(args.at(-1), IMG);
});

test('scanImage (builder): docker source and NO --platform (the local image is whatever was built)', () => {
  let seen;
  scanImage(IMG, { imageSrc: 'docker', spawn: (_c, args) => { seen = args; return ok(trivyJson([]))(); } });
  assert.equal(seen[seen.indexOf('--image-src') + 1], 'docker');
  assert.ok(!seen.includes('--platform'));
});

test('scanImage: a spawn error (Trivy absent) fails at once, naming the image', () => {
  let n = 0;
  assert.throws(() => scanImage(IMG, { imageSrc: 'remote', spawn: () => { n += 1; return { error: new Error('ENOENT') }; } }),
    (e) => /trivy failed to run for node:26-bookworm/.test(e.message) && /is Trivy installed/.test(e.message));
  assert.equal(n, 1);
});

test('scanImage: a non-transient non-zero exit fails at once, naming the image and the stderr tail', () => {
  let n = 0;
  assert.throws(() => scanImage(IMG, { imageSrc: 'remote', spawn: () => { n += 1; return { status: 1, stdout: '', stderr: 'FATAL image not found: manifest unknown' }; } }),
    (e) => /trivy exited 1 for node:26-bookworm/.test(e.message) && /manifest unknown/.test(e.message));
  assert.equal(n, 1);
});

test('scanImage: unparseable stdout fails, naming the image', () => {
  assert.throws(() => scanImage(IMG, { imageSrc: 'remote', spawn: () => ({ status: 0, stdout: 'not json', stderr: '' }) }),
    /trivy output for node:26-bookworm.* not parseable JSON/);
});

test('scanImage: a database-download blip on STDERR is retried, boundedly, then fails closed', () => {
  let n = 0;
  const spawn = () => { n += 1; return { status: 1, stdout: '', stderr: '[vulndb] Failed to download artifact repo="ghcr.io/aquasecurity/trivy-db:2"' }; };
  assert.throws(() => scanImage(IMG, { imageSrc: 'remote', spawn, attempts: 3, sleep: () => {}, onRetry: () => {} }), /3 attempt/);
  assert.equal(n, 3);
});

test('scanImage: a blip that clears on the retry succeeds', () => {
  let n = 0;
  const spawn = () => { n += 1; return n === 1 ? { status: 1, stdout: '', stderr: 'oci download error: ECONNRESET' } : ok(trivyJson([vuln()]))(); };
  const json = scanImage(IMG, { imageSrc: 'remote', spawn, sleep: () => {}, onRetry: () => {} });
  assert.equal(json.Results[0].Vulnerabilities.length, 1);
  assert.equal(n, 2);
});

test('scanImage: a CVE title on STDOUT that looks like a transport error never triggers a retry', () => {
  let n = 0;
  const spawn = () => { n += 1; return { status: 1, stdout: 'CVE: ECONNRESET handling in libfoo', stderr: 'FATAL scan failed' }; };
  assert.throws(() => scanImage(IMG, { imageSrc: 'remote', spawn, sleep: () => {}, onRetry: () => {} }));
  assert.equal(n, 1);
});

// ── enumerateImages (US2) ───────────────────────────────────────────────────────────────────────
import { enumerateImages, collectTreeFiles, BUILT_IMAGES } from '../image-scan.mjs';
import { readFileSync as readFile } from 'node:fs';
import { dirname as dirOf, resolve as resolvePath } from 'node:path';
import { fileURLToPath as toPath } from 'node:url';

const ROOT = resolvePath(dirOf(toPath(import.meta.url)), '..', '..');
const byRef = (refs) => Object.fromEntries(refs.map((r) => [r.ref, r]));
const DIGEST = 'sha256:' + 'a'.repeat(64);

test('enumerate: Dockerfile FROM with a tag, a digest, and both, each with its form', () => {
  const refs = byRef(enumerateImages([{ path: 'x/Dockerfile', content:
    `FROM alpine:3.20\nFROM debian@${DIGEST}\nFROM node:26-bookworm@${DIGEST}\n` }]));
  assert.equal(refs['alpine:3.20'].form, 'tag');
  assert.equal(refs[`debian@${DIGEST}`].form, 'digest');
  assert.equal(refs[`node:26-bookworm@${DIGEST}`].form, 'tag+digest');
  assert.deepEqual(refs['alpine:3.20'].locations, ['x/Dockerfile:1']);
  assert.equal(refs['alpine:3.20'].owner, 'sweep');
  assert.equal(refs['alpine:3.20'].status, 'scannable');
});

test('enumerate: an ARG default resolves FROM ${BASE_IMAGE}; a built image is owned by its builder', () => {
  const [r] = enumerateImages([{ path: '.devcontainer/Dockerfile', content: 'ARG BASE_IMAGE=belay-devcontainer\nFROM ${BASE_IMAGE}\n' }]);
  assert.equal(r.ref, 'belay-devcontainer');
  assert.equal(r.owner, 'built:belay-devcontainer');
  assert.equal(r.status, 'scannable');
});

test('enumerate: an unresolvable variable is not-scannable, with its location, never dropped', () => {
  const [r] = enumerateImages([{ path: 'a/Dockerfile', content: 'FROM ${NOWHERE}:1\n' }]);
  assert.equal(r.status, 'not-scannable');
  assert.deepEqual(r.locations, ['a/Dockerfile:1']);
});

test('enumerate: FROM scratch, FROM <earlier stage>, and --platform= are handled; stage names are not images', () => {
  const refs = enumerateImages([{ path: 'b/Dockerfile', content:
    'FROM --platform=linux/amd64 golang:1.24 AS build\nFROM build AS test\nFROM scratch\nFROM --platform=$BUILDPLATFORM alpine:3.20\n' }]).map((r) => r.ref);
  assert.deepEqual(refs, ['alpine:3.20', 'golang:1.24']);
});

test('enumerate: compose image: keys under infrastructure-as-code/, quoted or not', () => {
  const refs = enumerateImages([{ path: 'infrastructure-as-code/stack/compose.yaml', content:
    'services:\n  db:\n    image: "postgres:18@' + DIGEST + '"\n  cache:\n    image: redis:8\n' }]);
  assert.deepEqual(refs.map((r) => [r.ref, r.locations[0]]), [
    ['postgres:18@' + DIGEST, 'infrastructure-as-code/stack/compose.yaml:3'], ['redis:8', 'infrastructure-as-code/stack/compose.yaml:5']]);
});

test('enumerate: workflow job containers (string and object form) and service images', () => {
  const refs = enumerateImages([{ path: '.forgejo/workflows/w.yml', content:
    'jobs:\n  a:\n    container: node:26\n  b:\n    container:\n      image: ubuntu:24.04\n    services:\n      pg:\n        image: postgres:18\n' }]);
  assert.deepEqual(refs.map((r) => [r.ref, r.locations[0]]), [
    ['node:26', '.forgejo/workflows/w.yml:3'], ['postgres:18', '.forgejo/workflows/w.yml:9'], ['ubuntu:24.04', '.forgejo/workflows/w.yml:6']]);
});

test('enumerate: one reference in two files is enumerated once, with both locations; output is sorted', () => {
  const refs = enumerateImages([
    { path: 'z/Dockerfile', content: 'FROM redis:8\n' },
    { path: 'a/Dockerfile', content: 'FROM redis:8\nFROM alpine:3.20\n' },
  ]);
  assert.deepEqual(refs.map((r) => r.ref), ['alpine:3.20', 'redis:8']);
  assert.deepEqual(refs[1].locations, ['a/Dockerfile:1', 'z/Dockerfile:1']);
});

test('enumerate: files outside the three forms are not read for images', () => {
  assert.deepEqual(enumerateImages([{ path: 'docs/x.md', content: 'FROM alpine:3.20\nimage: redis:8\n' }]), []);
});

// The REAL tree (SC-003): every FROM / image: / container: line the tree contains is enumerated,
// as some owner. A form the enumeration does not understand fails here, not silently in production.
test('tree guard: every image line in the tree appears in the enumeration', () => {
  const files = collectTreeFiles(ROOT);
  const enumerated = new Set(enumerateImages(files).flatMap((r) => r.locations));
  const IMAGE_LINE = /^\s*(?:FROM\s|image:\s|container:\s*\S)/i;
  const missing = [];
  for (const { path, content } of files) {
    content.split(/\r?\n/).forEach((line, i) => {
      if (!IMAGE_LINE.test(line)) return;
      if (/^\s*FROM\s+(?:--platform=\S+\s+)?scratch\b/i.test(line)) return;
      if (/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i.test(line) && isStage(content, line)) return;
      if (!enumerated.has(`${path}:${i + 1}`)) missing.push(`${path}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(missing, []);
});

function isStage(content, line) {
  const name = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(line)[1];
  return new RegExp(`\\bAS\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(content);
}

test('tree guard: today the tree holds the digest-pinned node base (sweep) and belay-devcontainer (built)', () => {
  const refs = byRef(enumerateImages(collectTreeFiles(ROOT)));
  const node = Object.values(refs).find((r) => r.ref.startsWith('node:26-bookworm@sha256:'));
  assert.ok(node, 'the toolchain base image is enumerated');
  assert.equal(node.owner, 'sweep');
  assert.equal(node.form, 'tag+digest');
  assert.equal(refs['belay-devcontainer']?.owner, 'built:belay-devcontainer');
  assert.ok(BUILT_IMAGES.includes('belay-devcontainer'));
  assert.equal(Object.values(refs).filter((r) => r.status === 'not-scannable').length, 0);
  // Sanity on the reader itself: the toolchain Dockerfile really was read.
  assert.ok(readFile(resolvePath(ROOT, '.devcontainer/toolchain.Dockerfile'), 'utf8').includes(node.ref));
});

// ── --selftest (US2, T015) ──────────────────────────────────────────────────────────────────────
import { imageScanSelftest } from '../image-scan.mjs';
import { spawnSync as spawnReal } from 'node:child_process';

test('selftest: the real enumeration and normalization pass, and the CLI says so', () => {
  assert.deepEqual(imageScanSelftest().failures, []);
  const r = spawnReal(process.execPath, [resolvePath(ROOT, 'scripts/image-scan.mjs'), '--selftest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ image-scan --selftest passed/);
});

test('selftest: an enumeration that drops a FROM line is caught', () => {
  const dropsFrom = (files, opts) => enumerateImages(files.filter((f) => !/Dockerfile/.test(f.path)), opts);
  const { failures } = imageScanSelftest({ enumerateImages: dropsFrom });
  assert.ok(failures.some((f) => /FROM/.test(f)), failures.join('\n'));
});

test('selftest: a normalizer that blocks an unfixable Critical is caught', () => {
  const overBlocks = (json, ctx) => normalizeTrivy(json, ctx).map((f) => ({ ...f, blocking: f.severity === 'Critical' }));
  const { failures } = imageScanSelftest({ normalizeTrivy: overBlocks });
  assert.ok(failures.some((f) => /unfixable/.test(f)), failures.join('\n'));
});

// ── --image: the builder's single-image scan (US1, T019) ────────────────────────────────────────
import { main as imageScanMain } from '../image-scan.mjs';
import { mkdtempSync as mkTmp, mkdirSync as mkDir, writeFileSync as writeF, rmSync as rmR, readFileSync as readF, existsSync as exists } from 'node:fs';
import { tmpdir as tmpDir } from 'node:os';
import { join as joinP } from 'node:path';

function scanRoot() {
  const root = mkTmp(joinP(tmpDir(), 'belay-imgscan-'));
  mkDir(joinP(root, 'security/images'), { recursive: true });
  writeF(joinP(root, 'security/images/severity-map.yaml'), readF(resolvePath(ROOT, 'security/images/severity-map.yaml'), 'utf8'));
  return root;
}

test('--image <ref> --image-src docker: scans exactly that ref, no enumeration, records the built platform', () => {
  const root = scanRoot();
  try {
    const calls = [];
    const spawn = (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'docker') return { status: 0, stdout: 'linux/arm64\n', stderr: '' };
      if (cmd === 'trivy') return { status: 0, stdout: JSON.stringify(trivyJson([vuln()])), stderr: '' };
      return { status: 1, stdout: '', stderr: `unexpected ${cmd}` };
    };
    assert.equal(imageScanMain(['--image', 'reg.example/ns/belay-devcontainer:abc', '--image-src', 'docker'], { root, spawn, log: () => {}, error: () => {} }), 0);
    assert.ok(!calls.some((c) => c.startsWith('git ')), 'no enumeration (git ls-files) for a single-image scan');
    const trivyCall = calls.find((c) => c.startsWith('trivy '));
    assert.match(trivyCall, /--image-src docker/);
    assert.doesNotMatch(trivyCall, /--platform/);
    const report = JSON.parse(readF(joinP(root, 'security/images/reports/findings.json'), 'utf8'));
    assert.equal(report.mode, 'image');
    assert.deepEqual(report.scannedImages, ['reg.example/ns/belay-devcontainer:abc']);
    assert.equal(report.platform, 'linux/arm64');
    assert.deepEqual(report.notScannable, []);
    assert.deepEqual(report.findings[0].locations, []);
  } finally { rmR(root, { recursive: true, force: true }); }
});

test('--image with an unknown --image-src, or no ref, is a usage error (exit 2)', () => {
  const root = scanRoot();
  try {
    const quiet = { root, spawn: () => ({ status: 0, stdout: '{}' }), log: () => {}, error: () => {} };
    assert.equal(imageScanMain(['--image', 'x:1', '--image-src', 'podman'], quiet), 2);
    assert.equal(imageScanMain(['--image'], quiet), 2);
    assert.equal(exists(joinP(root, 'security/images/reports/findings.json')), false);
  } finally { rmR(root, { recursive: true, force: true }); }
});

// ── Measured 2026-11-24 (run 8286): ghcr answered DENIED to the runner while an anonymous token request
// from the dev container got HTTP 200. Trivy sends a GITHUB_TOKEN it finds in its environment to ghcr,
// and a Forgejo token means nothing there. So Trivy runs WITHOUT GitHub tokens, pulling anonymously, and
// mirror.gcr.io is a fallback after ghcr (unreachable from the dev container, so ghcr stays first).
test('scanImage: Trivy runs with no GITHUB_TOKEN / GH_TOKEN in its environment (anonymous ghcr pulls)', () => {
  let env;
  scanImage(IMG, { imageSrc: 'remote', env: { PATH: '/bin', GITHUB_TOKEN: 'forgejo-token', GH_TOKEN: 'x', HOME: '/h' },
    spawn: (_c, _a, opts) => { env = opts.env; return ok(trivyJson([]))(); } });
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/h');
});

test('scanImage: both databases list ghcr first, then mirror.gcr.io as a fallback', () => {
  let args;
  scanImage(IMG, { imageSrc: 'remote', spawn: (_c, a) => { args = a; return ok(trivyJson([]))(); } });
  assert.equal(args[args.indexOf('--db-repository') + 1], 'ghcr.io/aquasecurity/trivy-db:2,mirror.gcr.io/aquasec/trivy-db:2');
  assert.equal(args[args.indexOf('--java-db-repository') + 1], 'ghcr.io/aquasecurity/trivy-java-db:1,mirror.gcr.io/aquasec/trivy-java-db:1');
});

test('the run-8286 DENIED output (verbatim shape) is retried as a database-download failure, then fails closed', () => {
  // The real stderr carries "failed to download vulnerability DB", which scanner-retry.mjs classifies
  // as transient. So it is retried; exhausting the attempts still fails closed, never a clean report.
  let n = 0;
  const stderr = 'FATAL\tFatal error\trun error: init error: DB error: failed to download vulnerability DB: OCI artifact error: '
    + 'failed to download artifact from ghcr.io/aquasecurity/trivy-db:2: GET https://ghcr.io/token?scope=x: DENIED: denied';
  assert.throws(() => scanImage(IMG, { imageSrc: 'remote', spawn: () => { n += 1; return { status: 1, stdout: '', stderr }; }, attempts: 3, sleep: () => {}, onRetry: () => {} }),
    /DENIED/);
  assert.equal(n, 3);
});
