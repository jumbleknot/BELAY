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

test('scanImage (sweep): remote source, linux/amd64, both ghcr databases, vuln scanner only, JSON', () => {
  let seen;
  scanImage(IMG, { imageSrc: 'remote', spawn: (cmd, args) => { seen = [cmd, args]; return ok(trivyJson([]))(); } });
  const [cmd, args] = seen;
  assert.equal(cmd, 'trivy');
  assert.equal(args[0], 'image');
  for (const pair of [['--format', 'json'], ['--scanners', 'vuln'], ['--image-src', 'remote'], ['--platform', 'linux/amd64'],
    ['--db-repository', 'ghcr.io/aquasecurity/trivy-db:2'], ['--java-db-repository', 'ghcr.io/aquasecurity/trivy-java-db:1']]) {
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
