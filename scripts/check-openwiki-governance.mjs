#!/usr/bin/env node
// OpenWiki governance gate.
//
// Usage:
//   node scripts/check-openwiki-governance.mjs                       # validate this repository
//   node scripts/check-openwiki-governance.mjs --selftest             # prove detection; reads no repo
//   node scripts/check-openwiki-governance.mjs --root <path>          # validate another root (tests)
//   node scripts/check-openwiki-governance.mjs --json                 # machine-readable findings
//   node scripts/check-openwiki-governance.mjs --explain <path>       # which policy entry governs a path
//   node scripts/check-openwiki-governance.mjs --fingerprint <concept> <anchor>
//   node scripts/check-openwiki-governance.mjs --help                 # this usage
//
// Exit codes: 0 clean / selftest passed · 1 violation / selftest broken · 2 bad args.
//
// ── What this gate is for ────────────────────────────────────────────────────────────────────────
// Load-bearing knowledge lives in the openwiki/ bundle, not in the instruction file. That is only safe
// if these things are mechanically true:
//
//   * a load-bearing passage in an authoritative concept cannot be silently reworded or dropped
//     (G5–G7) — the protection manifest, openwiki/protected.yaml, is the authority, not the concept;
//   * the instruction file cannot quietly re-grow, and every surface pointing into the bundle resolves
//     (G8–G10; G16 bounds its size). AGENTS.md is the one instruction file; CLAUDE.md is held to a shim
//     that imports it (G15);
//   * every concept declares whether it is canonical or a summary (G11), because the rule for where a
//     new learning goes is undecidable otherwise, and a summary cites ONE human-written file (G14);
//   * IF a generator rewrites the bundle, every documentation path has a declared regeneration policy
//     and the generator's write scope stays inside the bundle (G1–G4, G12).
//
// BELAY HAS NO GENERATOR, and so no openwiki/policy.yaml. An absent policy means "no generated paths"
// and G1–G4/G12 have nothing to check (see scripts/openwiki-policy.mjs). A policy file that is
// present but broken is still a G0 violation.
//
// Two properties are load-bearing and easy to break by accident:
//   * OFFLINE and KEYLESS. It runs in `scripts:lint`, inside the required `guardrails` check, on every
//     change. No network, no credential, `node:` built-ins + `yaml` only.
//   * FAIL-CLOSED. A missing protection manifest, or an unparseable governance file, is a VIOLATION,
//     never a skip. There is deliberately no skip flag and no allowlist: a rejected page is fixed in
//     the page or in openwiki/INSTRUCTIONS.md, never accepted in place.
//
// Ported from MovieCollectionManager. Changed only where it was coupled to that repository: the
// absent-policy case, the managed regions (Spec Kit's only), the top-level folders a surface may cite,
// and the selftest's fixtures. The rules and the budgets are unchanged.

import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

import { loadPolicy, resolvePolicy, globToRegExp, actorMembers, POLICY_STATES, ACTORS, GENERATOR_SCOPE_PREFIX } from './openwiki-policy.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BUNDLE = 'openwiki';
const MANIFEST_FILE = 'openwiki/protected.yaml';
const INSTRUCTION_FILE = 'AGENTS.md';

/**
 * CLAUDE.md is a SHIM (G15). AGENTS.md is the one instruction file: tools such as Codex and OpenCode
 * read only it, and Copilot reads both it and CLAUDE.md. Claude Code reads only CLAUDE.md, which
 * reaches AGENTS.md through its `@AGENTS.md` import. Any content added to CLAUDE.md therefore splits
 * the instructions (Claude sees it, the AGENTS.md-only tools never do), and a copy of AGENTS.md there
 * makes a tool that reads both load everything twice. So CLAUDE.md may hold only the import, HTML
 * comments and the tool-managed regions.
 */
const SHIM_FILE = 'CLAUDE.md';
const SHIM_IMPORT = '@AGENTS.md';

/** Bundle files that are not concepts: navigation, the brief, the tool's history. */
const RESERVED = new Set(['index.md', 'INSTRUCTIONS.md', 'log.md', 'quickstart.md']);

/**
 * Assistant-facing configuration surfaces. They must not point at content that has moved. Neither
 * exists in BELAY today; each is checked the day it appears.
 * AGENTS.md (the instruction file) is checked separately and more strictly (G8/G9), CLAUDE.md as a
 * shim (G15).
 */
const ASSISTANT_SURFACES = ['opencode.json', '.claude/settings.json'];

/**
 * The machine-managed regions of the instruction file. Prose inside one is EXEMPT: the owning tool
 * rewrites it wholesale, so a gate that rejected its content would fail on something no human can fix
 * — and a gate that fights its own tooling gets switched off.
 *
 * BELAY has ONE: Spec Kit's agent-context region (`specify` writes it into AGENTS.md). MCM also
 * exempts an Nx region and its generator's OPENWIKI region; no tool writes either here, so a block
 * wearing one of those markers in BELAY is hand-written prose in disguise and is NOT exempt. Add a
 * region only when a tool that writes it is adopted.
 */
const MANAGED_REGIONS = [
  [/<[!]--\s*SPECKIT START\s*-->/i, /<[!]--\s*SPECKIT END\s*-->/i],
];

