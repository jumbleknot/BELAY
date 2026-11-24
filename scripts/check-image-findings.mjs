#!/usr/bin/env node
// check-image-findings.mjs: the image-scan gate (feature 010). Ported from MovieCollectionManager's
// check-infra-image-findings.mjs (feature 035), with BELAY's stricter allowlist (research R7).
//
// BLOCKING = a fixable Critical (decided by image-scan.mjs) that no live allowlist entry covers.
// Everything else is a warning, reported as counts. The verdict line is LAST and always starts with
// how many images were scanned: a scan that scanned nothing must never read as clean (spec FR-005,
// MCM's measured "a green tick that meant nothing ran").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { isMain } from './lib/is-main.mjs';
import { classifyExpiry, daysUntil, selectUnmatched } from './allowlist-expiry.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPORT_PATH = 'security/images/reports/findings.json';
export const ALLOWLIST_PATH = 'security/images/allowlist.yaml';
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];

export class ImageFindingsError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A key must pin a VERSION (":" then a digit) or a DIGEST ("@sha256:"). A bare repository name, or a
// floating tag, matches every future version of the image, so the entry could never end: it would
// silently suppress every later advisory too (MCM's measured permanent hole). Refused, where MCM accepted it.
const VERSIONED_KEY = /:\d|@sha256:/;

/** The literal repository an entry keys to (`node`, `docker.io/library/node`), for scoping. */
const entryRepo = (image) => image.split(/[:@]/)[0].replace(/\\(.)/g, '$1');
/** The repository of a scanned reference: drop the digest, then a tag after the last path segment. */
export function refRepo(ref) {
  const name = String(ref).split('@')[0];
  const slash = name.lastIndexOf('/');
  const colon = name.lastIndexOf(':');
  return colon > slash ? name.slice(0, colon) : name;
}

