#!/usr/bin/env node
/**
 * secret-scan.mjs — credential-shape detection rules.
 *
 * Fails if a credential-shaped string is committed anywhere in the tree, or if a recorded golden
 * cassette carries an auth header / api-key field. Provider keys are per-user secrets injected at
 * run time; none should EVER land in a committed file, log, span, trace, or cassette.
 *
 * In BELAY these rules are consumed by scripts/ci-digest-redact.mjs (the fail-closed check on
 * published CI digests). Running this file as its own CI scan is tracked separately (issue #1).
 *
 * Patterns (deliberately narrow to avoid false positives on commit hashes / placeholders):
 *   - Anthropic API key:  sk-ant-<40+ key chars>  (real keys are ~100 chars; the test markers like
 *     `sk-ant-definitely-not-a-real-key` and the `sk-ant-…` doc placeholder are far shorter → ignored).
 *   - TMDB v3 key:        an `api_key` / `tmdb_key` assignment to a 32-hex value (a bare 32-hex would
 *     false-positive on git SHAs, so we only flag it when bound to a key-named field).
 *   - TMDB v4 token:      a `Bearer eyJ…` JWT bound to TMDB context (read-access-token style).
 *   - Cassettes:          must contain no `authorization` / `x-api-key` / `api_key` field.
 *
 * Usage:
 *   node scripts/secret-scan.mjs            # scan all git-tracked files; exit 1 on any hit
 *   node scripts/secret-scan.mjs --selftest # validate detection (planted key → hit; clean → none)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, posix } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/secret-scan.mjs';

// --- Detection rules ---------------------------------------------------------
const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]{40,}/;
const TMDB_V3 = /\b(?:tmdb[_-]?key|tmdb_api_key|api_key)["'\s]*[:=>][\s"']*[0-9a-f]{32}\b/i;
const TMDB_V4 = /\b(?:tmdb|themoviedb)[\s\S]{0,40}?eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i;
export const RULES = [
  { name: 'anthropic-api-key', re: ANTHROPIC_KEY },
  { name: 'tmdb-v3-api-key', re: TMDB_V3 },
  { name: 'tmdb-v4-token', re: TMDB_V4 },
];
const CASSETTE_FIELD = /"(authorization|x-api-key|api_key|apikey)"\s*:/i;

// No consumer may hardcode a live credential as a fallback default. Two idioms:
//   • JS `??` / `||`:  `process.env.NAME ?? 'x'`  /  `process.env['NAME'] || 'x'`
//   • getter-default:  `get/getenv/cfg/_cfg("NAME", "x")`  (READ-with-default form)
// Keyed on a CURATED NAME SET, not a generic PASSWORD|SECRET|TOKEN substring: a generic rule
// false-positives on public values such as `*_CLIENT_ID` / `*_TTL_SECONDS`. `setenv("NAME", "x")`
// SETS env rather than defaulting it, and is not matched. An empty `?? ''` is allowed.
const CRED_NAMES = 'E2E_TEST_PASSWORD|ANTHROPIC_API_KEY|TMDB_API_KEY';
const CRED_FALLBACK_JS = new RegExp(`(?:${CRED_NAMES})["'\\]]*\\s*(?:\\?\\?|\\|\\|)\\s*["'][^"']+["']`);
const CRED_FALLBACK_GET = new RegExp(`(?:get|getenv|cfg|_cfg)\\(\\s*["'](?:${CRED_NAMES})["']\\s*,\\s*["'][^"']+["']`);

// Intentional NON-key markers used by tests/docs (e.g. the revoked-credential leak-marker, the
// bad-key E2E value, doc placeholders). A real provider key never contains these English tokens,
// so a match carrying one is a deliberate placeholder, not a leaked secret.
const PLACEHOLDER = /MARKER|do-not-surface|definitely-not-a-real|not-a-real-key|EXAMPLE|PLACEHOLDER|FAKE|REVOKED|spoiled|bad-key/i;

/** Scan a single file's text for any rule hit; cassette files additionally check auth fields. */
export function scanText(relPath, text) {
  const hits = [];
  for (const { name, re } of RULES) {
    const m = re.exec(text);
    if (m && !PLACEHOLDER.test(m[0])) hits.push({ rule: name, sample: m[0].slice(0, 16) + '…' });
  }
  if (relPath.includes('tests/golden/cassettes/')) {
    const m = CASSETTE_FIELD.exec(text);
    if (m) hits.push({ rule: 'cassette-auth-field', sample: m[1] });
  }
  const mFallback = CRED_FALLBACK_JS.exec(text) || CRED_FALLBACK_GET.exec(text);
  if (mFallback) hits.push({ rule: 'e2e-credential-fallback-literal', sample: mFallback[0].slice(0, 40) });
  return hits;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).map((p) => posix.normalize(p));
}