/**
 * G16: the size budget of the instruction file, outside the managed regions. Every assistant loads
 * this file into its context on every session, so its size is a recurring cost, and G8 alone does not
 * bound it: a line passes G8 by carrying a link, however long the prose before that link. In
 * MovieCollectionManager the gates grew to ~1,900 characters each that way and the file to ~40 KB,
 * until a trim halved it (2026-11-20).
 *
 * A line holds a rule, its trap, and a link; the story behind the rule belongs in the linked doc. The
 * values are MCM's, kept as ported: ~15% above its trimmed size, so a new index entry fits but a
 * regrowth does not.
 * Raising either is a deliberate act in this file, never a quiet one. Counted in UTF-16 code units
 * (`String.length`), not bytes — a byte count over-reports every em-dash by two.
 */
const INSTRUCTION_LINE_MAX = 650;
const INSTRUCTION_TOTAL_MAX = 18000;

const DOC_PATH = /\.(md|markdown)$/i;

// ── argument parsing ────────────────────────────────────────────────────────────

const USAGE = 'Usage: node scripts/check-openwiki-governance.mjs [--selftest] [--root <path>] [--json] [--explain <path>] [--fingerprint <concept> <anchor>] [--help]';

function parseArgs(argv) {
  const opts = { root: REPO_ROOT, selftest: false, json: false, explain: null, fingerprint: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--selftest') opts.selftest = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--root') {
      const v = argv[++i];
      if (!v) return { error: '--root requires a path' };
      opts.root = resolve(v);
    } else if (a.startsWith('--root=')) opts.root = resolve(a.slice('--root='.length));
    else if (a === '--explain') {
      const v = argv[++i];
      if (!v) return { error: '--explain requires a repository-relative path' };
      opts.explain = v;
    } else if (a === '--fingerprint') {
      const concept = argv[++i];
      const anchor = argv[++i];
      if (!concept || !anchor) return { error: '--fingerprint requires <concept> <anchor>' };
      opts.fingerprint = { concept, anchor };
    } else return { error: `unknown argument: ${a}` };
  }
  return { opts };
}

// ── file discovery ──────────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', '.venv', '.nx', '.pnpm-store', 'coverage',
  'test-results', 'playwright-report', '.maestro', '.expo', '.cargo', '.mypy_cache', '.ruff_cache',
]);

function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(root, join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
    }
  }
  return out;
}

/**
 * Every file the root holds, as repository-relative paths.
 *
 * Prefers git — `--cached --others --exclude-standard` gives tracked plus not-ignored-untracked, so a
 * clean CI checkout and a working tree with new files both answer correctly, and .gitignore keeps
 * dependency trees out. Falls back to a walk when the root is not in a git work tree (selftest
 * scratch directories).
 */
function listFiles(root) {
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim() !== '') return r.stdout.split('\n').filter(Boolean);
  return walk(root);
}

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

function frontMatter(text) {
  if (!/^---\r?\n/.test(text)) return {};
  const end = text.indexOf('\n---', 4);
  if (end === -1) return {};
  try {
    const parsed = parseYaml(text.slice(text.indexOf('\n') + 1, end));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ── passage fingerprints ────────────────────────────────────────────────────────

/**
 * Normalize a passage before hashing.
 *
 * Line endings and trailing whitespace only. Deliberately nothing else: OVER-normalizing would let a
 * meaning-changing edit pass, which is the single failure this protection exists to prevent. Case,
 * internal spacing, punctuation and blank lines are all preserved.
 */
export function normalizePassage(text) {
  return `${text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')}\n`;
}

export const fingerprintOf = (text) => `sha256:${createHash('sha256').update(normalizePassage(text), 'utf8').digest('hex')}`;

/**
 * The body of the section introduced by the heading whose text is `anchor`, or null when no such
 * heading exists — which is a REMOVAL (G6), not an absence of anything to compare.
 */
export function extractPassage(text, anchor) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const wanted = anchor.trim().toLowerCase();
  const start = lines.findIndex((l) => /^#{1,6}\s+/.test(l) && l.replace(/^#{1,6}\s+/, '').trim().toLowerCase() === wanted);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s+/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

// ── the instruction file ────────────────────────────────────────────────────────

/** Line ranges covered by a machine-managed region, as a Set of line indices. */
function managedLines(lines) {
  const covered = new Set();
  for (const [startRe, endRe] of MANAGED_REGIONS) {
    const start = lines.findIndex((l) => startRe.test(l));
    if (start === -1) continue;
    let end = lines.findIndex((l, i) => i > start && endRe.test(l));
    if (end === -1) end = lines.length - 1;
    for (let i = start; i <= end; i++) covered.add(i);
  }
  return covered;
}

/**
 * Is this line structural rather than prose?
 *
 * The rule is deliberately crisp: outside the managed regions, **every non-blank line must either be
 * structure or carry a link**. Anything softer — "a short paragraph is fine", "one sentence per
 * section" — is an invitation, and MCM's file grew to 592 lines under exactly that kind of latitude
 * once already.
 */
const isStructural = (line) => {
  const t = line.trim();
  if (t === '') return true;
  if (/^#{1,6}\s+/.test(t)) return true;              // heading
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return true;  // horizontal rule
  if (t.startsWith('<!--') || t.endsWith('-->')) return true; // an HTML comment / region marker
  if (/^\|[\s:|-]+\|?$/.test(t)) return true;         // table separator
  return /\]\([^)]+\)/.test(t) || /^<[a-z!/]/i.test(t); // carries a link, or is markup
};

const LINK_RE = /\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)/g;

function linksIn(text) {
  return [...text.matchAll(LINK_RE)].map((m) => m[1]).filter((t) => !/^([a-z]+:)?\/\//i.test(t) && !t.startsWith('mailto:'));
}

/** Repo-relative paths named in inline code or JSON strings — how a surface points at a document. */
function citedPaths(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`]+)`/g)) out.add(m[1]);
  for (const m of text.matchAll(/"([^"]+)"/g)) out.add(m[1]);
  // BELAY's top-level folders (openwiki/projects/repository.md).
  return [...out].filter((p) => /^(docs|openwiki|specs|scripts|packages|tools|security|secrets|infrastructure-as-code|frontend|backend|agents|mcp-servers|api-specs|assets)\/[\w./-]+\.(md|ya?ml|json|mjs|toml|sh)$/.test(p));
}