/** Parse, validate and compile the allowlist (data-model.md, Allowlist entry). Invalid → exit 2, naming the entry. */
export function loadAllowlist(text) {
  const parsed = parseYaml(String(text)) ?? [];
  if (!Array.isArray(parsed)) throw new ImageFindingsError('the allowlist must be a YAML list', 2);
  return parsed.map((e, i) => {
    const index = i + 1;
    const bad = (msg) => { throw new ImageFindingsError(`allowlist entry ${index}: ${msg}`, 2); };
    if (!e || typeof e !== 'object') bad('must be a mapping');
    for (const f of ['image', 'id', 'justification', 'addedBy', 'expiry']) {
      if (typeof e[f] !== 'string' || e[f].trim() === '') bad(`"${f}" is required and must not be blank`);
    }
    if (!ISO_DATE.test(e.expiry)) bad(`expiry must be a YYYY-MM-DD date (got "${e.expiry}")`);
    if (!VERSIONED_KEY.test(e.image)) bad(`image "${e.image}" must carry a version or a digest (":<digit>…" or "@sha256:"); a bare name matches every future version and could never end`);
    let imageRe;
    let idRe;
    try { imageRe = new RegExp(e.image); } catch (err) { bad(`image is not a valid regex: ${err.message}`); }
    try { idRe = new RegExp(e.id); } catch (err) { bad(`id is not a valid regex: ${err.message}`); }
    const entry = {
      index, key: `${index}`, scanner: 'trivy', image: e.image, id: e.id, justification: e.justification, addedBy: e.addedBy, expiry: e.expiry,
      imageRe, idRe, repo: entryRepo(e.image),
      describes: (f) => imageRe.test(f.image) && idRe.test(f.id),
      suppresses: (f, today) => entry.describes(f) && classifyExpiry(e.expiry, today) !== 'expired',
    };
    return entry;
  });
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
  const expiring = allowlist.filter((e) => classifyExpiry(e.expiry, today) === 'expiring').map((e) => ({ ...e, days: daysUntil(e.expiry, today) }));
  const expired = allowlist.filter((e) => classifyExpiry(e.expiry, today) === 'expired');
  // Scope by REPOSITORY, not by the entry's own regex. After a re-pin the entry's regex matches no
  // scanned image at all, and scoping by it would call the stale entry "out of scope" and stay silent,
  // which is the exact case spec US3-AC2 requires to be reported. A scanned image of the same
  // repository puts the entry in scope.
  const scannedRepos = new Set(report.scannedImages.map(refRepo));
  const matchedKeys = new Set(allowlist.filter((e) => (report.findings ?? []).some((f) => e.describes(f))).map((e) => e.key));
  const unmatched = selectUnmatched(
    allowlist.filter((e) => classifyExpiry(e.expiry, today) !== 'expired').map((e) => ({ ...e, inScope: scannedRepos.has(e.repo) })),
    matchedKeys,
    scanned > 0 ? new Set(['trivy']) : new Set(),
  );
  return {
    scanned, blocking, suppressed, warnings, notScannable,
    unmatched, expiring, expired,
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

/**
 * Post the `sweep/verdict` commit status from a verdict file (contracts/workflows.md, step 8).
 *
 * NAMED `<job>/<label>` WITH NO SPACES, deliberately (ci-status.mjs bundleJobName): a context with
 * ` / ` is read as `<workflow> / <job>`, so `image-scan / verdict` sent ci-status looking for a job called
 * `verdict` and reporting its bundle absent (measured on run 8286). `sweep/verdict` resolves to the
 * `sweep` job that owns the bundle, and cannot match a branch-protection `workflow / job` glob.
 *
 * The ONLY readable record of a green run's counts: the forge has no log or artifact endpoint, and
 * the failure digest publishes only on failure. `success` needs BOTH a successful job and a ✅ line;
 * a missing file means the sweep died before the gate, which is a failure, never a pass. The run's
 * own token can write statuses (measured by ci-failure-digest.mjs, research R6): no new secret.
 */
export async function publishVerdict(verdictPath, { env = process.env, fetch: doFetch = fetch, log = console.log, error = console.error } = {}) {
  for (const k of ['GITHUB_TOKEN', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'GITHUB_SHA']) {
    if (!env[k]) { error(`[image-scan] ✗ cannot publish the verdict status: ${k} is not set`); return 1; }
  }
  const line = existsSync(verdictPath)
    ? readFileSync(verdictPath, 'utf8').trim()
    : '[image-scan] ❌ the sweep failed before a verdict: see the failure digest';
  const state = env.JOB_STATUS === 'success' && line.includes('✅') ? 'success' : 'failure';
  const url = `${env.GITHUB_SERVER_URL}/api/v1/repos/${env.GITHUB_REPOSITORY}/statuses/${env.GITHUB_SHA}`;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { Authorization: `token ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state,
      context: 'sweep/verdict',
      description: line.replace(/^\[image-scan\] /, '').slice(0, 250),
      target_url: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_NUMBER ?? ''}`,
    }),
  });
  if (!res.ok) { error(`[image-scan] ✗ the status POST was refused: HTTP ${res.status}`); return 1; }
  log(`[image-scan] sweep/verdict → ${state}: ${line}`);
  return 0;
}

// ── --selftest ──────────────────────────────────────────────────────────────────────────────────
// The contract's gate scenarios, judged with no scan, before CI trusts a real verdict. `deps` lets the
// tests break one stage and watch the selftest name it.
const ST_TODAY = '2026-11-24';
const ST_IMG = `node:26-bookworm@sha256:${'b'.repeat(64)}`;
const ST_NEW = `node:26-bookworm@sha256:${'d'.repeat(64)}`;
const stFinding = (over = {}) => ({ image: ST_IMG, locations: [], id: 'CVE-ST-1', pkg: 'p', installed: '1', fixedVersion: '2',
  layer: '', severity: 'Critical', fixAvailable: true, blocking: true, ...over });
const stReport = (findings, scannedImages = [ST_IMG]) => ({ schemaVersion: 1, mode: 'sweep', scannedImages, notScannable: [], findings });
const stEntry = (over = {}) => `- image: '${over.image ?? 'node:26-bookworm@sha256:b{64}'}'\n  id: 'CVE-ST-1'\n  justification: '${over.justification ?? 'selftest'}'\n  addedBy: 'selftest'\n${over.expiry === null ? '' : `  expiry: '${over.expiry ?? '2027-06-30'}'\n`}`;

