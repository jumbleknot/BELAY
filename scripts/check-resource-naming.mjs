#!/usr/bin/env node
// Resource-naming gate — every named compose resource follows BELAY's naming grammar.
//
// WHY THIS EXISTS. Ported from MovieCollectionManager (MCM), where Docker volumes, networks and
// containers had grown three naming schemes (compose-project-prefixed `<project>_<name>` volumes,
// container names that differed from their service keys, networks named after whatever joined them
// first). A rename then has to chase every spelling, and a missed one silently resolves to a stale
// object. MCM fixed the names once and gated them; BELAY's constitution requires a root `compose.yaml`,
// so the gate is in place before the first compose file lands.
//
// THE GRAMMAR. A naming CONTEXT is the owning project. Contexts are DERIVED, not listed: every
// directory directly under `backend/`, `frontend/`, `agents/` and `mcp-servers/` (kebab-case per the
// constitution; dotfiles such as `.gitkeep` ignored), read from `git ls-files`, plus
// INFRASTRUCTURE_CONTEXTS below. A new project is admitted by creating its directory, never by
// editing this file.
//   volumes     a declared `name:` is `<context>-<role>-<engine>-data` (e.g. `foo-service-store-postgres-data`).
//               Two relaxed forms, kept from MCM and generalised to any context: `<context>-<…>-logs` (a
//               vendor stack with a separate log volume) and `<context>-<…>-snapshots` (a snapshot
//               repository, which must NOT live inside the data volume an upgrade replaces).
//   networks    a declared `name:` (or an external network's key) ends in `-network`. APPROVED_NETWORKS
//               is enforced as an allowlist ONLY when it is non-empty; while empty, the grammar alone is
//               enforced. (MCM enforced its list unconditionally; an empty list would reject every
//               network, so BELAY opts in by adding the first entry.)
//   containers  `container_name` equals its service key (one identifier, so a rename cannot half-apply),
//               and that identifier is `<context>[-<role>-<engine>]`, unless listed in VENDOR_BUNDLES.
//               A service never re-adds a RETIRED_KEYS entry as a network alias (an old name must fail
//               loudly, not silently resolve).
//   everywhere  no underscore in a declared name: it is the compose-project prefix (`<project>_<name>`)
//               that a missing `name:` produces, and it ties the object to a checkout directory.
// Only DECLARED names are in scope: a volume or network with no `name:` is compose-managed, and a
// service with no `container_name` is not a first-class definition.
//
// SCOPE: every tracked `compose*.yaml` / `compose*.yml` (and `docker-compose*`) anywhere in the tree.
// Dropped in the port (MCM's history, not BELAY's): the `mcm-` qualifier rule, the `ollama` section
// and its removed-object scan of named scripts, and the `infrastructure-as-code/docker/**` glob.
//
// Usage:
//   node scripts/check-resource-naming.mjs [--section=volumes|networks|containers|all[,…]]
//   node scripts/check-resource-naming.mjs --selftest   # planted names; proves the rules bite
//   node scripts/check-resource-naming.mjs --dir <root> # scan another git work tree (tests use this)
//   node scripts/check-resource-naming.mjs --help
//
// Exit codes: 0 clean / selftest passed · 1 violation / selftest broken · 2 bad args, or a compose
// file or the tree that cannot be read or parsed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, posix } from 'node:path';
import { parseDocument, LineCounter } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: check-resource-naming.mjs [--section=volumes|networks|containers|all[,…]] [--dir <root>] | --selftest | --help';

/** The monorepo folders whose immediate subdirectories are naming contexts. */
export const PROJECT_FOLDERS = ['backend', 'frontend', 'agents', 'mcp-servers'];

/**
 * Contexts that are not a project directory. Add one when the FIRST compose file that needs it lands
 * — e.g. an identity provider (`identity`) or an observability stack (`observability`) run as
 * infrastructure rather than built from this repository — in the same change.
 */
export const INFRASTRUCTURE_CONTEXTS = Object.freeze([]);

