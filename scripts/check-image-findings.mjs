#!/usr/bin/env node
// check-image-findings.mjs: the image-scan gate (feature 010). Ported from MovieCollectionManager's
// check-infra-image-findings.mjs (feature 035), with BELAY's stricter allowlist (research R7).
//
// BLOCKING = a fixable Critical (decided by image-scan.mjs) that no live allowlist entry covers.
// Everything else is a warning, reported as counts. The verdict line is LAST and always starts with
// how many images were scanned: a scan that scanned nothing must never read as clean (spec FR-005,
// MCM's measured "a green tick that meant nothing ran").
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { isMain } from './lib/is-main.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPORT_PATH = 'security/images/reports/findings.json';
export const ALLOWLIST_PATH = 'security/images/allowlist.yaml';
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];

export class ImageFindingsError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

/** Parse the allowlist. Entries are validated and compiled (data-model.md, Allowlist entry). */
export function loadAllowlist(text) {
  const parsed = parseYaml(String(text)) ?? [];
  if (!Array.isArray(parsed)) throw new ImageFindingsError('the allowlist must be a YAML list', 2);
  if (parsed.length > 0) throw new Error('not implemented');   // entries arrive with T027
  return [];
}

const short = (layer) => (layer ? `${layer.slice(0, 'sha256:'.length + 12)}…` : 'unknown');

/** Partition a report's findings into the verdict (data-model.md, Verdict). */
export function evaluate(report, allowlist, today) {
  if (!report || !Array.isArray(report.scannedImages)) {
    throw new ImageFindingsError('the report has no scannedImages array: regenerate it with scripts/image-scan.mjs. Without the scanned set nothing can be judged');
  }
  const blocking = [];
  const suppressed = [];
  const warnings = [];
  for (const f of report.findings ?? []) {
    if (!f.blocking) { warnings.push(f); continue; }
    const entry = allowlist.find((e) => e.suppresses?.(f, today));
    if (entry) suppressed.push({ ...f, entry });
    else blocking.push(f);
  }
  const notScannable = report.notScannable ?? [];
  const scanned = report.scannedImages.length;
  return {
    scanned, blocking, suppressed, warnings, notScannable,
    unmatched: [], expiring: [], expired: [],
    ok: blocking.length === 0 && notScannable.length === 0 && scanned > 0,
  };
}

function warningCounts(warnings) {
  const parts = [];
  for (const sev of SEVERITIES) {
    const n = warnings.filter((f) => f.severity === sev).length;
    if (n) parts.push(sev === 'Critical' ? `${n} Critical (no fix)` : `${n} ${sev}`);
  }
  return parts.length ? `${parts.join(' · ')} (warnings)` : '0 warnings';
}

/** The verdict as output lines; the summary is last, so the CI digest's tail is the verdict. */
export function formatVerdict(v) {
  const lines = [];
  for (const f of v.blocking) {
    lines.push(`[image-scan] ✗ BLOCKING ${f.id} ${f.pkg} ${f.installed} → ${f.fixedVersion} (${f.severity}) in ${f.image} (layer ${short(f.layer)})`);
  }
  for (const n of v.notScannable) {
    lines.push(`[image-scan] ✗ NOT SCANNABLE ${n.ref} (${n.locations.join(', ')}): make the reference resolvable, or name its builder`);
  }
  for (const e of v.expiring) lines.push(`[image-scan] ⚠ allowlist entry ${e.index} expires ${e.expiry} (${e.days} days)`);
  for (const e of v.expired) lines.push(`[image-scan] ⚠ allowlist entry ${e.index} expired ${e.expiry}: it no longer suppresses`);
  for (const e of v.unmatched) {
    lines.push(`[image-scan] UNMATCHED allowlist entry ${e.index} (${e.image}, ${e.id}): matched nothing in a scanned image; re-key or delete it`);
  }
  const images = `${v.scanned} image${v.scanned === 1 ? '' : 's'} scanned`;
  lines.push(`[image-scan] ${v.ok ? '✅' : '❌'} ${images}: ${v.blocking.length} blocking · ${v.suppressed.length} allowlisted · ${warningCounts(v.warnings)}`);
  return lines;
}

// ── not yet implemented (its tests come first: T028) ────────────────────────────────────────────
export function imageFindingsSelftest() {
  throw new Error('not implemented');
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const USAGE = 'Usage: check-image-findings.mjs [--report <path>] [--allowlist <path>] | --selftest';

export function main(argv, { root = REPO_ROOT, today = new Date().toISOString().slice(0, 10), log = console.log, error = console.error } = {}) {
  let reportPath = REPORT_PATH;
  let allowlistPath = ALLOWLIST_PATH;
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--report' || a === '--allowlist') {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw new ImageFindingsError(`${a} needs a path\n${USAGE}`, 2);
        if (a === '--report') reportPath = v; else allowlistPath = v;
      } else if (a === '--selftest') {
        imageFindingsSelftest();
        return 0;
      } else throw new ImageFindingsError(`unknown argument ${a}\n${USAGE}`, 2);
    }
    const reportFull = resolve(root, reportPath);
    if (!existsSync(reportFull)) throw new ImageFindingsError(`report missing: nothing was scanned (${reportPath})`);
    let report;
    try { report = JSON.parse(readFileSync(reportFull, 'utf8')); } catch (e) { throw new ImageFindingsError(`report ${reportPath} is not JSON: ${e.message}`); }
    const allowFull = resolve(root, allowlistPath);
    const allowlist = existsSync(allowFull) ? loadAllowlist(readFileSync(allowFull, 'utf8')) : [];
    const v = evaluate(report, allowlist, today);
    for (const line of formatVerdict(v)) log(line);
    return v.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof ImageFindingsError) { error(`[image-scan] ✗ ${e.message}`); return e.exitCode; }
    throw e;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
