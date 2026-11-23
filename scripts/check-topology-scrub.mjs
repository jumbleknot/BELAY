#!/usr/bin/env node
// Topology-scrub gate — keeps a real tailnet host out of the tracked tree. The secrets posture says
// docs and wiki pages never name the forge host or a tailnet address; without a gate such a host
// re-enters silently (docs, handoff notes, test fixtures), one session at a time.
//
// Pattern-based, NOT literal: the gate CANNOT hard-code the real tailnet id (that would itself leak
// it). Instead it flags any `<labels>.ts.net` FQDN that is not a sanitized placeholder. Placeholders
// carry the literal word `tailnet` (e.g. `server.tailnet.ts.net`, `beelink.<tailnet>.ts.net`) or
// `example` (`example-host.ts.net`); a real Tailscale host (random tailnet id like `tailXXXXXX`)
// carries neither, so it is flagged.
//
// Scope note: this gates the TAILNET HOST only. A public domain cannot be pattern-gated without
// embedding the literal (defeating the scrub); it relies on review. The git remote URL lives in
// `.git/config`, which is never tracked, so it is outside the scan by construction.
//
// Usage:
//   node scripts/check-topology-scrub.mjs              # scan tracked files; exit 1 on a real tailnet host
//   node scripts/check-topology-scrub.mjs --selftest   # prove detection; exit 0/1
//   node scripts/check-topology-scrub.mjs --dir <root> # scan another git work tree (tests use this)
//   node scripts/check-topology-scrub.mjs --help
//
// Exit codes: 0 clean / selftest passed · 1 tailnet host found / selftest broken · 2 bad args.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, posix } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-topology-scrub.mjs';
const RULE = 'tailnet-host';
const USAGE = 'Usage: check-topology-scrub.mjs [--selftest | --dir <root> | --help]';

// A tailnet FQDN: one or more dot-separated labels ending in `.ts.net`.
const TS_NET = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.ts\.net\b/g;
// Sanitized-placeholder tokens. A matched host containing one of these (case-insensitive) is allowed;
// a real host (random tailnet id) contains neither and is flagged. These are generic English words,
// not the secret — the gate never stores the real id.
const PLACEHOLDER_TOKENS = ['tailnet', 'example'];

function isPlaceholder(host) {
  const h = host.toLowerCase();
  return PLACEHOLDER_TOKENS.some((t) => h.includes(t));
}

/** Return the flagged tailnet hosts (non-placeholder) in a text blob, with line numbers. */
function scanText(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    TS_NET.lastIndex = 0;
    let m;
    while ((m = TS_NET.exec(lines[i]))) {
      if (!isPlaceholder(m[0])) hits.push({ host: m[0], line: i + 1 });
    }
  }
  return hits;
}

function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).map((p) => posix.normalize(p));
}

function isProbablyText(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

function runScan(root) {
  let files;
  try {
    files = trackedFiles(root);
  } catch (e) {
    console.error(`[topology-scrub] cannot list tracked files in ${root}: ${e.message}`);
    process.exit(2);
  }
  const findings = [];
  for (const rel of files) {
    if (rel === SELF) continue; // the gate holds the pattern
    let buf;
    try {
      buf = readFileSync(resolve(root, rel));
    } catch {
      continue; // tracked but deleted in the work tree
    }
    if (!isProbablyText(buf)) continue;
    for (const h of scanText(buf.toString('utf8'))) findings.push({ file: rel, ...h });
  }
  if (findings.length) {
    for (const f of findings) {
      console.error(`${f.file}:${f.line}: ${RULE}: ${f.host} — use a placeholder (\`<tailnet-host>\` / \`*.tailnet.ts.net\`)`);
    }
    console.error(`[topology-scrub] ❌ ${findings.length} real tailnet host(s) in tracked files — never commit one.`);
    process.exit(1);
  }
  console.log('[topology-scrub] ✅ no real tailnet host in tracked files.');
}

function selftest() {
  const fails = [];
  // Planted REAL-looking tailnet hosts (invented ids), assembled from fragments so this file holds
  // no contiguous real-shaped host — must be detected.
  const tsNet = '.ts' + '.net';
  const planted = [
    'REGISTRY_HOST=beelink.tailz9x8w7' + tsNet + ':3000',
    'ssh ci@myhost.tail0a1b2c' + tsNet,
  ];
  for (const line of planted) {
    if (scanText(line).length === 0) fails.push(`planted real tailnet host NOT detected: ${line}`);
  }
  // Sanitized placeholders — must NOT false-positive.
  const clean = [
    'server.tailnet.ts.net:3000',
    'prod-host.tailnet.ts.net:8099',
    'example-host.ts.net',
    'beelink.<tailnet>.ts.net',
    'h.tailnet.ts.net',
    '<tailnet-host>:3000',
  ].join('\n');
  if (scanText(clean).length !== 0) {
    fails.push('placeholder(s) false-positived: ' + JSON.stringify(scanText(clean)));
  }
  if (fails.length) {
    console.error('[topology-scrub --selftest] ❌ ' + fails.join('; '));
    process.exit(1);
  }
  console.log('[topology-scrub --selftest] ✅ detects real tailnet hosts; sanitized placeholders pass.');
}

function parseArgs(argv) {
  const opts = { selftest: false, help: false, dir: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') opts.selftest = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--dir') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: '--dir needs a directory' };
      opts.dir = resolve(v);
    } else return { error: `Unknown argument: ${a}` };
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.error) {
  console.error(`${opts.error}. ${USAGE}`);
  process.exit(2);
}
if (opts.help) console.log(USAGE);
else if (opts.selftest) selftest();
else runScan(opts.dir);