export function imageFindingsSelftest(deps = {}) {
  const d = { loadAllowlist, evaluate, ...deps };
  const failures = [];
  const judge = (name, report, allowYaml, check) => {
    try {
      const problem = check(d.evaluate(report, d.loadAllowlist(allowYaml), ST_TODAY));
      if (problem) failures.push(`${name}: ${problem}`);
    } catch (e) { failures.push(`${name}: threw ${e.message}`); }
  };
  const refused = (name, allowYaml) => {
    try { d.loadAllowlist(allowYaml); failures.push(`${name}: accepted, expected a refusal (exit 2)`); } catch (e) {
      if (e.exitCode !== 2) failures.push(`${name}: refused with exit ${e.exitCode}, expected 2`);
    }
  };
  judge('a clean report', stReport([]), '[]', (v) => (v.ok ? null : 'failed'));
  judge('a fixable Critical', stReport([stFinding()]), '[]', (v) => (!v.ok && v.blocking.length === 1 ? null : 'passed'));
  judge('an unfixable Critical', stReport([stFinding({ fixedVersion: '', fixAvailable: false, blocking: false })]), '[]', (v) => (v.ok ? null : 'blocked (it must warn)'));
  judge('a version-keyed entry', stReport([stFinding()]), stEntry(), (v) => (v.ok && v.suppressed.length === 1 ? null : 'did not suppress'));
  judge('a re-pinned image', stReport([stFinding({ image: ST_NEW })], [ST_NEW]), stEntry(),
    (v) => (!v.ok && v.unmatched.length === 1 ? null : 'the stale entry still suppressed, or was not reported UNMATCHED'));
  judge('an expired entry', stReport([stFinding()]), stEntry({ expiry: '2026-11-01' }), (v) => (!v.ok ? null : 'an expired entry still suppressed'));
  judge('zero images scanned', stReport([], []), '[]', (v) => (!v.ok ? null : 'a scan of nothing passed'));
  refused('a bare-name key', stEntry({ image: 'node' }));
  refused('a missing expiry', stEntry({ expiry: null }));
  refused('a blank justification', stEntry({ justification: ' ' }));
  try { d.evaluate({ schemaVersion: 1, findings: [] }, [], ST_TODAY); failures.push('a report without scannedImages: accepted'); } catch { /* refused, as it must be */ }
  return { failures };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const USAGE = 'Usage: check-image-findings.mjs [--report <path>] [--allowlist <path>] [--verdict-out <path>] | --publish-verdict <path> | --selftest';

export async function main(argv, { root = REPO_ROOT, today = new Date().toISOString().slice(0, 10), log = console.log, error = console.error } = {}) {
  let reportPath = REPORT_PATH;
  let allowlistPath = ALLOWLIST_PATH;
  let verdictOut = null;
  // The verdict line, written on EVERY outcome when asked: the workflow's status step posts it, and a
  // green run's counts are readable nowhere else (the forge has no log or artifact endpoint).
  const record = (line) => {
    if (!verdictOut) return;
    mkdirSync(dirname(resolve(root, verdictOut)), { recursive: true });
    writeFileSync(resolve(root, verdictOut), `${line}\n`);
  };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--report' || a === '--allowlist' || a === '--verdict-out') {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw new ImageFindingsError(`${a} needs a path\n${USAGE}`, 2);
        if (a === '--report') reportPath = v; else if (a === '--allowlist') allowlistPath = v; else verdictOut = v;
      } else if (a === '--publish-verdict') {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw new ImageFindingsError(`--publish-verdict needs a path\n${USAGE}`, 2);
        return await publishVerdict(resolve(root, v), { log, error });
      } else if (a === '--selftest') {
        const { failures } = imageFindingsSelftest();
        for (const f of failures) error(`✗ check-image-findings --selftest: ${f}`);
        if (failures.length) return 1;
        log('✓ check-image-findings --selftest passed (clean, fixable and unfixable Critical, version-keyed suppression, re-pin discharge reported UNMATCHED, expired entry, zero images, bare-name / missing-expiry / blank-justification refused, report without scannedImages refused)');
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
    const lines = formatVerdict(v);
    for (const line of lines) log(line);
    record(lines.at(-1));
    return v.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof ImageFindingsError) {
      error(`[image-scan] ✗ ${e.message}`);
      record(`[image-scan] ❌ ${e.message}`);
      return e.exitCode;
    }
    throw e;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