/**
 * Third-party bundles whose container names come from the vendor's own compose and are exempt from the
 * identifier grammar (still bound by container_name == service key). Add an entry only when adopting a
 * vendor stack whose upstream names cannot be changed without forking it (MCM's case: LangFuse's
 * `langfuse-web`, `langfuse-worker`, …).
 */
export const VENDOR_BUNDLES = Object.freeze([]);

/**
 * Service keys retired by a rename. Add the OLD key in the change that renames a service, so a missed
 * reference cannot quietly keep resolving through a network alias.
 */
export const RETIRED_KEYS = Object.freeze([]);

/**
 * When non-empty, the only network names allowed. Add an entry when a network is shared across compose
 * files or joined externally (an edge tunnel, an isolated database link), so its name is reviewed once.
 */
export const APPROVED_NETWORKS = Object.freeze([]);

export const ALL_SECTIONS = ['volumes', 'networks', 'containers'];

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMPOSE_FILE = /^(?:docker-)?compose[^/]*\.ya?ml$/;

function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.split(/\r?\n/).filter(Boolean).map((p) => posix.normalize(p));
}

/** Naming contexts from tracked paths: `<folder>/<context>/…` for each project folder. */
export function deriveContexts(paths, extra = INFRASTRUCTURE_CONTEXTS) {
  const out = new Set(extra);
  for (const p of paths) {
    const parts = p.split('/');
    if (parts.length < 3 || !PROJECT_FOLDERS.includes(parts[0])) continue;
    if (KEBAB.test(parts[1])) out.add(parts[1]);
  }
  return [...out].sort();
}

export const composeFilesIn = (paths) => paths.filter((p) => COMPOSE_FILE.test(posix.basename(p))).sort();

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The context-bound regexes. With no context at all, nothing context-bound can match. */
export function grammarFor(contexts) {
  const alt = contexts.length ? `(?:${[...contexts].sort((a, b) => b.length - a.length).map(escape).join('|')})` : '(?!)';
  return {
    volume: [
      new RegExp(`^${alt}-[a-z0-9]+(?:-[a-z0-9]+)*-data$`),
      new RegExp(`^${alt}-[a-z0-9]+(?:-[a-z0-9]+)*-logs$`),
      new RegExp(`^${alt}-[a-z0-9]+(?:-[a-z0-9]+)*-snapshots$`),
    ],
    identifier: new RegExp(`^${alt}(?:-[a-z0-9]+)*$`),
  };
}

function aliasEntries(networks) {
  // Compose `networks:` is either a list (`- backend-network`) or a map (`net: { aliases: [...] }`).
  const out = [];
  if (!networks || Array.isArray(networks) || typeof networks !== 'object') return out;
  for (const [net, def] of Object.entries(networks)) {
    if (def && typeof def === 'object' && Array.isArray(def.aliases)) def.aliases.forEach((a, i) => out.push({ net, i, alias: a }));
  }
  return out;
}

/**
 * Check one compose file's text. Throws on unparseable YAML (the caller exits 2).
 * @returns {{file:string,line:number,rule:string,token:string,message:string}[]}
 */
