#!/usr/bin/env node
// Inline-secret gate — no tracked Docker Compose file may hold a literal credential.
//
// WHY THIS EXISTS. BELAY's constitution requires a root `compose.yaml` whose secrets are read from
// files, plus per-project compose files. None exists yet; this gate is in place before the first one
// lands, so that first one is gated rather than whatever comes after it. Ported from
// MovieCollectionManager (MCM), where moving every compose credential out to env/secret files was a
// feature of its own; this is the guard that keeps them out.
//
// THE RULE. Every secret-shaped environment key, every password-bearing connection URL, and every
// command / healthcheck / entrypoint auth argument (`--requirepass`, `redis-cli -a`, `curl -u`) MUST
// be a pure `${VAR}` or `${VAR:?message}` interpolation reference. An inline `${VAR:-default}`
// re-introduces the plaintext as its default and FAILS.
//
// Complementary to scripts/secret-scan.mjs, which hunts real-key SHAPES tree-wide; this asserts a
// STRUCTURAL property of compose files, so it also catches a weak or placeholder password that no
// shape rule would recognise.
//
// SCOPE: every tracked compose file anywhere in the tree (`git ls-files`), by file name:
// `compose*.y(a)ml`, `docker-compose*.y(a)ml` and stack-style `<name>.compose.y(a)ml`. An untracked
// file is outside the scan (it cannot be committed by accident without becoming tracked). The run
// prints how many files it scanned, so a scan of nothing — today's state — is visible as nothing.
//
// A finding names the file, line, service and key — NEVER the value. A gate that echoes the
// credential into a CI log has leaked it a second time.
//
// Usage:
//   node scripts/check-no-inline-secrets.mjs              # scan tracked compose files; exit 0 clean / 1 dirty
//   node scripts/check-no-inline-secrets.mjs --selftest   # prove detection on planted input; exit 0/1
//   node scripts/check-no-inline-secrets.mjs --dir <root> # scan another git work tree (tests use this)
//   node scripts/check-no-inline-secrets.mjs --help
//
// Exit codes: 0 clean / selftest passed · 1 inline credential found / selftest broken ·
// 2 bad args, no git work tree, or an unparseable compose file.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, posix } from 'node:path';
import { parseAllDocuments, LineCounter, isMap, isSeq, isScalar } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: check-no-inline-secrets.mjs [--selftest | --dir <root> | --help]';

// --- Detection rules ---------------------------------------------------------

/** A compose file, by base name: compose*.y(a)ml, docker-compose*.y(a)ml, <stack>.compose.y(a)ml. */
const COMPOSE_NAME = /^(?:(?:docker-)?compose(?:[.-][^/]*)?|[^/]+\.compose)\.ya?ml$/i;

// A secret-shaped env-var name. Case-insensitive substring match.
const SECRET_KEY = /PASSWORD|SECRET|TOKEN|SALT|ENCRYPTION_KEY|_AUTH|REQUIREPASS/i;

// Non-secret keys that match SECRET_KEY but are not credentials. Suffix rules only — a NAMED
// exception for one deployment's key belongs to that deployment, not to shared tooling.
//   *_FILE          → a path to a Docker secret file, not the secret itself (POSTGRES_PASSWORD_FILE).
//   *_USER          → an account name, not a credential.
//   *ACCESS_KEY_ID  → the public half of an S3-style key pair, a non-secret identifier.
//   *_CLIENT_ID     → an OAuth client identifier (public by definition), e.g. OIDC_TOKEN_CLIENT_ID.
//   *_AUDIENCE      → an OAuth token audience name (public), e.g. OIDC_TOKEN_AUDIENCE.
export function isAllowlistedKey(key) {
  const k = String(key).toUpperCase();
  return (
    k.endsWith('_FILE') ||
    k.endsWith('_USER') ||
    k.endsWith('ACCESS_KEY_ID') ||
    k.endsWith('_CLIENT_ID') ||
    k.endsWith('_AUDIENCE')
  );
}