// ── files an automated writer rewrites (G14, research R4) ────────────────────────
//
// The fixed list is the definition of "Renovate-managed" for G14: the files Renovate's DEFAULT managers
// match (their built-in `fileMatch` sets for npm/pnpm, cargo, pep621/uv, pip_requirements, dockerfile,
// docker-compose, forgejo/github actions, nvm/node-version, asdf, rust-toolchain, pyenv), plus the
// `.env.deploy` files a CD pipeline rewrites. BELAY has neither Renovate nor CD today; the list is
// kept because a bot-rewritten citation is wrong whichever bot does the rewriting, and the brief
// (openwiki/INSTRUCTIONS.md, section 5) forbids citing a lock file, a workflow or a manifest. It is not a promise to mirror Renovate exactly; widening it is a
// one-line edit. The repository's own `customManagers` patterns are read at check time, so a new custom
// manager is covered without touching this list.

const AUTOMATED_WRITER_GLOBS = [
  '**/.env.deploy',
  '**/package.json', '**/pnpm-lock.yaml',
  '**/Cargo.toml', '**/Cargo.lock',
  '**/pyproject.toml', '**/uv.lock', '**/requirements*.txt',
  '**/Dockerfile*', '**/*.Dockerfile',
  '**/*compose*.yml', '**/*compose*.yaml',
  '.forgejo/workflows/**',
  'renovate.json',
  '**/.nvmrc', '**/.node-version', '**/.tool-versions', '**/rust-toolchain.toml', '**/.python-version',
];

function automatedWriterMatchers(root) {
  const out = AUTOMATED_WRITER_GLOBS.map((g) => ({ re: globToRegExp(g), why: `matches \`${g}\`, a file Renovate's default managers or CD rewrite` }));
  const renovatePath = join(root, 'renovate.json');
  if (!existsSync(renovatePath)) return out;
  let config;
  try {
    config = JSON.parse(readFileSync(renovatePath, 'utf8'));
  } catch {
    return out; // a broken renovate.json is Renovate's own validator's finding, not this gate's
  }
  for (const manager of Array.isArray(config.customManagers) ? config.customManagers : []) {
    for (const pattern of [...(manager.managerFilePatterns ?? []), ...(manager.fileMatch ?? [])]) {
      if (typeof pattern !== 'string') continue;
      // Renovate: a `/…/flags` string is a regex, anything else a glob.
      const m = /^\/(.+)\/([a-z]*)$/.exec(pattern);
      let re;
      try {
        re = m ? new RegExp(m[1], m[2]) : globToRegExp(pattern);
      } catch {
        continue;
      }
      out.push({ re, why: `matches renovate.json customManagers pattern \`${pattern}\`` });
    }
  }
  return out;
}

// ── the gate ────────────────────────────────────────────────────────────────────