export function checkCompose(text, file, {
  contexts,
  sections = ALL_SECTIONS,
  vendorBundles = VENDOR_BUNDLES,
  retiredKeys = RETIRED_KEYS,
  approvedNetworks = APPROVED_NETWORKS,
} = {}) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  if (doc.errors.length) throw new Error(`${file}: not parseable YAML — ${doc.errors[0].message.split('\n')[0]}`);
  const data = doc.toJS() ?? {};
  const g = grammarFor(contexts);
  const vendors = new Set(vendorBundles);
  const retired = new Set(retiredKeys);
  const approved = new Set(approvedNetworks);
  const findings = [];
  const lineOf = (path) => {
    const node = doc.getIn(path, true);
    return node?.range ? lineCounter.linePos(node.range[0]).line : 1;
  };
  const add = (path, rule, token, message) => findings.push({ file, line: lineOf(path), rule, token, message });

  if (sections.includes('volumes') && data.volumes && typeof data.volumes === 'object') {
    for (const [key, def] of Object.entries(data.volumes)) {
      const name = def && typeof def === 'object' ? def.name : undefined;
      if (!name) continue;
      const at = ['volumes', key, 'name'];
      if (String(name).includes('_')) {
        add(at, 'compose-prefix', name, `volume '${key}' name '${name}' carries a compose-project prefix (underscore) — declare a context-qualified name`);
      } else if (!g.volume.some((re) => re.test(name))) {
        add(at, 'volume-grammar', name, `volume '${key}' name '${name}' is not <context>-<role>-<engine>-data (or the -logs / -snapshots forms) for a known context: ${contexts.join(', ') || 'none yet'}`);
      }
    }
  }

  if (sections.includes('networks') && data.networks && typeof data.networks === 'object') {
    for (const [key, def] of Object.entries(data.networks)) {
      const obj = def && typeof def === 'object' ? def : {};
      const external = obj.external === true || Boolean(obj.external && obj.external.name);
      const name = obj.name || (external ? key : undefined);
      if (!name) continue; // compose-managed, no explicit name
      const at = obj.name ? ['networks', key, 'name'] : ['networks', key];
      if (String(name).includes('_')) {
        add(at, 'compose-prefix', name, `network '${key}' name '${name}' carries a compose-project prefix (underscore)`);
      } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-network$/.test(name)) {
        add(at, 'network-grammar', name, `network '${key}' name '${name}' must be kebab-case ending in -network`);
      } else if (approved.size && !approved.has(name)) {
        add(at, 'network-approved', name, `network '${name}' is not in APPROVED_NETWORKS — add it there to approve it`);
      }
    }
  }

  if (sections.includes('containers') && data.services && typeof data.services === 'object') {
    for (const [svc, def] of Object.entries(data.services)) {
      if (!def || typeof def !== 'object') continue;
      const cn = def.container_name;
      if (!cn) continue;
      const at = ['services', svc, 'container_name'];
      if (cn !== svc) {
        add(at, 'container-name-mismatch', cn, `service key '${svc}' ≠ container_name '${cn}' — unify both to one identifier`);
      }
      if (!vendors.has(cn) && !g.identifier.test(cn)) {
        add(at, 'identifier-grammar', cn, `service '${svc}' identifier '${cn}' is not <context>[-<role>-<engine>] for a known context (${contexts.join(', ') || 'none yet'}) and is not a VENDOR_BUNDLES entry`);
      }
      for (const { net, i, alias } of aliasEntries(def.networks)) {
        if (retired.has(alias)) {
          add(['services', svc, 'networks', net, 'aliases', i], 'retired-alias', alias, `service '${svc}' re-adds retired key '${alias}' as a network alias — old names must not resolve`);
        }
      }
    }
  }
  return findings;
}

function parseArgs(argv) {
  const opts = { selftest: false, help: false, dir: REPO_ROOT, sections: ALL_SECTIONS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') opts.selftest = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--dir') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: '--dir needs a directory' };
      opts.dir = resolve(v);
    } else if (a.startsWith('--section=')) {
      const raw = a.slice('--section='.length);
      if (raw === 'all') continue;
      const requested = raw.split(',').map((s) => s.trim());
      const bad = requested.filter((s) => !ALL_SECTIONS.includes(s));
      if (bad.length || !requested.length) return { error: `Unknown --section value(s): ${bad.join(', ') || '(empty)'}. Valid: ${ALL_SECTIONS.join(', ')}, all` };
      opts.sections = requested;
    } else return { error: `Unknown argument: ${a}` };
  }
  return opts;
}

function runScan(root, sections) {
  let paths;
  try {
    paths = trackedFiles(root);
  } catch (e) {
    console.error(`[resource-naming] cannot list tracked files in ${root}: ${String(e.stderr || e.message).trim()}`);
    process.exit(2);
  }
  const contexts = deriveContexts(paths);
  const files = composeFilesIn(paths);
  const findings = [];
  for (const rel of files) {
    try {
      findings.push(...checkCompose(readFileSync(resolve(root, rel), 'utf8'), rel, { contexts, sections }));
    } catch (e) {
      console.error(`[resource-naming] cannot check ${rel}: ${e.message}`);
      process.exit(2);
    }
  }
  const summary = `sections: ${sections.join(', ')}; contexts: ${contexts.join(', ') || 'none'}; ${files.length} compose file(s) scanned`;
  if (findings.length) {
    for (const f of findings) console.error(`${f.file}:${f.line}: ${f.rule}: ${f.message}`);
    console.error(`[resource-naming] ❌ ${findings.length} violation(s) (${summary}). Rename to the grammar in scripts/check-resource-naming.mjs, or add the project directory that owns the context.`);
    process.exit(1);
  }
  console.log(`[resource-naming] ✅ every declared name follows the grammar (${summary}).`);
}