function isProbablyText(buf) {
  // Skip binaries: a NUL byte in the first 8 KB is a reliable binary signal.
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

function runScan() {
  const findings = [];
  for (const rel of trackedFiles()) {
    if (rel === SELF) continue; // the scanner holds the patterns as regex source
    let buf;
    try {
      buf = readFileSync(resolve(REPO_ROOT, rel));
    } catch {
      continue; // deleted/unreadable
    }
    if (!isProbablyText(buf)) continue;
    const hits = scanText(rel, buf.toString('utf8'));
    for (const h of hits) findings.push({ file: rel, ...h });
  }
  if (findings.length) {
    console.error('[secret-scan] ❌ credential-shaped strings found in committed files:');
    for (const f of findings) console.error(`  ${f.file}: ${f.rule} (${f.sample})`);
    console.error('[secret-scan] Secrets are per-user and injected at run time — never commit one.');
    process.exit(1);
  }
  console.log('[secret-scan] ✅ no credential-shaped strings in committed files.');
}

function selftest() {
  // Build a realistic planted Anthropic key at runtime (no long key-shaped literal in this file).
  const planted = 'sk-ant-api03-' + 'A'.repeat(95);
  const plantedTmdb = 'TMDB_API_KEY=' + 'a'.repeat(32);
  // Clean tree: a sha-like hash and a doc placeholder must NOT false-positive.
  const clean =
    'const x = "sk-ant-…"; // placeholder\nconst h = "0123456789abcdef0123456789abcdef"; // a sha-like hash\n';
  const plantedFallbackJs = "const P = process.env.E2E_TEST_PASSWORD ?? 'someLiteral';";
  const plantedFallbackPy = 'TEST_PASSWORD = _cfg("E2E_TEST_PASSWORD", "someLiteral")';
  const plantedAnthropicJs = "const K = process.env.ANTHROPIC_API_KEY || 'sk-ant-fallback';";
  const plantedTmdbGet = 'key = os.environ.get("TMDB_API_KEY", "abcdef")';
  // Clean negatives for the new rules: fail-clean forms and non-secret look-alikes that MUST NOT flag.
  const cleanE2e =
    "const a = process.env.E2E_TEST_PASSWORD ?? '';\n" + // empty sentinel — allowed
    "const b = requireEnv('E2E_TEST_PASSWORD');\n" + // no literal default
    'TEST_PASSWORD = _cfg("E2E_TEST_PASSWORD")\n' + // no default
    'monkeypatch.setenv("TMDB_API_KEY", "stray-env-key")\n' + // SETS env (test injection) — not a default
    "const s = process.env.CI_CLIENT_SECRET ?? 'ci-throwaway-x';\n" + // outside the curated name set
    "const id = process.env.AGENT_SUBJECT_TOKEN_CLIENT_ID ?? 'agent-subject-token';\n" + // *_CLIENT_ID public
    "const ttl = Number(process.env.EXCHANGED_TOKEN_TTL_SECONDS ?? '60');"; // *_TTL_SECONDS number
  const fails = [];
  if (scanText('x.ts', planted).length === 0) fails.push('planted anthropic key NOT detected');
  if (scanText('config.env', plantedTmdb).length === 0) fails.push('planted TMDB v3 key NOT detected');
  if (scanText('setup.ts', plantedFallbackJs).length === 0) fails.push('planted E2E JS fallback NOT detected');
  if (scanText('conftest.py', plantedFallbackPy).length === 0) fails.push('planted E2E py fallback NOT detected');
  if (scanText('client.ts', plantedAnthropicJs).length === 0) fails.push('planted ANTHROPIC_API_KEY fallback NOT detected');
  if (scanText('conftest.py', plantedTmdbGet).length === 0) fails.push('planted TMDB_API_KEY getter-default NOT detected');
  if (scanText('setup.ts', cleanE2e).length !== 0) fails.push('E2E clean forms false-positived (empty/no-default/setenv/CI-throwaway/CLIENT_ID/TTL)');
  if (scanText('x.ts', clean).length !== 0) fails.push('clean tree false-positived');
  if (scanText('tests/golden/cassettes/x.json', '{"authorization":"Bearer y"}').length === 0) {
    fails.push('cassette auth field NOT detected');
  }
  if (fails.length) {
    console.error('[secret-scan --selftest] ❌ ' + fails.join('; '));
    process.exit(1);
  }
  console.log('[secret-scan --selftest] ✅ detects planted keys + cassette auth fields; clean tree passes.');
}

// Importable as a module (the CI digest reuses these detection rules to VERIFY its redaction
// output) without running a tree scan as a side effect.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) selftest();
  else runScan();
}