// A value is a PURE interpolation reference: ${VAR} or ${VAR:?message}. The :?-message may contain
// anything except a closing brace. A ${VAR:-default} / ${VAR:+x} form is intentionally NOT matched
// (an inline default re-introduces a literal).
const PURE_REF = /^\$\{[A-Za-z_][A-Za-z0-9_]*(:\?[^}]*)?\}$/;
// A reference carrying an inline default (`${VAR:-x}` or `${VAR-x}`) — reported under its own rule.
const INLINE_DEFAULT = /\$\{[A-Za-z_][A-Za-z0-9_]*:?-[^}]*\}/;

// Replace every ${...} reference with a single sentinel so the literal-detection regexes below can
// run over the rest of the string without the interpolation (and its possibly space/`/`-bearing
// :?-message) confusing them. The sentinel is non-space, so \S+ / [^\s@]+ match it as one token.
// \u0000 as an escape, never a raw NUL byte: a raw one makes grep treat this whole file as binary
// and silently print no matching lines at all (measured in MCM).
const SENTINEL = '\u0000';
const stripVars = (s) => String(s).replace(/\$\{[^}]*\}/g, SENTINEL);

// A password-bearing connection URL: scheme://user:<pw>@host. After stripVars, a fully-externalized
// password is exactly the sentinel; any other content is a literal.
const URL_PW = /:\/\/[^\s:/@]+:([^\s@]+)@/g;
// command / healthcheck / entrypoint auth literals.
const REQUIREPASS = /--requirepass[\s=]+(\S+)/g;
const REDIS_A = /(?:^|\s)-a[\s=]+(\S+)/g; // redis-cli -a <pw> (guarded by a redis-cli presence check)
const CURL_U = /(?:^|\s)-u[\s=]+[^\s:]+:(\S+)/g; // curl -u user:<pw>

// --- AST helpers ---------------------------------------------------------------

/** The scalar text of a YAML node; `''` for null or a non-scalar. */
function scalarText(node) {
  if (!isScalar(node)) return '';
  return node.value == null ? '' : String(node.value);
}

/** Join a command / healthcheck.test / entrypoint node (string or list) into one scannable string. */
function nodeText(node) {
  if (node == null) return '';
  if (isSeq(node)) return node.items.map(scalarText).join(' ');
  return scalarText(node);
}

/** Iterate an `environment` node (map or `- KEY=VALUE` list form) yielding { key, value, node }. */
function* envEntries(env) {
  if (isMap(env)) {
    for (const pair of env.items) yield { key: scalarText(pair.key), value: scalarText(pair.value), node: pair.key };
  } else if (isSeq(env)) {
    for (const item of env.items) {
      const s = scalarText(item);
      const eq = s.indexOf('=');
      yield eq === -1 ? { key: s, value: '', node: item } : { key: s.slice(0, eq), value: s.slice(eq + 1), node: item };
    }
  }
}

// --- Scanning ------------------------------------------------------------------

/**
 * Scan one compose file's text. Returns findings `{ file, line, rule, message }`; a message names the
 * service and key, never the value. Throws when the text is not valid YAML.
 */