export function validate(root) {
  const findings = [];
  const add = (rule, file, message) => findings.push({ rule, file, message });

  // ── fail-closed on the governance files themselves ─────────────────────────────
  // An ABSENT policy is `{absent: true}` (no generator, no generated paths), not an error. A present
  // but broken one throws, and is a finding.
  let policy = null;
  try {
    policy = loadPolicy(root);
  } catch (err) {
    add('G0', 'openwiki/policy.yaml', `${err.message} — a present regeneration policy must parse; a broken one must never read as "everything is permitted"`);
  }

  let manifest = null;
  if (!existsSync(join(root, MANIFEST_FILE))) {
    add('G0', MANIFEST_FILE, 'the protection manifest is missing — it is a required artifact, and its absence must be a reviewable failure rather than a silent loss of protection');
  } else {
    try {
      const parsed = parseYaml(read(root, MANIFEST_FILE));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be a mapping');
      manifest = {
        authoritative: Array.isArray(parsed.authoritative) ? parsed.authoritative : [],
        passages: Array.isArray(parsed.passages) ? parsed.passages : [],
      };
      if (!Array.isArray(parsed.authoritative)) {
        add('G0', MANIFEST_FILE, 'the manifest declares no `authoritative:` list — every concept has to be classifiable (G11)');
      }
    } catch (err) {
      add('G0', MANIFEST_FILE, `does not parse: ${err.message.split('\n')[0]}`);
    }
  }

  if (policy === null || manifest === null) return { findings, conceptCount: 0, docPathCount: 0, policyAbsent: false };

  const files = listFiles(root);
  const docPaths = files.filter((f) => DOC_PATH.test(f));

  // ── G1: nothing unclassified (only when a policy exists: no generator, nothing to classify) ──
  for (const path of policy.absent ? [] : docPaths) {
    if (resolvePolicy(policy, path) === null) {
      add('G1', path, 'no policy.yaml entry classifies this documentation path — add one, or the question of when it may be rewritten has no answer');
    }
  }

  // ── G2/G3/G4: the declarations themselves ────────────────────────────────────
  for (const entry of policy.entries) {
    if (!POLICY_STATES.includes(entry.policy)) {
      add('G2', 'openwiki/policy.yaml', `entry \`${entry.glob}\` declares policy \`${entry.policy}\`, which is not one of: ${POLICY_STATES.join(', ')}`);
    }
    // `actor` may be one name or a list; every member is checked.
    const actors = actorMembers(entry.actor);
    if (entry.actor !== undefined && actors.length === 0) {
      add('G2', 'openwiki/policy.yaml', `entry \`${entry.glob}\` declares an empty actor list`);
    }
    for (const actor of actors) {
      if (!ACTORS.includes(actor)) {
        add('G2', 'openwiki/policy.yaml', `entry \`${entry.glob}\` declares actor \`${actor}\`, which is not one of: ${ACTORS.join(', ')}`);
      }
    }
    if (actors.includes('generator') && !entry.glob.startsWith(GENERATOR_SCOPE_PREFIX)) {
      add('G3', 'openwiki/policy.yaml', `entry \`${entry.glob}\` names actor \`generator\` outside \`${GENERATOR_SCOPE_PREFIX}\`. The generator's write scope is the bundle plus its own managed regions; every other regenerate assignment governs an agent under human review. Widening it is a separate decision, not a policy edit`);
    }
    if (entry.policy === 'event-driven' && !(Array.isArray(entry.events) && entry.events.length > 0)) {
      add('G4', 'openwiki/policy.yaml', `entry \`${entry.glob}\` is event-driven but declares no \`events\` — the state is meaningless without its trigger, and "never written as a side effect" then reads as "never written at all"`);
    }
  }

  // ── the bundle's concepts ────────────────────────────────────────────────────
  const bundleRoot = join(root, BUNDLE);
  const concepts = [];
  if (existsSync(bundleRoot) && statSync(bundleRoot).isDirectory()) {
    for (const entry of readdirSync(bundleRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      for (const f of readdirSync(join(bundleRoot, entry.name), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!f.isFile() || !f.name.endsWith('.md') || RESERVED.has(f.name)) continue;
        const rel = `${BUNDLE}/${entry.name}/${f.name}`;
        const text = read(root, rel);
        const fm = frontMatter(text);
        const resource = typeof fm.resource === 'string' && fm.resource.trim() !== '' ? fm.resource.trim() : null;
        const external = resource !== null && /^[a-z][a-z0-9+.-]*:\/\//i.test(resource);
        concepts.push({
          rel,
          bundleRel: `${entry.name}/${f.name}`,
          text,
          resource,
          // A citation only classifies a concept as derived if it RESOLVES. A dangling one is either a
          // rename nobody followed or canonical content wearing a citation it does not have.
          derived: resource !== null && (external || existsSync(join(root, resource.split('#')[0]))),
        });
      }
    }
  }

  const authoritative = new Set(manifest.authoritative);

  // ── G11: exactly one classification per concept ──────────────────────────────
  for (const c of concepts) {
    const listed = authoritative.has(c.bundleRel);
    if (listed && c.derived) {
      add('G11', c.rel, `is BOTH derived (cites \`${c.resource}\`) and listed as authoritative in ${MANIFEST_FILE}. It cannot be canonical and a summary of something else at once — drop the citation, or drop the listing`);
    } else if (!listed && !c.derived) {
      add('G11', c.rel, c.resource === null
        ? `is NEITHER derived nor authoritative: it cites no source and is not listed under \`authoritative:\` in ${MANIFEST_FILE}. A learning about this subject then has no determinable home — add the citation it is missing, or declare it canonical`
        : `cites \`${c.resource}\`, which does not resolve, and is not listed as authoritative. A dangling citation classifies as neither — fix the path, or declare the concept canonical`);
    }
  }

  // ── G12: an authoritative concept must not be `regenerate` ───────────────────
  for (const bundleRel of authoritative) {
    const path = `${BUNDLE}/${bundleRel}`;
    const entry = resolvePolicy(policy, path);
    if (entry === null) continue; // already reported by G1
    if (entry.policy === 'regenerate') {
      add('G12', path, `is authoritative but its effective policy is \`regenerate\` (from entry \`${entry.glob}\`). An authoritative concept has no upstream document, so a refresh has nothing to refresh FROM — it could only paraphrase, which is exactly what the fingerprints exist to prevent. Declare it \`event-driven\``);
    }
  }

  // ── G14: a derived page summarises ONE file that no bot rewrites ─────────────
  // A directory has no single fingerprint, and a tree hash would block every PR touching any file in
  // it. If a bot rewrites the source, V17 goes red on a PR with no session there to refresh the
  // summary.
  const botWritten = automatedWriterMatchers(root);
  for (const c of concepts) {
    if (!c.derived || /^[a-z][a-z0-9+.-]*:\/\//i.test(c.resource)) continue;
    const path = c.resource.split('#')[0].split('?')[0].replace(/^\.\//, '');
    if (statSync(join(root, path)).isDirectory()) {
      add('G14', c.rel, `cites the directory \`${c.resource}\`. A derived page summarises exactly one file, so its fingerprint (V17) has one thing to match — re-point \`resource\` at one file, or make the page canonical (list it under \`authoritative:\` in ${MANIFEST_FILE})`);
      continue;
    }
    const hit = botWritten.find((m) => m.re.test(path.replace(/\/$/, '')));
    if (hit) {
      add('G14', c.rel, `cites \`${c.resource}\`, which ${hit.why}. A bot change would make this page stale (V17) with no session there to refresh it — cite the human-written document that explains the subject instead`);
    }
  }

  // ── G5/G6/G7: protected passages ─────────────────────────────────────────────
  const byBundleRel = new Map(concepts.map((c) => [c.bundleRel, c]));
  for (const p of manifest.passages) {
    const label = `${p.concept ?? '<no concept>'} :: ${p.anchor ?? '<no anchor>'}`;
    if (!p.concept || !p.anchor || !p.fingerprint) {
      add('G5', MANIFEST_FILE, `entry ${label} needs \`concept\`, \`anchor\` and \`fingerprint\``);
      continue;
    }
    if (!authoritative.has(p.concept)) {
      add('G7', MANIFEST_FILE, `protected passage "${p.anchor}" is on \`${p.concept}\`, which is not listed under \`authoritative:\`. Protection belongs to canonical content only`);
    }
    const concept = byBundleRel.get(p.concept);
    if (!concept) {
      add('G6', `${BUNDLE}/${p.concept}`, `the manifest protects "${p.anchor}" in this concept, but the concept does not exist. The manifest is the authority: a protected passage can only be deliberately delisted, never silently removed`);
      continue;
    }
    if (concept.resource !== null) {
      add('G7', concept.rel, `carries a protected passage ("${p.anchor}") while declaring \`resource: ${concept.resource}\`. Freezing a derived summary against the document it summarizes would fail every legitimate refresh — protection belongs to authoritative content only. Remove the \`resource\` field if the concept is genuinely canonical, or delist the passage`);
    }
    const passage = extractPassage(concept.text, p.anchor);
    if (passage === null) {
      add('G6', concept.rel, `the protected passage "${p.anchor}" has been REMOVED — no heading with that text remains. This fails as a removal rather than passing for lack of text to compare; if the removal is intended, delist it in ${MANIFEST_FILE} in the same change`);
      continue;
    }
    const actual = fingerprintOf(passage);
    if (actual !== p.fingerprint) {
      add('G5', concept.rel, `the protected passage "${p.anchor}" no longer matches its fingerprint (declared ${String(p.fingerprint).slice(0, 19)}…, actual ${actual.slice(0, 19)}…). It was relocated from ${p.origin ?? 'the instruction file'} and is load-bearing: a reword, a reorder or a paraphrase all land here. If the change is intended, update the fingerprint in the SAME change — \`--fingerprint ${concept.rel} "${p.anchor}"\` prints the new value`);
    }
  }

  // ── G8/G9: the instruction file is a thin index ──────────────────────────────
  if (existsSync(join(root, INSTRUCTION_FILE))) {
    const text = read(root, INSTRUCTION_FILE);
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const managed = managedLines(lines);

    for (const [i, line] of lines.entries()) {
      if (managed.has(i) || isStructural(line)) continue;
      add('G8', INSTRUCTION_FILE, `line ${i + 1} is prose beyond the index and the machine-managed regions: "${line.trim().slice(0, 70)}…". The index holds subject → concept links; the content itself belongs in the concept. Without this rule the file silently re-grows and the trim is undone within weeks`);
    }

    // ── G16: the size budget (see INSTRUCTION_LINE_MAX) ──
    let total = 0;
    for (const [i, line] of lines.entries()) {
      if (managed.has(i)) continue;
      total += line.length;
      if (line.length > INSTRUCTION_LINE_MAX) {
        add('G16', INSTRUCTION_FILE, `line ${i + 1} is ${line.length} characters, over the ${INSTRUCTION_LINE_MAX} budget: "${line.trim().slice(0, 70)}…". Keep the rule, its trap and the link; move the story into the linked doc`);
      }
    }
    if (total > INSTRUCTION_TOTAL_MAX) {
      add('G16', INSTRUCTION_FILE, `holds ${total} characters outside the managed regions, over the ${INSTRUCTION_TOTAL_MAX} budget. Every session loads this file; trim an entry to its rule, trap and link before raising INSTRUCTION_TOTAL_MAX`);
    }

    for (const target of linksIn(lines.filter((_, i) => !managed.has(i)).join('\n'))) {
      if (!existsSync(join(root, target.split('#')[0]))) {
        add('G9', INSTRUCTION_FILE, `index entry points at \`${target}\`, which does not exist. An index that can rot silently is worse than no index — a reader trusts it`);
      }
    }
  }

  // ── G15: CLAUDE.md is a shim that imports AGENTS.md ─────────────────────────────
  if (!existsSync(join(root, SHIM_FILE))) {
    add('G15', SHIM_FILE, `is missing. Claude Code reads only ${SHIM_FILE}, so without the shim a Claude session loads none of ${INSTRUCTION_FILE}'s instructions`);
  } else {
    const lines = read(root, SHIM_FILE).replace(/\r\n?/g, '\n').split('\n');
    const managed = managedLines(lines);
    if (!lines.some((l) => l.trim() === SHIM_IMPORT)) {
      add('G15', SHIM_FILE, `does not import ${INSTRUCTION_FILE} (no \`${SHIM_IMPORT}\` line). Claude Code would load none of the instructions`);
    }
    for (const [i, line] of lines.entries()) {
      const t = line.trim();
      // The import line is the shim. In MCM it sits inside its generator's managed region; BELAY's
      // shim has it bare, so it is permitted by name. Nothing else is.
      if (managed.has(i) || t === '' || t === SHIM_IMPORT || t.startsWith('<!--') || t.endsWith('-->')) continue;
      add('G15', SHIM_FILE, `line ${i + 1} carries content outside the machine-managed regions: "${t.slice(0, 70)}". ${SHIM_FILE} is a shim; put it in ${INSTRUCTION_FILE}, which every assistant reads. Content here reaches Claude only, and a copy of ${INSTRUCTION_FILE} makes Copilot and Claude load it twice`);
    }
  }

  // ── G10: the other assistant surfaces ────────────────────────────────────────
  for (const surface of ASSISTANT_SURFACES) {
    if (!existsSync(join(root, surface))) continue;
    const text = read(root, surface);
    for (const target of [...linksIn(text), ...citedPaths(text)]) {
      if (!existsSync(join(root, target.split('#')[0]))) {
        add('G10', surface, `points at \`${target}\`, which does not exist — an assistant surface left describing moved content sends every reader to a dead end`);
      }
    }
  }

  findings.sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.message.localeCompare(b.message));
  return { findings, conceptCount: concepts.length, docPathCount: docPaths.length, policyAbsent: policy.absent };
}

// ── reporting ───────────────────────────────────────────────────────────────────

function report(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify({ conceptCount: result.conceptCount, docPathCount: result.docPathCount, findings: result.findings }, null, 2));
    return;
  }
  if (result.findings.length > 0) {
    for (const f of result.findings) console.error(`[openwiki-governance] ✗ (${f.rule}) ${f.file} — ${f.message}`);
    console.error(`[openwiki-governance] ✗ ${result.findings.length} governance violation(s).`);
    return;
  }
  const classified = result.policyAbsent
    ? 'no openwiki/policy.yaml (no generator, no generated paths)'
    : `${result.docPathCount} documentation path(s) classified`;
  console.log(`[openwiki-governance] ✅ ${classified}, ${result.conceptCount} concept(s) each provably derived or authoritative, protected passages intact.`);
}

