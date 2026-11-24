#!/usr/bin/env node
// image-scan.mjs: container-image CVE scanning (feature 010, backlog item 49). Ported from
// MovieCollectionManager's infra-image-scan.mjs (feature 035), with BELAY's changes
// (specs/010-image-cve-scan/research.md, R7).
//
// Trivy runs, this script normalizes what it reports, and scripts/check-image-findings.mjs judges.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { isMain } from './lib/is-main.mjs';
import { retryTransient, transientOr, readTail } from './lib/scanner-retry.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SEVERITY_MAP_PATH = 'security/images/severity-map.yaml';

// Research R2: Trivy's default mirror (mirror.gcr.io) is not in the dev container's egress list, and
// MCM measured the scan dying with a DNS error that named a host nobody chose. ghcr is allowlisted,
// so BOTH databases come from it, in CI and locally alike.
// ghcr first (reachable from the dev container), then mirror.gcr.io (Trivy's own default) as a fallback,
// so one registry's refusal does not fail the sweep. Trivy tries the list in order.
export const DB_REPOSITORY = 'ghcr.io/aquasecurity/trivy-db:2,mirror.gcr.io/aquasec/trivy-db:2';
export const JAVA_DB_REPOSITORY = 'ghcr.io/aquasecurity/trivy-java-db:1,mirror.gcr.io/aquasec/trivy-java-db:1';

// MEASURED 2026-11-24 (run 8286): ghcr answered `DENIED: denied` to the runner, while the same anonymous
// token request from the dev container got HTTP 200. Trivy sends a GITHUB_TOKEN it finds in its
// environment to ghcr, and the CI runner's token is a Forgejo token, meaningless there. Trivy therefore
// runs WITHOUT these, so its registry pulls are anonymous. Public images and databases need no credential.
const TOKENS_TRIVY_MUST_NOT_SEE = ['GITHUB_TOKEN', 'GH_TOKEN'];
export const SWEEP_PLATFORM = 'linux/amd64';

export class ImageScanError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

/** Trivy native severity → normalized severity, from security/images/severity-map.yaml. */
export function loadSeverityMap(path = resolve(REPO_ROOT, SEVERITY_MAP_PATH)) {
  const map = parseYaml(readFileSync(path, 'utf8'))?.trivy;
  if (!map || typeof map !== 'object') throw new ImageScanError(`${SEVERITY_MAP_PATH} has no "trivy" mapping`, 2);
  return map;
}

/**
 * Trivy JSON → normalized findings (data-model.md, Finding). Blocking is decided here, BEFORE any
 * allowlist: a Critical with a fixed version (spec FR-003). An unfixable Critical cannot be cleared
 * by a bump, so it must not wedge the gate; everything below Critical is a warning.
 */
export function normalizeTrivy(trivyJson, { image, locations, map }) {
  const out = [];
  for (const r of trivyJson?.Results ?? []) {
    for (const v of r.Vulnerabilities ?? []) {
      const native = v.Severity ?? 'UNKNOWN';
      const severity = map[native];
      if (!severity) throw new ImageScanError(`unmapped Trivy severity "${native}" for ${image} (${v.VulnerabilityID}) — add it to ${SEVERITY_MAP_PATH}`, 2);
      const fixedVersion = v.FixedVersion ?? '';
      const fixAvailable = fixedVersion !== '';
      out.push({
        image,
        locations: [...locations],
        id: String(v.VulnerabilityID),
        pkg: String(v.PkgName ?? ''),
        installed: String(v.InstalledVersion ?? ''),
        fixedVersion,
        layer: String(v.Layer?.DiffID ?? ''),
        severity,
        fixAvailable,
        blocking: severity === 'Critical' && fixAvailable,
      });
    }
  }
  return out;
}

/**
 * Run Trivy on one image, retrying only a classified TRANSPORT failure (scripts/lib/scanner-retry.mjs).
 * Fail-closed throughout: Trivy absent, image not found, or unparseable output throws on the first
 * attempt, and exhausting the attempts still throws.
 *
 * CLASSIFY ON STDERR ONLY: stdout carries the vulnerability report, so a CVE's own title must never
 * decide whether a scan is retried.
 *
 * `--platform` only for a REMOTE pull, where it selects a manifest. A builder scan reads the image
 * the runner just built, whatever its architecture (research, analyze finding U2).
 */