export function scanCompose(file, text) {
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter });
  const findings = [];
  const lineOf = (node) => (node?.range ? lineCounter.linePos(node.range[0]).line : 1);
  const add = (node, rule, message) => findings.push({ file, line: lineOf(node), rule, message });

  /** Scan one text blob for URL / requirepass / -a / -u literals. */
  const scanAuthText = (node, where, rawText) => {
    const text = stripVars(rawText);
    const rules = [
      [URL_PW, 'url-password', `${where} carries a connection URL with a literal password`],
      [REQUIREPASS, 'auth-literal', `${where} passes a literal --requirepass`],
      [CURL_U, 'auth-literal', `${where} passes a literal curl -u password`],
    ];
    for (const [re, rule, message] of rules) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) if (m[1] !== SENTINEL) add(node, rule, `${message} (must be a \${VAR} reference)`);
    }
    if (/redis-cli/.test(text)) {
      REDIS_A.lastIndex = 0;
      let m;
      while ((m = REDIS_A.exec(text))) {
        if (m[1] !== SENTINEL) add(node, 'auth-literal', `${where} passes a literal redis-cli -a password (must be a \${VAR} reference)`);
      }
    }
  };

  for (const doc of docs) {
    if (doc.errors.length) throw new Error(doc.errors[0].message);
    if (!isMap(doc.contents)) continue;
    const services = doc.contents.get('services', true);
    if (!isMap(services)) continue;

    for (const pair of services.items) {
      const svc = scalarText(pair.key);
      const def = pair.value;
      if (!isMap(def)) continue;

      // environment: secret-shaped keys must be pure ${VAR}; any value may carry a password URL.
      for (const { key, value, node } of envEntries(def.get('environment', true))) {
        const where = `${svc}.environment.${key}`;
        if (SECRET_KEY.test(key) && !isAllowlistedKey(key) && !PURE_REF.test(value.trim())) {
          if (INLINE_DEFAULT.test(value)) {
            add(node, 'inline-default', `${where} has an inline \${VAR:-default}, which re-introduces the literal (must be \${${key}:?…})`);
          } else {
            add(node, 'secret-literal', `${where} is secret-shaped and holds a literal (must be \${${key}:?…})`);
          }
        }
        scanAuthText(node, where, value); // a URL password in ANY env value (DATABASE_URL, …)
      }

      // command / healthcheck / entrypoint auth literals.
      const command = def.get('command', true);
      scanAuthText(command, `${svc}.command`, nodeText(command));
      const healthcheck = def.get('healthcheck', true);
      const hcTest = isMap(healthcheck) ? healthcheck.get('test', true) : null;
      scanAuthText(hcTest, `${svc}.healthcheck`, nodeText(hcTest));
      const entrypoint = def.get('entrypoint', true);
      scanAuthText(entrypoint, `${svc}.entrypoint`, nodeText(entrypoint));
    }
  }
  return findings;
}

/** Tracked compose files under `root`, as POSIX paths relative to it. Throws outside a git tree. */
export function composeFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out
    .split('\0')
    .filter(Boolean)
    .map((p) => posix.normalize(p))
    .filter((p) => COMPOSE_NAME.test(posix.basename(p)));
}

function runScan(root) {
  let files;
  try {
    files = composeFiles(root);
  } catch (e) {
    console.error(`[inline-secrets] cannot list tracked files in ${root}: ${e.message}`);
    process.exit(2);
  }
  const findings = [];
  let scanned = 0;
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(resolve(root, rel), 'utf8');
    } catch {
      continue; // tracked but deleted in the work tree
    }
    scanned += 1;
    try {
      findings.push(...scanCompose(rel, text));
    } catch (e) {
      console.error(`${rel}:1: unparseable: ${e.message}`);
      console.error('[inline-secrets] could not run: a compose file the gate cannot parse is refused, never skipped.');
      process.exit(2);
    }
  }
  if (findings.length) {
    for (const f of findings) console.error(`${f.file}:${f.line}: ${f.rule}: ${f.message}`);
    console.error(
      `[inline-secrets] ❌ ${findings.length} inline credential(s) in ${scanned} compose file(s) scanned. Replace each ` +
        'with a ${VAR:?message} reference (or a *_FILE secret) and document the variable in the env example file.',
    );
    process.exit(1);
  }
  console.log(`[inline-secrets] ✅ ${scanned} compose file(s) scanned; no clear-text credentials.`);
}