// ── selftest ────────────────────────────────────────────────────────────────────
// Proves each rule still detects its case, against scratch mini-repositories built here rather than
// against the committed fixtures — so a refactor that silently disables a check turns this red even if
// someone "fixed" a fixture to make the suite pass.

function selftest() {
  const root = mkdtempSync(join(tmpdir(), 'governance-selftest-'));
  const fails = [];

  const PASSAGE = 'A load-bearing sentence that must not be reworded.';
  const concept = (body, resource = null) => [
    '---', 'type: Gotcha', 'title: A', 'description: d.',
    ...(resource ? [`resource: ${resource}`] : []), '---',
    '# A', '', '## Anchor Heading', '', body, '',
  ].join('\n');

  const base = () => ({
    'AGENTS.md': '# Index\n\n## Knowledge\n\n- **A** → [openwiki/area/a.md](openwiki/area/a.md)\n',
    'CLAUDE.md': '<!-- a shim: every instruction lives in AGENTS.md -->\n\n@AGENTS.md\n',
    'openwiki/policy.yaml': [
      'version: 1', 'paths:',
      '  - glob: "CLAUDE.md"', '    policy: regenerate', '    actor: agent',
      '  - glob: "AGENTS.md"', '    policy: regenerate', '    actor: agent',
      '  - glob: "openwiki/**"', '    policy: regenerate', '    actor: generator',
      '  - glob: "openwiki/policy.yaml"', '    policy: never-written',
      '  - glob: "openwiki/protected.yaml"', '    policy: never-written',
      '  - glob: "openwiki/area/a.md"', '    policy: event-driven', '    actor: agent', '    events: [subject-changed]',
      '',
    ].join('\n'),
    'openwiki/protected.yaml': [
      'version: 1', 'authoritative:', '  - "area/a.md"', 'passages:',
      '  - concept: "area/a.md"', '    anchor: "Anchor Heading"', `    fingerprint: "${fingerprintOf(PASSAGE)}"`,
      '    origin: "CLAUDE.md"', '    relocatedAt: "2026-07-30"', '',
    ].join('\n'),
    'openwiki/index.md': '# Bundle\n',
    'openwiki/area/index.md': '# Area\n- [a](a.md)\n',
    'openwiki/area/a.md': concept(PASSAGE),
  });

  const scenario = (name, mutate, expect) => {
    const dir = join(root, name);
    const files = base();
    mutate(files);
    for (const [rel, content] of Object.entries(files)) {
      if (content === null) continue;
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    const rules = new Set(validate(dir).findings.map((f) => f.rule));
    if (expect === null) {
      if (rules.size > 0) fails.push(`${name}: expected a clean pass, got [${[...rules].join(',')}]`);
    } else if (!rules.has(expect)) {
      fails.push(`${name}: expected ${expect}, got [${[...rules].join(',') || 'none'}]`);
    }
  };

  scenario('clean', () => {}, null);
  scenario('g1', (f) => { f['docs/unclassified.md'] = '# Nothing classifies me\n'; }, 'G1');
  scenario('g2', (f) => { f['openwiki/policy.yaml'] = f['openwiki/policy.yaml'].replace('policy: regenerate\n    actor: agent', 'policy: sometimes\n    actor: agent'); }, 'G2');
  scenario('g3', (f) => { f['openwiki/policy.yaml'] += '  - glob: "docs/**"\n    policy: regenerate\n    actor: generator\n'; }, 'G3');
  scenario('g4', (f) => { f['openwiki/policy.yaml'] = f['openwiki/policy.yaml'].replace('    events: [subject-changed]\n', ''); }, 'G4');
  scenario('g5', (f) => { f['openwiki/area/a.md'] = concept('A load-bearing sentence that must not be rephrased.'); }, 'G5');
  scenario('g6', (f) => { f['openwiki/area/a.md'] = concept('body').replace('## Anchor Heading', '## Different Heading'); }, 'G6');
  scenario('g7', (f) => { f['openwiki/area/a.md'] = concept(PASSAGE, 'CLAUDE.md'); }, 'G7');
  scenario('g8', (f) => { f['AGENTS.md'] += '\nA paragraph of prose, which is how the file re-grows.\n'; }, 'G8');
  scenario('g9', (f) => { f['AGENTS.md'] = f['AGENTS.md'].replace('a.md](openwiki/area/a.md)', 'gone.md](openwiki/area/gone.md)'); }, 'G9');
  scenario('g16-long-line', (f) => { f['AGENTS.md'] += `\n- **A gate** — ${'a story that belongs in the runbook '.repeat(20)}— [docs](openwiki/area/a.md)\n`; }, 'G16');
  scenario('g16-total', (f) => { f['AGENTS.md'] += '\n- [An entry](openwiki/area/a.md) — short enough on its own\n'.repeat(400); }, 'G16');
  scenario('g16-long-line-in-managed-region-is-exempt', (f) => {
    f['AGENTS.md'] += `\n<!-- SPECKIT START -->\n${'x'.repeat(INSTRUCTION_LINE_MAX + 50)}\n<!-- SPECKIT END -->\n`;
  }, null);
  scenario('g10', (f) => { f['opencode.json'] = '{"instructions": ["docs/moved-away.md"]}\n'; }, 'G10');
  scenario('g15-shim-missing', (f) => { f['CLAUDE.md'] = null; }, 'G15');
  scenario('g15-no-import', (f) => { f['CLAUDE.md'] = f['CLAUDE.md'].replace('@AGENTS.md', 'see AGENTS.md'); }, 'G15');
  scenario('g15-content-in-shim', (f) => { f['CLAUDE.md'] += '\n- **A gate** → [docs/x.md](docs/x.md)\n'; }, 'G15');
  scenario('g15-managed-region-in-shim-is-exempt', (f) => {
    f['CLAUDE.md'] += '\n<!-- SPECKIT START -->\n## Spec Kit\n- a rule the tool writes\n<!-- SPECKIT END -->\n';
  }, null);
  scenario('g11-neither', (f) => {
    f['openwiki/area/b.md'] = concept('body');
    f['openwiki/area/index.md'] = '# Area\n- [a](a.md)\n- [b](b.md)\n';
  }, 'G11');
  scenario('g11-both', (f) => { f['openwiki/area/a.md'] = concept(PASSAGE, 'CLAUDE.md'); }, 'G11');
  scenario('g12', (f) => { f['openwiki/policy.yaml'] = f['openwiki/policy.yaml'].replace('  - glob: "openwiki/area/a.md"\n    policy: event-driven\n    actor: agent\n    events: [subject-changed]\n', ''); }, 'G12');
  // A list-valued actor: sessions AND a manual rebuild both write the bundle.
  // G2 validates every member; G3 still confines `generator` to openwiki/, list or not.
  const LIST_ACTOR = (f) => { f['openwiki/policy.yaml'] = f['openwiki/policy.yaml'].replace('policy: regenerate\n    actor: generator', 'policy: regenerate\n    actor: [agent, generator]'); };
  scenario('list-actor-accepted', LIST_ACTOR, null);
  scenario('g3-list-actor', (f) => { LIST_ACTOR(f); f['openwiki/policy.yaml'] += '  - glob: "docs/**"\n    policy: regenerate\n    actor: [generator]\n'; }, 'G3');
  scenario('g2-list-actor-unknown-member', (f) => { f['openwiki/policy.yaml'] = f['openwiki/policy.yaml'].replace('policy: regenerate\n    actor: generator', 'policy: regenerate\n    actor: [agent, robot]'); }, 'G2');

  // G14 — a derived page's `resource` is ONE file that no bot rewrites. Otherwise V17 could go red on
  // a change with no session there to refresh the page.
  const derivedPage = (resource) => (f) => {
    f['openwiki/area/b.md'] = concept('body', resource);
    f['openwiki/area/index.md'] = '# Area\n- [a](a.md)\n- [b](b.md)\n';
  };
  scenario('g14-clean-file-resource', (f) => { derivedPage('docs/runbooks/x.txt')(f); f['docs/runbooks/x.txt'] = 'x\n'; }, null);
  scenario('g14-directory', (f) => { derivedPage('some/dir/')(f); f['some/dir/x.txt'] = 'x\n'; }, 'G14');
  scenario('g14-env-deploy', (f) => { derivedPage('infrastructure-as-code/docker/bff/.env.deploy')(f); f['infrastructure-as-code/docker/bff/.env.deploy'] = 'A=1\n'; }, 'G14');
  scenario('g14-renovate-custom-manager', (f) => {
    derivedPage('tools/versions.txt')(f);
    f['tools/versions.txt'] = 'node 24\n';
    f['renovate.json'] = JSON.stringify({ customManagers: [{ customType: 'regex', managerFilePatterns: ['/^tools/versions\\.txt$/'] }] });
  }, 'G14');
  scenario('whitespace-only-drift', (f) => { f['openwiki/area/a.md'] = concept(`${PASSAGE}   `).replace(/\n/g, '\r\n'); }, null);
  scenario('fingerprint-corrected-together', (f) => {
    const reworded = 'A load-bearing sentence that has been deliberately corrected.';
    f['openwiki/area/a.md'] = concept(reworded);
    f['openwiki/protected.yaml'] = f['openwiki/protected.yaml'].replace(fingerprintOf(PASSAGE), fingerprintOf(reworded));
  }, null);
  scenario('managed-region-prose-is-exempt', (f) => {
    f['AGENTS.md'] += '\n<!-- SPECKIT START -->\nA paragraph the tool rewrites every run.\n<!-- SPECKIT END -->\n';
  }, null);
  // MCM's other regions are not BELAY's: no tool writes them here, so their markers exempt nothing.
  scenario('g8-nx-region-not-exempt', (f) => {
    f['AGENTS.md'] += '\n<!-- nx configuration start-->\nHand-written prose behind a marker.\n<!-- nx configuration end-->\n';
  }, 'G8');
  scenario('g8-openwiki-region-not-exempt', (f) => {
    f['AGENTS.md'] += '\n<!-- OPENWIKI:START -->\nHand-written prose behind a marker.\n<!-- OPENWIKI:END -->\n';
  }, 'G8');
  // BELAY's shape: no generator, so no policy.yaml. Absent means no generated paths — not G0, and an
  // unclassified documentation path is not G1.
  scenario('no-policy-file-is-no-generated-paths', (f) => {
    f['openwiki/policy.yaml'] = null;
    f['docs/unclassified.md'] = '# Nothing classifies me, and nothing needs to\n';
  }, null);
  scenario('fail-closed-no-manifest', (f) => { f['openwiki/protected.yaml'] = null; }, 'G0');
  scenario('fail-closed-bad-policy', (f) => { f['openwiki/policy.yaml'] = 'version: 1\npaths:\n  - glob: "unterminated\n    policy: [\n'; }, 'G0');
  scenario('fail-closed-policy-without-paths', (f) => { f['openwiki/policy.yaml'] = 'version: 1\n'; }, 'G0');

  rmSync(root, { recursive: true, force: true });

  if (fails.length > 0) {
    console.error(`✗ openwiki-governance gate --selftest FAILED:\n  ${fails.join('\n  ')}`);
    return 1;
  }
  console.log('✓ openwiki-governance gate --selftest passed (G1–G4 policy declaration, G5–G7 passage protection incl. removal and derived-concept cases, G8–G10 index and assistant surfaces, G16 instruction-file size budget (line, total, managed region exempt), G15 CLAUDE.md shim (missing, no import, content, managed region exempt), G11 concept classification, G12 authoritative-not-regenerate, G14 one human-written file per derived page, list-valued actor, whitespace-only drift tolerated, same-change fingerprint correction accepted, Spec Kit region prose exempt and MCM-only regions not, an absent policy file is no generated paths, fail-closed on a missing manifest and a broken policy)');
  return 0;
}

// ── main ────────────────────────────────────────────────────────────────────────

const { opts, error } = parseArgs(process.argv.slice(2));
if (error) {
  console.error(`[openwiki-governance] ${error}`);
  console.error(USAGE);
  process.exit(2);
}

if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

if (opts.selftest) process.exit(selftest());

if (opts.explain) {
  try {
    const policy = loadPolicy(opts.root);
    if (policy.absent) {
      console.log(`[openwiki-governance] ${opts.explain} — no openwiki/policy.yaml: there is no generator, so no path is generated and every path is written by a reviewed session`);
      process.exit(0);
    }
    const entry = resolvePolicy(policy, opts.explain);
    if (entry === null) {
      console.error(`[openwiki-governance] ${opts.explain} — NO entry classifies this path (G1)`);
      process.exit(1);
    }
    console.log(`[openwiki-governance] ${opts.explain} → policy \`${entry.policy}\`${entry.actor ? `, actor \`${entry.actor}\`` : ''} (entry \`${entry.glob}\`)`);
    if (entry.rationale) console.log(`  why: ${entry.rationale}`);
    process.exit(0);
  } catch (err) {
    console.error(`[openwiki-governance] ${err.message}`);
    process.exit(1);
  }
}

if (opts.fingerprint) {
  const { concept, anchor } = opts.fingerprint;
  const abs = join(opts.root, concept);
  if (!existsSync(abs)) {
    console.error(`[openwiki-governance] ${concept} does not exist`);
    process.exit(1);
  }
  const passage = extractPassage(readFileSync(abs, 'utf8'), anchor);
  if (passage === null) {
    console.error(`[openwiki-governance] no heading "${anchor}" in ${concept}`);
    process.exit(1);
  }
  console.log(fingerprintOf(passage));
  console.log(`  (${concept} :: ${anchor} — put this in ${MANIFEST_FILE} in the same change as the text)`);
  process.exit(0);
}

const result = validate(opts.root);
report(result, opts.json);
process.exit(result.findings.length > 0 ? 1 : 0);