export function scanImage(ref, { imageSrc, spawn = spawnSync, env = process.env, ...retryOpts } = {}) {
  if (imageSrc !== 'remote' && imageSrc !== 'docker') throw new ImageScanError(`--image-src must be remote or docker (got ${imageSrc})`, 2);
  const args = [
    'image', '--format', 'json', '--no-progress', '--scanners', 'vuln',
    '--db-repository', DB_REPOSITORY, '--java-db-repository', JAVA_DB_REPOSITORY,
    '--image-src', imageSrc,
    ...(imageSrc === 'remote' ? ['--platform', SWEEP_PLATFORM] : []),
    ref,
  ];
  return retryTransient(`trivy ${ref}`, () => {
    const childEnv = { ...env };
    for (const k of TOKENS_TRIVY_MUST_NOT_SEE) delete childEnv[k];
    const res = spawn('trivy', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: childEnv });
    if (res.error) throw new ImageScanError(`trivy failed to run for ${ref}: ${res.error.message} (is Trivy installed and on PATH?)`);
    if (res.status !== 0) {
      throw transientOr(`trivy exited ${res.status} for ${ref} (fail-closed): ${readTail(res.stderr ?? '')}`, res.stderr ?? '', ImageScanError);
    }
    try {
      return JSON.parse(res.stdout);
    } catch (e) {
      throw new ImageScanError(`trivy output for ${ref} was not parseable JSON (fail-closed): ${e.message}`);
    }
  }, { logPrefix: 'image-scan', ...retryOpts });
}

// ── enumeration (research R3; data-model.md, Image reference) ───────────────────────────────────

/**
 * The images BELAY's own workflows build. Each is scanned by its BUILDER, before its push, and is
 * excluded from the sweep: every image has exactly one owner. Membership, NEVER a name prefix: MCM's
 * prefix rule once excluded an image that no builder scanned, so it was published examined by
 * neither side.
 */
export const BUILT_IMAGES = Object.freeze(['belay-devcontainer']);

const DOCKERFILE = /(?:^|\/)[^/]*Dockerfile[^/]*$/;
const COMPOSE = /^infrastructure-as-code\/.+\.ya?ml$/;
const WORKFLOW = /^\.forgejo\/workflows\/[^/]+\.ya?ml$/;
const FROM_LINE = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i;
const ARG_LINE = /^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:=(?:"([^"]*)"|'([^']*)'|(\S*)))?/i;
const IMAGE_KEY = /^\s*image:\s*["']?((?:\$\{[^}]*\}|[^"'#\s])+)["']?/;
const CONTAINER_STRING = /^\s*container:\s*["']?((?:\$\{[^}]*\}|[^"'#\s{])+)["']?\s*$/;

/** The files that can name images: Dockerfiles, compose under infrastructure-as-code/, workflows. */
export function collectTreeFiles(root = REPO_ROOT, { spawn = spawnSync } = {}) {
  const r = spawn('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new ImageScanError(`git ls-files failed: ${(r.stderr || '').slice(-300)}`);
  return (r.stdout || '').split('\0').filter(Boolean)
    .filter((p) => !p.startsWith('scripts/__tests__/') && (DOCKERFILE.test(p) || COMPOSE.test(p) || WORKFLOW.test(p)))
    .sort()
    .map((path) => ({ path, content: readFileSync(resolve(root, path), 'utf8') }));
}

function dockerfileRefs(path, content) {
  const args = new Map();
  const stages = new Set();
  const out = [];
  content.split(/\r?\n/).forEach((line, i) => {
    const a = ARG_LINE.exec(line);
    if (a) {
      const value = a[2] ?? a[3] ?? a[4];
      if (value !== undefined && value !== '') args.set(a[1], value);
      return;
    }
    const m = FROM_LINE.exec(line);
    if (!m) return;
    const raw = m[1];
    if (m[2]) stages.add(m[2]);
    if (raw.toLowerCase() === 'scratch' || stages.has(raw) && raw !== m[2]) return;
    // ${NAME} / $NAME resolve only from an ARG with a default; anything left stays visible.
    const ref = raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
      (whole, b, c) => args.get(b ?? c) ?? whole);
    out.push({ ref, location: `${path}:${i + 1}` });
  });
  return out;
}

function lineRefs(path, content, patterns) {
  const out = [];
  content.split(/\r?\n/).forEach((line, i) => {
    for (const re of patterns) {
      const m = re.exec(line);
      if (m) { out.push({ ref: m[1], location: `${path}:${i + 1}` }); break; }
    }
  });
  return out;
}

const formOf = (ref) => {
  if (!ref.includes('@sha256:')) return 'tag';
  const name = ref.split('@')[0];
  return name.slice(name.lastIndexOf('/') + 1).includes(':') ? 'tag+digest' : 'digest';
};
const bareName = (ref) => ref.split('@')[0].split('/').pop().split(':')[0];