function selftest() {
  // Planted values are assembled from fragments, so this file holds none contiguously.
  const pw = ['hun', 'ter', '2'].join('');
  const env = (k, v) => `services:\n  x:\n    environment:\n      ${k}: '${v}'\n`;
  const cases = [
    // [label, compose text, expected rule or null for clean]
    ['planted env password', env('POSTGRES_PASSWORD', pw), 'secret-literal'],
    ['planted list-form token', `services:\n  x:\n    environment:\n      - API_TOKEN=${pw}\n`, 'secret-literal'],
    ['planted URL password', env('DATABASE_URL', `postgres://u:${pw}@h:5432/db`), 'url-password'],
    ['planted requirepass', `services:\n  x:\n    command: ["valkey-server", "--requirepass", "${pw}"]\n`, 'auth-literal'],
    ['planted redis-cli -a', `services:\n  x:\n    healthcheck:\n      test: ["CMD", "redis-cli", "-a", "${pw}", "ping"]\n`, 'auth-literal'],
    ['planted curl -u', `services:\n  x:\n    healthcheck:\n      test: ["CMD-SHELL", "curl -u admin:${pw} https://h"]\n`, 'auth-literal'],
    ['planted :- default', env('API_SECRET', '${API_SECRET:-' + pw + '}'), 'inline-default'],
    ['clean ${VAR}', env('POSTGRES_PASSWORD', '${POSTGRES_PASSWORD}'), null],
    ['clean ${VAR:?msg}', env('POSTGRES_PASSWORD', '${POSTGRES_PASSWORD:?set in the stack env file}'), null],
    ['clean URL ${VAR}', env('DATABASE_URL', 'postgres://u:${PG_PW:?msg with spaces}@h:5432/db'), null],
    ['clean requirepass ${VAR}', 'services:\n  x:\n    command: ["valkey-server", "--requirepass", "${R:?m}"]\n', null],
    ['allowlisted _FILE', env('POSTGRES_PASSWORD_FILE', '/run/secrets/pw'), null],
    ['allowlisted _USER', env('POSTGRES_USER', 'app'), null],
    ['allowlisted _CLIENT_ID', env('OIDC_TOKEN_CLIENT_ID', 'belay-app'), null],
  ];
  const fails = [];
  for (const [label, text, rule] of cases) {
    const got = scanCompose('selftest.yaml', text);
    if (rule === null && got.length) fails.push(`${label}: expected clean, got ${got.map((f) => f.rule).join(', ')}`);
    if (rule !== null && !got.some((f) => f.rule === rule)) fails.push(`${label}: expected ${rule}, got ${got.map((f) => f.rule).join(', ') || 'clean'}`);
    if (got.some((f) => f.message.includes(pw))) fails.push(`${label}: a finding printed the planted value`);
  }
  if (!COMPOSE_NAME.test('compose.yaml') || !COMPOSE_NAME.test('docker-compose.prod.yml') || !COMPOSE_NAME.test('media.compose.yaml')) {
    fails.push('a compose file name is not recognised');
  }
  if (COMPOSE_NAME.test('pnpm-workspace.yaml') || COMPOSE_NAME.test('composer.yaml')) fails.push('a non-compose file name is recognised');
  let threw = false;
  try { scanCompose('x.yaml', 'services:\n  x: [unclosed\n'); } catch { threw = true; }
  if (!threw) fails.push('an unparseable compose file did not throw');

  if (fails.length) {
    console.error('[inline-secrets --selftest] ❌ FAILED:\n  - ' + fails.join('\n  - '));
    process.exit(1);
  }
  console.log('[inline-secrets --selftest] ✅ detects planted literals, URL passwords, auth arguments and inline defaults without printing them; clean ${VAR} samples pass.');
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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`${opts.error}. ${USAGE}`);
    process.exit(2);
  }
  if (opts.help) console.log(USAGE);
  else if (opts.selftest) selftest();
  else runScan(opts.dir);
}

// Run only when invoked directly, so importing the module for scanCompose never runs a scan.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
