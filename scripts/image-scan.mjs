#!/usr/bin/env node
// image-scan.mjs: container-image CVE scanning (feature 010, backlog item 49). Ported from
// MovieCollectionManager's infra-image-scan.mjs (feature 035), with BELAY's changes
// (specs/010-image-cve-scan/research.md, R7).
//
// Trivy runs, this script normalizes what it reports, and scripts/check-image-findings.mjs judges.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
export const DB_REPOSITORY = 'ghcr.io/aquasecurity/trivy-db:2';
export const JAVA_DB_REPOSITORY = 'ghcr.io/aquasecurity/trivy-java-db:1';
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
export function scanImage(ref, { imageSrc, spawn = spawnSync, ...retryOpts } = {}) {
  if (imageSrc !== 'remote' && imageSrc !== 'docker') throw new ImageScanError(`--image-src must be remote or docker (got ${imageSrc})`, 2);
  const args = [
    'image', '--format', 'json', '--no-progress', '--scanners', 'vuln',
    '--db-repository', DB_REPOSITORY, '--java-db-repository', JAVA_DB_REPOSITORY,
    '--image-src', imageSrc,
    ...(imageSrc === 'remote' ? ['--platform', SWEEP_PLATFORM] : []),
    ref,
  ];
  return retryTransient(`trivy ${ref}`, () => {
    const res = spawn('trivy', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
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

// ── not yet implemented (their tests come first: T011, T015, T019) ─────────────────────────────

const notImplemented = () => { throw new Error('not implemented'); };
export const enumerateImages = notImplemented;
export const imageScanSelftest = notImplemented;
export const main = notImplemented;

if (isMain(import.meta.url)) {
  console.error('not implemented');
  process.exitCode = 1;
}