/** Every image reference the files name, once each, with every location (data-model.md, Image reference). */
export function enumerateImages(files, { builtImages = BUILT_IMAGES } = {}) {
  const byRef = new Map();
  for (const { path, content } of files) {
    let found = [];
    if (DOCKERFILE.test(path)) found = dockerfileRefs(path, content);
    else if (COMPOSE.test(path)) found = lineRefs(path, content, [IMAGE_KEY]);
    else if (WORKFLOW.test(path)) found = lineRefs(path, content, [CONTAINER_STRING, IMAGE_KEY]);
    for (const { ref, location } of found) {
      if (!byRef.has(ref)) {
        const owner = builtImages.includes(bareName(ref)) ? `built:${bareName(ref)}` : 'sweep';
        byRef.set(ref, { ref, locations: [], form: formOf(ref), owner, status: ref.includes('$') ? 'not-scannable' : 'scannable' });
      }
      byRef.get(ref).locations.push(location);
    }
  }
  return [...byRef.values()]
    .map((r) => ({ ...r, locations: [...r.locations].sort() }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

// ── --selftest ──────────────────────────────────────────────────────────────────────────────────
// Enumeration and normalization on synthetic input, before CI trusts a real sweep: an enumeration
// that silently stopped seeing a reference form would otherwise report a truthful, meaningless zero.
// `deps` lets the tests break one stage and watch the selftest name it.

const ST_DIGEST = `sha256:${'a'.repeat(64)}`;
const ST_FILES = [
  { path: 'x/Dockerfile', content: `ARG BASE=belay-devcontainer\nFROM \${BASE}\nFROM golang:1.24 AS build\nFROM build\nFROM scratch\nFROM node:26@${ST_DIGEST}\n` },
  { path: 'infrastructure-as-code/s/compose.yaml', content: 'services:\n  db:\n    image: postgres:18\n' },
  { path: '.forgejo/workflows/w.yml', content: 'jobs:\n  a:\n    container: ubuntu:24.04\n' },
];
const ST_MAP = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', UNKNOWN: 'Unknown' };

export function imageScanSelftest(deps = {}) {
  const d = { enumerateImages, normalizeTrivy, ...deps };
  const failures = [];
  try {
    const refs = Object.fromEntries(d.enumerateImages(ST_FILES).map((r) => [r.ref, r]));
    const want = (ref, check, what) => { if (!refs[ref] || !check(refs[ref])) failures.push(`enumeration: ${what}`); };
    want('golang:1.24', (r) => r.owner === 'sweep', 'a Dockerfile FROM line was not enumerated');
    want(`node:26@${ST_DIGEST}`, (r) => r.form === 'tag+digest', 'a digest-pinned FROM line was not enumerated with its form');
    want('belay-devcontainer', (r) => r.owner === 'built:belay-devcontainer', 'an ARG-resolved built image was not owned by its builder');
    want('postgres:18', () => true, 'a compose image: key was not enumerated');
    want('ubuntu:24.04', () => true, 'a workflow container was not enumerated');
    for (const bad of ['scratch', 'build']) if (refs[bad]) failures.push(`enumeration: "${bad}" was treated as an image`);
  } catch (e) {
    failures.push(`enumeration threw: ${e.message}`);
  }
  try {
    const json = { Results: [{ Vulnerabilities: [
      { VulnerabilityID: 'CVE-FIX', PkgName: 'a', InstalledVersion: '1', FixedVersion: '2', Severity: 'CRITICAL' },
      { VulnerabilityID: 'CVE-NOFIX', PkgName: 'b', InstalledVersion: '1', FixedVersion: '', Severity: 'CRITICAL' },
      { VulnerabilityID: 'CVE-HIGH', PkgName: 'c', InstalledVersion: '1', FixedVersion: '2', Severity: 'HIGH' },
    ] }] };
    const byId = Object.fromEntries(d.normalizeTrivy(json, { image: 'x:1', locations: [], map: ST_MAP }).map((f) => [f.id, f]));
    if (!byId['CVE-FIX']?.blocking) failures.push('normalization: a fixable Critical was not blocking');
    if (byId['CVE-NOFIX']?.blocking !== false) failures.push('normalization: an unfixable Critical was blocking (it must warn)');
    if (byId['CVE-HIGH']?.blocking !== false) failures.push('normalization: a fixable High was blocking (it must warn)');
  } catch (e) {
    failures.push(`normalization threw: ${e.message}`);
  }
  return { failures };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

export const REPORT_DIR = 'security/images/reports';
const USAGE = 'Usage: image-scan.mjs [--root <dir>] --list | (sweep) | --image <ref> [--image-src docker|remote] | --selftest';

function writeReport(root, report, natives) {
  const dir = resolve(root, REPORT_DIR);
  mkdirSync(dir, { recursive: true });
  natives.forEach((n, i) => writeFileSync(resolve(dir, `trivy-${i + 1}.json`), JSON.stringify(n, null, 2)));
  writeFileSync(resolve(dir, 'findings.json'), JSON.stringify(report, null, 2));
}

/**
 * The BUILDER path (US1): scan exactly one image, with no enumeration. A docker-source scan records
 * the built image's real platform, because no --platform is forced on a local image (analyze U2).
 */
function scanOne({ root, image, imageSrc, spawn, log, retry }) {
  if (imageSrc !== 'remote' && imageSrc !== 'docker') throw new ImageScanError(`--image-src must be remote or docker (got ${imageSrc})`, 2);
  rmSync(resolve(root, REPORT_DIR, 'findings.json'), { force: true });
  const map = loadSeverityMap(resolve(root, SEVERITY_MAP_PATH));
  let platform = SWEEP_PLATFORM;
  if (imageSrc === 'docker') {
    const r = spawn('docker', ['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', image], { encoding: 'utf8' });
    if (r.error || r.status !== 0) throw new ImageScanError(`docker image inspect failed for ${image}: ${r.error?.message ?? readTail(r.stderr ?? '')}`);
    platform = String(r.stdout).trim();
  }
  const json = scanImage(image, { imageSrc, spawn, ...retry });
  const findings = normalizeTrivy(json, { image, locations: [], map });
  writeReport(root, { schemaVersion: 1, mode: 'image', scannedImages: [image], platform, notScannable: [], findings }, [json]);
  log(`[image-scan] scanned ${image} (${platform}): ${findings.length} finding(s), ${findings.filter((f) => f.blocking).length} fixable Critical`);
  return 0;
}

export function main(argv, { root: rootDefault = REPO_ROOT, spawn = spawnSync, log = console.log, error = console.error, retry = {} } = {}) {
  let root = rootDefault;
  try {
    const flags = new Set();
    let image = null;
    let imageSrc = null;
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--list' || a === '--selftest') flags.add(a);
      else if (a === '--root') {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw new ImageScanError(`--root needs a directory\n${USAGE}`, 2);
        root = resolve(v);
      } else if (a === '--image' || a === '--image-src') {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw new ImageScanError(`${a} needs a value\n${USAGE}`, 2);
        if (a === '--image') image = v; else imageSrc = v;
      } else throw new ImageScanError(`unknown argument ${a}\n${USAGE}`, 2);
    }
    if (imageSrc !== null && image === null) throw new ImageScanError(`--image-src needs --image\n${USAGE}`, 2);
    if (image !== null) return scanOne({ root, image, imageSrc: imageSrc ?? 'docker', spawn, log, retry });
    if (flags.has('--selftest')) {
      const { failures } = imageScanSelftest();
      for (const f of failures) error(`✗ image-scan --selftest: ${f}`);
      if (failures.length) return 1;
      log('✓ image-scan --selftest passed (Dockerfile FROM incl. ARG defaults, stages and scratch; compose image:; workflow container; built-image ownership; fixable vs unfixable Critical)');
      return 0;
    }
    const refs = enumerateImages(collectTreeFiles(root, { spawn }));
    if (flags.has('--list')) {
      for (const r of refs) log(`${r.ref} · ${r.form} · ${r.owner} · ${r.status} · ${r.locations.join(', ')}`);
      const count = (pred) => refs.filter(pred).length;
      log(`[image-scan] ${refs.length} reference(s): ${count((r) => r.owner === 'sweep')} sweep, ${count((r) => r.owner !== 'sweep')} built, ${count((r) => r.status === 'not-scannable')} not-scannable`);
      return 0;
    }
    // The sweep. The old report goes first: if any scan fails, the gate must find NO report and
    // fail closed, never judge the previous run's numbers.
    rmSync(resolve(root, REPORT_DIR, 'findings.json'), { force: true });
    const map = loadSeverityMap(resolve(root, SEVERITY_MAP_PATH));
    const targets = refs.filter((r) => r.owner === 'sweep' && r.status === 'scannable');
    const findings = [];
    const natives = [];
    for (const r of targets) {
      const json = scanImage(r.ref, { imageSrc: 'remote', spawn, ...retry });
      natives.push(json);
      const found = normalizeTrivy(json, { image: r.ref, locations: r.locations, map });
      findings.push(...found);
      log(`[image-scan] scanned ${r.ref}: ${found.length} finding(s), ${found.filter((f) => f.blocking).length} fixable Critical`);
    }
    const report = {
      schemaVersion: 1, mode: 'sweep', scannedImages: targets.map((r) => r.ref), platform: SWEEP_PLATFORM,
      notScannable: refs.filter((r) => r.status === 'not-scannable').map((r) => ({ ref: r.ref, locations: r.locations })),
      findings,
    };
    writeReport(root, report, natives);
    log(`[image-scan] report written: ${REPORT_DIR}/findings.json (${targets.length} image(s) scanned)`);
    return 0;
  } catch (e) {
    if (e instanceof ImageScanError) { error(`[image-scan] ✗ ${e.message}`); return e.exitCode; }
    throw e;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