function selftest() {
  const contexts = ['foo-service', 'bar'];
  const count = (text, extra = {}) => checkCompose(text, 'selftest', { contexts, ...extra }).length;
  const cases = [
    ['volume, logs and snapshots forms for a known context pass', count('volumes:\n  a: { name: foo-service-store-postgres-data }\n  b: { name: bar-trace-logs }\n  c: { name: bar-search-snapshots }\n'), 0],
    ['a volume for an unknown context is rejected', count('volumes:\n  a: { name: baz-store-postgres-data }\n'), 1],
    ['a near-miss context (fooservice-*) is rejected', count('volumes:\n  a: { name: fooservice-store-postgres-data }\n'), 1],
    ['a context with no role (foo-service-data) is rejected', count('volumes:\n  a: { name: foo-service-data }\n'), 1],
    ['an underscore-prefixed name is rejected', count('volumes:\n  a: { name: belay_foo-service-store-postgres-data }\n'), 1],
    ['a -network network passes', count('networks:\n  n: { name: foo-service-network }\n'), 0],
    ['a non -network network is rejected', count('networks:\n  n: { name: foo-service-net }\n'), 1],
    ['an external network key is checked', count('networks:\n  shared: { external: true }\n'), 1],
    ['an unapproved network is rejected once APPROVED_NETWORKS is non-empty', count('networks:\n  n: { name: bar-network }\n', { approvedNetworks: ['foo-service-network'] }), 1],
    ['matching container_name and service key pass', count('services:\n  foo-service-store-postgres:\n    container_name: foo-service-store-postgres\n'), 0],
    ['container_name ≠ service key is rejected', count('services:\n  foo-service:\n    container_name: foo-service-app\n'), 1],
    ['an unknown-context container is rejected', count('services:\n  baz:\n    container_name: baz\n'), 1],
    ['a VENDOR_BUNDLES container is exempt from the grammar', count('services:\n  vendor-web:\n    container_name: vendor-web\n', { vendorBundles: ['vendor-web'] }), 0],
    ['a retired key re-added as an alias is rejected', count('services:\n  bar:\n    container_name: bar\n    networks:\n      bar-network: { aliases: [old-bar] }\n', { retiredKeys: ['old-bar'] }), 1],
    ['a sections filter skips the other rules', checkCompose('networks:\n  n: { name: x }\n', 'selftest', { contexts, sections: ['volumes'] }).length, 0],
  ];
  let bad = 0;
  for (const [what, got, expected] of cases) {
    const ok = got === expected;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${what} — ${got} violation(s), expected ${expected}`);
  }
  const derived = deriveContexts(['backend/foo-service/a', 'agents/bar/b', 'frontend/.gitkeep', 'backend/Not_Kebab/x', 'docs/x/y']);
  if (derived.join(',') !== 'bar,foo-service') {
    bad++;
    console.log(`✗ contexts are derived from project directories — got ${derived.join(',')}`);
  }
  let threw = false;
  try { checkCompose('services: [unclosed\n', 'selftest', { contexts }); } catch { threw = true; }
  if (!threw) { bad++; console.log('✗ unparseable YAML must throw'); }
  if (bad) {
    console.error(`[resource-naming --selftest] ❌ ${bad} case(s) broken`);
    process.exit(1);
  }
  console.log('[resource-naming --selftest] ✅ the grammar admits what it should and rejects what it should.');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`${opts.error}. ${USAGE}`);
    process.exit(2);
  }
  if (opts.help) console.log(USAGE);
  else if (opts.selftest) selftest();
  else runScan(opts.dir, opts.sections);
}
