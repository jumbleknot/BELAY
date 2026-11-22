#!/usr/bin/env node
// Spec Kit override gate (docs/runbooks/spec-kit.md).
//
// WHY THIS EXISTS. The doc-impact sweep and the required TDD checkpoint format live in a PROJECT
// OVERRIDE of Spec Kit's tasks template (.specify/templates/overrides/tasks-template.md), because
// Spec Kit owns the core template and an upgrade rewrites it with nothing to say a local edit was
// lost. But an override is a FORK: after an upgrade, /speckit-tasks keeps using the old structure
// and upstream improvements never arrive — silently. The same failure as editing core, in reverse.
// This gate makes both directions loud.
//
// It fails when:
//   - the core template no longer matches the fork point recorded on the override's first line
//     (Spec Kit changed it — re-merge, then --record);
//   - the override is missing, its header is malformed, or it no longer carries the sweep task or
//     the TDD checkpoint sample (Verify RED / Verify GREEN, constitution "TDD Checkpoint Format");
//   - setup-tasks.ps1 stops resolving through Resolve-Template and Resolve-TemplateContent, or
//     either stops checking overrides/ first — an upgrade that drops override support must fail,
//     not fall back to core;
//   - a file Spec Kit manages (listed in .specify/integrations/*.manifest.json) carries an edit
//     that is not in LOCAL_EDITS below, or a registered edit has been reverted to upstream — the
//     `--force` upgrade overwrites every managed file without warning;
//   - a PROJECT_OWNED file (one Spec Kit used to manage) is missing, lost its marker, or is
//     managed by a manifest again;
//   - an installed Spec Kit extension (EXTENSIONS below) is missing, disabled, edited or at another
//     version, lacks one of its command skills, or an unregistered extension is installed;
//   - a hook in .specify/extensions.yml (EXTENSION_HOOKS below) is lost, disabled or has its
//     `optional` flag flipped, or an unregistered hook appears — `specify extension add --force`
//     rewrites extensions.yml and drops the hooks this repository added by hand;
//   - the inventory runbook (docs/runbooks/spec-kit.md) no longer names every customisation guarded
//     here, so the one list of what this repository changed in Spec Kit cannot fall behind.
//
// The fork point is written ONLY by --record, from the core template's bytes. Never hand-type it.
// The PowerShell scripts are read as text and never executed: the runner need not have pwsh.
//
// Usage:
//   node scripts/check-speckit-overrides.mjs             # scan; exit 0 clean / 1 drift / 2 bad args
//   node scripts/check-speckit-overrides.mjs --record    # rewrite the fork point after a re-merge
//   node scripts/check-speckit-overrides.mjs --selftest  # prove each failure is detected
// Procedure: docs/runbooks/spec-kit.md#upgrading-spec-kit
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dieOnArgvError, partitionArgs, wantsHelp } from './lib/argv-contract.mjs';
import { isMain } from './lib/is-main.mjs';
import { parseExtensionsYml } from './lib/extensions-yml.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const CORE_TEMPLATE = '.specify/templates/tasks-template.md';
export const OVERRIDE_TEMPLATE = '.specify/templates/overrides/tasks-template.md';
const COMMON_PS1 = '.specify/scripts/powershell/common.ps1';
const SETUP_TASKS_PS1 = '.specify/scripts/powershell/setup-tasks.ps1';
const INIT_OPTIONS = '.specify/init-options.json';
export const SWEEP_MARKER = '**Doc-impact sweep**';
export const TDD_TEMPLATE = 'docs/templates/feature-test-tasks-template.md';
const TDD_MARKERS = ['**Verify RED**', '**Verify GREEN**'];
const INTEGRATIONS_DIR = '.specify/integrations';
export const INVENTORY = 'docs/runbooks/spec-kit.md';
const RUNBOOK = `${INVENTORY}#upgrading-spec-kit`;

/**
 * Deliberate edits to files Spec Kit owns. Every entry must also appear in the inventory runbook.
 * `marker` is a string the local version carries and upstream does not: a file that lost it, or
 * that matches its manifest hash again, has been reverted by an upgrade. Add an entry in the same
 * PR as the edit; an unregistered edit fails the gate (unregistered-edit).
 */
export const LOCAL_EDITS = [
  {
    file: '.claude/skills/speckit-tasks/SKILL.md',
    marker: '**Tests are REQUIRED**',
    why: 'makes test tasks required in the TDD checkpoint format; upstream says tests are optional, which would cancel the override',
  },
  {
    file: '.claude/skills/speckit-converge/SKILL.md',
    marker: '**Convergence tasks follow the project\'s task format**',
    why: 'appended Convergence tasks use Verify RED / Verify GREEN pairs and a doc-impact sweep; upstream writes one-line tasks that bypass the tasks-template override',
  },
];

/**
 * Files Spec Kit USED to own and no longer does, kept as project files. An upgrade deletes a file
 * that drops out of its manifest as "stale", so presence and marker are checked here; and if a
 * manifest lists the path again, the next `--force` upgrade would overwrite it, so that fails too.
 * Empty until an upgrade stops managing a file this repository has edited (move its LOCAL_EDITS
 * entry here when the gate reports registry-stale). Also holds extension config this repository
 * customises: `specify extension add` copies config files on install but lists them in no manifest.
 */
export const PROJECT_OWNED = [
  {
    file: '.specify/extensions/agent-context/agent-context-config.yml',
    marker: 'context_file: AGENTS.md',
    why: 'agent-context must write to AGENTS.md; CLAUDE.md is a shim that imports it',
  },
  {
    file: '.claude/skills/speckit-taskstoissues/SKILL.md',
    marker: 'scripts/backlog.mjs',
    why: 'fans tasks out to the Forgejo backlog through scripts/backlog.mjs; project-owned because Spec Kit 1.x has no core taskstoissues command',
  },
];

export const EXTENSIONS_YML = '.specify/extensions.yml';
export const EXTENSIONS_REGISTRY = '.specify/extensions/.registry';

/**
 * Spec Kit extensions this repository installs (`specify extension add <id>`). `version` is the one
 * `.specify/extensions/.registry` records; `commands` are the commands it registers, each of which
 * installs a skill at skillFileFor(command). Update in the same PR as an extension upgrade.
 */
export const EXTENSIONS = [
  { id: 'git', version: '1.0.5', commands: ['speckit.git.feature', 'speckit.git.validate', 'speckit.git.remote', 'speckit.git.initialize', 'speckit.git.commit'] },
  { id: 'agent-context', version: '1.0.3', commands: ['speckit.agent-context.update'] },
];

/**
 * Every hook .specify/extensions.yml must carry, matched on event + extension + command.
 * `local: true` marks a hook this repository added by hand: the installer does not write it, so a
 * reinstall drops it and the gate reports hook-lost until it is re-added.
 */
export const EXTENSION_HOOKS = [
  { event: 'before_constitution', extension: 'git', command: 'speckit.git.initialize', optional: false },
  { event: 'before_specify', extension: 'git', command: 'speckit.git.feature', optional: false },
  { event: 'before_clarify', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'before_plan', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'before_tasks', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'before_implement', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'before_checklist', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'before_analyze', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'before_taskstoissues', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_constitution', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_specify', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_clarify', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_plan', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_tasks', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_implement', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_checklist', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_analyze', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_taskstoissues', extension: 'git', command: 'speckit.git.commit', optional: true },
  { event: 'after_specify', extension: 'agent-context', command: 'speckit.agent-context.update', optional: true },
  { event: 'after_plan', extension: 'agent-context', command: 'speckit.agent-context.update', optional: true },
  // Hand-added: the git extension registers no converge hooks, so /speckit-converge would skip the
  // commit offer every other command makes. A reinstall drops these two.
  { event: 'before_converge', extension: 'git', command: 'speckit.git.commit', optional: true, local: true },
  { event: 'after_converge', extension: 'git', command: 'speckit.git.commit', optional: true, local: true },
];

/** `speckit.git.feature` → `.claude/skills/speckit-git-feature/SKILL.md`. */
export const skillFileFor = (command) => `.claude/skills/${command.replace(/\./g, '-')}/SKILL.md`;

const extensionManifestFor = (id) => `.specify/extensions/${id}/extension.yml`;

// How far back to look for the fork base. Spec Kit upgrades are rare; the core template has few
// revisions in a repository's history.
const HISTORY_DEPTH = 200;

const USAGE = `usage: node scripts/check-speckit-overrides.mjs [--record | --selftest | --help]
  (no flag)   scan: fail if the tasks-template override has drifted from Spec Kit's core template
  --record    rewrite the override's fork point from the core template (after merging its changes)
  --selftest  prove every failure condition is detected`;

const FORK_POINT = /^<!-- forked-from: (\S+) sha256=([0-9a-f]{64}) spec-kit=(\S+) -->$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const forkPointLine = (hash, specKit) => `<!-- forked-from: ${CORE_TEMPLATE} sha256=${hash} spec-kit=${specKit} -->`;

/** @returns {{corePath: string, sha256: string, specKit: string} | null} */
export function parseForkPoint(line) {
  const m = FORK_POINT.exec(String(line ?? '').trimEnd());
  if (!m || m[1] !== CORE_TEMPLATE) return null;
  return { corePath: m[1], sha256: m[2], specKit: m[3] };
}

const hasSweepTask = (text) => text.split('\n').some((l) => /^\s*- \[[ xX]\] /.test(l) && l.includes(SWEEP_MARKER));

/** The override's sample test pair must show both checkpoints and point at the format's source. */
const tddProblems = (text) => [
  ...TDD_MARKERS.filter((m) => !text.includes(m)).map((m) => `no ${m} checkpoint`),
  ...(text.includes(TDD_TEMPLATE) ? [] : [`no pointer to ${TDD_TEMPLATE}`]),
];

/** A managed file matches upstream if its bytes, LF- or CRLF-normalised, hash to the manifest. */
function matchesManifest(text, want) {
  const lf = text.replace(/\r\n/g, '\n');
  return sha256(lf) === want || sha256(lf.replace(/\n/g, '\r\n')) === want;
}

function readManifests(root) {
  const dir = join(root, INTEGRATIONS_DIR);
  if (!existsSync(dir)) return null;
  const files = new Map();
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.manifest.json')).sort()) {
    try {
      for (const [file, hash] of Object.entries(JSON.parse(readFileSync(join(dir, name), 'utf8')).files ?? {})) {
        files.set(file, hash);
      }
    } catch {
      // An unreadable manifest is Spec Kit's problem; the files it would list are simply unchecked.
    }
  }
  return files;
}

/** Managed-file edits: unregistered, reverted, or registered for a file no manifest lists. */
function localEditFailures(root, localEdits) {
  const manifest = readManifests(root);
  if (manifest === null) return [];
  const failures = [];
  const registered = new Map(localEdits.map((e) => [e.file, e]));
  for (const [file, want] of manifest) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const pristine = matchesManifest(text, want);
    const edit = registered.get(file);
    if (edit && (pristine || !text.includes(edit.marker))) {
      failures.push({
        code: 'local-edit-reverted',
        message: `${file} has lost its local edit (${edit.why}): ${pristine ? 'it matches the upstream manifest hash again' : `it no longer contains "${edit.marker}"`} — re-apply the edit from git history`,
      });
    } else if (!edit && !pristine) {
      failures.push({
        code: 'unregistered-edit',
        message: `${file} differs from its Spec Kit manifest hash but is not a registered local edit — the next \`specify integration upgrade --force\` will silently overwrite it. Register it in LOCAL_EDITS (scripts/check-speckit-overrides.mjs) and in ${INVENTORY}, or restore the upstream file`,
      });
    }
  }
  for (const { file } of localEdits) {
    if (!manifest.has(file)) {
      failures.push({
        code: 'registry-stale',
        message: `${file} is registered as a local edit but no ${INTEGRATIONS_DIR}/*.manifest.json lists it — Spec Kit no longer manages it; move the entry to PROJECT_OWNED to keep the file, or drop it from LOCAL_EDITS and ${INVENTORY}`,
      });
    }
  }
  return failures;
}

/** Project-owned former Spec Kit files: present, still carrying their marker, and unmanaged. */
function projectOwnedFailures(root, projectOwned) {
  const manifest = readManifests(root) ?? new Map();
  const failures = [];
  for (const { file, marker, why } of projectOwned) {
    const path = join(root, file);
    const text = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (text === null || !text.includes(marker)) {
      failures.push({
        code: 'project-file-lost',
        message: `${file} (${why}) ${text === null ? 'is missing' : `no longer contains "${marker}"`} — an upgrade deletes files that drop out of its manifest; restore it from git history`,
      });
    }
    if (manifest.has(file)) {
      failures.push({
        code: 'project-file-managed',
        message: `${file} is project-owned but ${INTEGRATIONS_DIR}/*.manifest.json lists it again — the next \`specify integration upgrade --force\` overwrites it. Move it back to LOCAL_EDITS, or rename the project file`,
      });
    }
  }
  return failures;
}

/**
 * A clean installed tree for the given registries, in the layout `specify extension add` writes:
 * extensions.yml, .registry (with real manifest hashes), each extension.yml and each command skill.
 * Used by --selftest and the tests. A hook may carry `enabled: false` to write a disabled entry.
 * @returns {Record<string, string>}
 */
export function extensionFixtureFiles({ extensions, hooks }) {
  if (!extensions.length && !hooks.length) return {};
  const files = {};
  const registry = { schema_version: '1.0', extensions: {} };
  for (const { id, version, commands } of extensions) {
    const manifest = `schema_version: "1.0"\nextension:\n  id: ${id}\n  version: "${version}"\n`;
    files[extensionManifestFor(id)] = manifest;
    registry.extensions[id] = {
      version,
      source: 'local',
      manifest_hash: `sha256:${sha256(manifest)}`,
      enabled: true,
      priority: 10,
      registered_commands: { claude: [...commands] },
      registered_skills: [],
    };
    for (const command of commands) files[skillFileFor(command)] = `# ${command}\n`;
  }
  files[EXTENSIONS_REGISTRY] = `${JSON.stringify(registry, null, 2)}\n`;
  const yml = ['installed:', ...extensions.map((e) => `- ${e.id}`), 'settings:', '  auto_execute_hooks: true', 'hooks:'];
  for (const event of [...new Set(hooks.map((h) => h.event))]) {
    yml.push(`  ${event}:`);
    for (const h of hooks.filter((x) => x.event === event)) {
      yml.push(`  - extension: ${h.extension}`, `    command: ${h.command}`, `    enabled: ${h.enabled !== false}`, `    optional: ${h.optional}`, '    priority: 10', '    condition: null');
    }
  }
  files[EXTENSIONS_YML] = `${yml.join('\n')}\n`;
  return files;
}

const hookKey = (h) => `${h.event} ${h.extension} ${h.command}`;

/** The registry of installed extensions, or null when it is missing or not valid JSON. */
function readInstalled(bytes) {
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes.toString('utf8')).extensions ?? {};
  } catch {
    return null;
  }
}

/** Installed extensions and extensions.yml hooks match the registries. */
function extensionFailures(root, extensions, hooks) {
  if (!extensions.length && !hooks.length) return [];
  const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel)) : null);
  const failures = [];
  const fail = (code, message) => failures.push({ code, message });
  const REINSTALL = `reinstall with \`specify extension add <id> --force\`, re-apply the hand-added hooks listed in ${INVENTORY}, then re-run this gate`;

  const registryBytes = read(EXTENSIONS_REGISTRY);
  const installed = readInstalled(registryBytes);
  if (installed === null) {
    fail('extension-lost', `${EXTENSIONS_REGISTRY} is ${registryBytes === null ? 'missing' : 'not valid JSON'} — Spec Kit has no record of the installed extensions; ${REINSTALL}`);
  } else {
    for (const { id, version, commands } of extensions) {
      const entry = installed[id];
      const manifest = read(extensionManifestFor(id));
      const problems = [];
      if (!entry) problems.push(`${EXTENSIONS_REGISTRY} does not list it`);
      else if (entry.enabled === false) problems.push(`it is disabled in ${EXTENSIONS_REGISTRY}`);
      if (manifest === null) problems.push(`${extensionManifestFor(id)} is missing`);
      const skills = commands.map(skillFileFor).filter((f) => read(f) === null);
      if (skills.length) problems.push(`its command skill(s) ${skills.join(', ')} are missing`);
      if (problems.length) {
        fail('extension-lost', `extension ${id}: ${problems.join('; ')} — ${REINSTALL}`);
        continue;
      }
      const changed = [];
      if (entry.version !== version) changed.push(`${EXTENSIONS_REGISTRY} records version ${entry.version}, EXTENSIONS expects ${version}`);
      if (String(entry.manifest_hash ?? '').replace(/^sha256:/, '') !== sha256(manifest)) {
        changed.push(`${extensionManifestFor(id)} no longer matches the manifest_hash recorded at install`);
      }
      if (changed.length) {
        fail('extension-changed', `extension ${id}: ${changed.join('; ')} — after an upgrade, update EXTENSIONS and EXTENSION_HOOKS (scripts/check-speckit-overrides.mjs) and ${INVENTORY}; otherwise restore the vendor file`);
      }
    }
    const known = new Set(extensions.map((e) => e.id));
    for (const id of Object.keys(installed).filter((x) => !known.has(x))) {
      fail('extension-unregistered', `extension ${id} is installed (${EXTENSIONS_REGISTRY}) but not registered in EXTENSIONS — register it and its hooks in scripts/check-speckit-overrides.mjs and ${INVENTORY}, or \`specify extension remove ${id}\``);
    }
  }

  const ymlBytes = read(EXTENSIONS_YML);
  let actual = null;
  let why = 'is missing';
  if (ymlBytes !== null) {
    try {
      actual = Object.entries(parseExtensionsYml(ymlBytes.toString('utf8')).hooks).flatMap(([event, list]) => list.map((h) => ({ event, ...h })));
    } catch (err) {
      why = `cannot be read (${err.message})`;
    }
  }
  if (actual === null) {
    fail('extension-lost', `${EXTENSIONS_YML} ${why} — no extension hooks will run; ${REINSTALL}`);
    return failures;
  }
  const byKey = new Map(actual.map((h) => [hookKey(h), h]));
  for (const want of hooks) {
    const got = byKey.get(hookKey(want));
    let problem = null;
    if (!got) problem = 'is missing';
    else if (!got.enabled) problem = 'is disabled';
    else if (got.optional !== want.optional) problem = `has optional: ${got.optional}, expected ${want.optional}`;
    if (problem) {
      fail('hook-lost', `${EXTENSIONS_YML} hook ${want.event} → ${want.extension} ${want.command} ${problem}${want.local ? ' (a hand-added hook: an extension reinstall drops it)' : ''} — re-add it as listed in ${INVENTORY}`);
    }
  }
  const expected = new Set(hooks.map(hookKey));
  for (const h of actual.filter((x) => !expected.has(hookKey(x)))) {
    fail('hook-unregistered', `${EXTENSIONS_YML} hook ${h.event} → ${h.extension} ${h.command} is not registered in EXTENSION_HOOKS — register it in scripts/check-speckit-overrides.mjs and ${INVENTORY}, or remove it`);
  }
  return failures;
}

/** The inventory runbook must name every customisation this gate guards. */
function inventoryFailure(root, localEdits, projectOwned, extensionHooks = []) {
  const path = join(root, INVENTORY);
  const required = [
    OVERRIDE_TEMPLATE,
    TDD_TEMPLATE,
    ...localEdits.map((e) => e.file),
    ...projectOwned.map((e) => e.file),
    ...(extensionHooks.length ? [EXTENSIONS_YML] : []),
  ];
  const text = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const missing = text === null ? required : required.filter((f) => !text.includes(f));
  if (!missing.length) return null;
  return {
    code: 'inventory-stale',
    message: text === null
      ? `${INVENTORY} is missing — it is the one list of this repository's Spec Kit customisations`
      : `${INVENTORY} does not name ${missing.join(', ')} — add each to its customisation table`,
  };
}

/**
 * setup-tasks.ps1 hands /speckit-tasks the template twice: as a path (Resolve-Template →
 * TASKS_TEMPLATE) and as composed content (Resolve-TemplateContent → TASKS_TEMPLATE_CONTENT),
 * which the skill prefers. Both resolvers must be called for tasks-template, and both must check
 * overrides/ first.
 */
const RESOLVERS = ['Resolve-Template', 'Resolve-TemplateContent'];

/**
 * Does each resolver still check overrides/ before anything else? Read as text: the body runs from
 * `function <name>` to the next top-level `function`, and the first `overrides/` reference must
 * precede every presets/extensions reference and the first `return` that yields something. A bare
 * `return $null` (template-name validation) resolves nothing, so it cannot fall back to core and is
 * not counted. A harmless upstream refactor can still trip this; the fix is a reviewed edit HERE,
 * never deleting the gate.
 */
function resolutionProblems(common, setup) {
  const problems = [];
  for (const name of RESOLVERS) {
    const call = new RegExp(`${name}\\s+-TemplateName\\s+['"]tasks-template['"]`);
    if (setup === null || !call.test(setup)) {
      problems.push(`${SETUP_TASKS_PS1} no longer resolves tasks-template through ${name}`);
    }
    const fn = common === null ? -1 : common.search(new RegExp(`^function\\s+${name}(?![\\w-])`, 'm'));
    if (fn === -1) {
      problems.push(`${COMMON_PS1} no longer defines ${name}`);
      continue;
    }
    const rest = common.slice(fn + 1);
    const next = rest.search(/^function\s+/m);
    const body = common.slice(fn, next === -1 ? undefined : fn + 1 + next);
    const at = (re) => {
      const i = body.search(re);
      return i === -1 ? Infinity : i;
    };
    const overrides = at(/overrides\//);
    const firstOther = Math.min(at(/presets/), at(/extensions/), at(/\breturn\b(?!\s+\$null\b)/));
    if (overrides === Infinity || overrides > firstOther) {
      problems.push(`${COMMON_PS1} ${name} no longer checks overrides/ first`);
    }
  }
  return problems;
}

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
}

/** The core template's diff since the revision whose bytes hash to `forkHash`, or null. */
function diffSinceForkBase(root, forkHash) {
  try {
    const revs = git(root, ['log', `-${HISTORY_DEPTH}`, '--format=%H', '--', CORE_TEMPLATE]).split('\n').filter(Boolean);
    for (const rev of revs) {
      if (sha256(git(root, ['show', `${rev}:${CORE_TEMPLATE}`], 'buffer')) === forkHash) {
        return { rev, diff: git(root, ['diff', rev, '--', CORE_TEMPLATE]) };
      }
    }
  } catch {
    // Not a git checkout, or git absent — reported as "history unavailable" by the caller.
  }
  return null;
}

/** @returns {{ok: boolean, failures: Array<{code: string, message: string}>}} */
export function checkSpeckitOverrides({
  root = REPO_ROOT,
  localEdits = LOCAL_EDITS,
  projectOwned = PROJECT_OWNED,
  extensions = EXTENSIONS,
  extensionHooks = EXTENSION_HOOKS,
} = {}) {
  const read = (rel, enc = 'utf8') => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), enc) : null);
  const failures = [];
  const fail = (code, message) => failures.push({ code, message });

  const override = read(OVERRIDE_TEMPLATE);
  const core = read(CORE_TEMPLATE, null);
  if (override === null) {
    fail('override-missing', `${OVERRIDE_TEMPLATE} is missing — task generation falls back to Spec Kit's core template, which has no doc-impact sweep`);
  } else {
    const fork = parseForkPoint(override.split('\n')[0]);
    if (!fork) {
      fail('header-invalid', `${OVERRIDE_TEMPLATE} line 1 is not a fork point (expected "${forkPointLine('<sha256>', '<version>')}")`);
    }
    if (!hasSweepTask(override)) {
      fail('sweep-missing', `${OVERRIDE_TEMPLATE} has no task line carrying ${SWEEP_MARKER}`);
    }
    const tdd = tddProblems(override);
    if (tdd.length) {
      fail('tdd-format-missing', `${OVERRIDE_TEMPLATE} has lost its TDD checkpoint sample (${tdd.join('; ')}) — generated test tasks would no longer show the constitution's Verify RED / Verify GREEN format`);
    }
    if (fork && core === null) {
      fail('core-changed', `${CORE_TEMPLATE} is missing — Spec Kit moved or removed its core tasks template`);
    } else if (fork && sha256(core) !== fork.sha256) {
      const base = diffSinceForkBase(root, fork.sha256);
      const detail = base
        ? `upstream change since the fork base (${base.rev.slice(0, 12)}):\n${base.diff || '(no textual diff)'}`
        : `fork base sha256=${fork.sha256.slice(0, 12)}… not found in git history (history unavailable — a shallow clone, or not a git checkout); compare the two files by hand`;
      fail('core-changed', `${CORE_TEMPLATE} no longer matches the fork point recorded in ${OVERRIDE_TEMPLATE} (Spec Kit changed it; recorded ${fork.sha256.slice(0, 12)}, now ${sha256(core).slice(0, 12)}).\n${detail}`);
    }
  }
  const resolution = resolutionProblems(read(COMMON_PS1), read(SETUP_TASKS_PS1));
  if (resolution.length) {
    fail('resolution-broken', `${resolution.join('; ')} — the override would be silently ignored`);
  }
  failures.push(...localEditFailures(root, localEdits));
  failures.push(...projectOwnedFailures(root, projectOwned));
  failures.push(...extensionFailures(root, extensions, extensionHooks));
  const inventory = inventoryFailure(root, localEdits, projectOwned, extensionHooks);
  if (inventory) failures.push(inventory);
  return { ok: failures.length === 0, failures };
}

/** Rewrite the override's fork point from the core template. Refuses a fork that lost the sweep. */
export function recordForkPoint({ root = REPO_ROOT } = {}) {
  const overridePath = join(root, OVERRIDE_TEMPLATE);
  if (!existsSync(overridePath)) throw new Error(`${OVERRIDE_TEMPLATE} is missing — nothing to record`);
  const text = readFileSync(overridePath, 'utf8');
  if (!hasSweepTask(text)) {
    throw new Error(`refusing to record: ${OVERRIDE_TEMPLATE} has no task line carrying ${SWEEP_MARKER} — restore it first`);
  }
  const tdd = tddProblems(text);
  if (tdd.length) {
    throw new Error(`refusing to record: ${OVERRIDE_TEMPLATE} has lost its Verify RED / Verify GREEN sample (${tdd.join('; ')}) — restore it first`);
  }
  const current = sha256(readFileSync(join(root, CORE_TEMPLATE)));
  let specKit = 'unknown';
  try {
    specKit = JSON.parse(readFileSync(join(root, INIT_OPTIONS), 'utf8')).speckit_version ?? specKit;
  } catch {
    // init-options.json is informational here; the hash is what the gate compares.
  }
  const lines = text.split('\n');
  const firstIsHeader = /^<!-- forked-from: /.test(lines[0]);
  const previous = firstIsHeader ? (/sha256=(\S+)/.exec(lines[0])?.[1] ?? null) : null;
  const body = firstIsHeader ? lines.slice(1).join('\n') : text;
  writeFileSync(overridePath, `${forkPointLine(current, specKit)}\n${body}`);
  return { previous, current };
}

const REMEDIATION = `Fix: each line above names its own fix. For core-changed, merge the core change into the override, then run node scripts/check-speckit-overrides.mjs --record (never hand-type the hash). Procedure and every failure code: ${RUNBOOK}`;

function scan(root) {
  const r = checkSpeckitOverrides({ root });
  if (r.ok) {
    const fork = parseForkPoint(readFileSync(join(root, OVERRIDE_TEMPLATE), 'utf8').split('\n')[0]);
    console.log(`✓ speckit-overrides gate passed (override present with sweep task and TDD checkpoint sample, core template matches fork point ${fork.sha256.slice(0, 12)}, override-first resolution intact, ${LOCAL_EDITS.length} registered local edit(s) in place and no unregistered ones, ${PROJECT_OWNED.length} project-owned file(s) present and unmanaged, ${EXTENSIONS.length} extension(s) and ${EXTENSION_HOOKS.length} hook(s) registered and intact, inventory ${INVENTORY} complete)`);
    return 0;
  }
  for (const f of r.failures) console.error(`[speckit-overrides] ✗ ${f.code}: ${f.message}`);
  console.error(REMEDIATION);
  return 1;
}

// The selftest needs one project-owned file to prove project-file-lost / project-file-managed are
// detected, even while the real PROJECT_OWNED list is empty.
const SELFTEST_OWNED = PROJECT_OWNED.length
  ? PROJECT_OWNED
  : [{ file: '.claude/skills/selftest-project-skill/SKILL.md', marker: 'selftest-project-marker', why: 'selftest fixture' }];

// Likewise one extension and one hook, so every extension and hook code is proven even while the
// real registries are empty.
const SELFTEST_EXTENSIONS = EXTENSIONS.length ? EXTENSIONS : [{ id: 'selftest-ext', version: '1.0.0', commands: ['speckit.selftest-ext.run'] }];
const SELFTEST_HOOKS = EXTENSION_HOOKS.length
  ? EXTENSION_HOOKS
  : [{ event: 'before_specify', extension: 'selftest-ext', command: 'speckit.selftest-ext.run', optional: false }];

function selftest() {
  const coreBody = '# Tasks\n\n- [ ] T001 Setup\n';
  const tddPair = `- [ ] T003 [US1] Test (${TDD_TEMPLATE})\n  - **Verify RED**: x\n- [ ] T004 [US1] Implement\n  - **Verify GREEN**: x\n`;
  const overrideBody = `${coreBody}- [ ] T002 ${SWEEP_MARKER} — search the docs\n${tddPair}`;
  const [edit] = LOCAL_EDITS;
  const [owned] = SELFTEST_OWNED;
  const [ext] = SELFTEST_EXTENSIONS;
  const [hook] = SELFTEST_HOOKS;
  const ymlWith = (hooks) => extensionFixtureFiles({ extensions: SELFTEST_EXTENSIONS, hooks })[EXTENSIONS_YML];
  const registryWith = (edit) => {
    const reg = JSON.parse(extensionFixtureFiles({ extensions: SELFTEST_EXTENSIONS, hooks: SELFTEST_HOOKS })[EXTENSIONS_REGISTRY]);
    edit(reg.extensions);
    return JSON.stringify(reg);
  };
  const upstream = '# upstream skill\n';
  const managed = (files) => JSON.stringify({ integration: 'claude', files });
  const registered = Object.fromEntries(LOCAL_EDITS.map((e) => [e.file, sha256(upstream)]));
  const clean = {
    [CORE_TEMPLATE]: coreBody,
    [OVERRIDE_TEMPLATE]: `${forkPointLine(sha256(coreBody), '1.4.2')}\n${overrideBody}`,
    [INVENTORY]: [OVERRIDE_TEMPLATE, TDD_TEMPLATE, EXTENSIONS_YML, ...LOCAL_EDITS.map((e) => e.file), ...SELFTEST_OWNED.map((e) => e.file)].join('\n'),
    ...extensionFixtureFiles({ extensions: SELFTEST_EXTENSIONS, hooks: SELFTEST_HOOKS }),
    [`${INTEGRATIONS_DIR}/claude.manifest.json`]: managed(registered),
    ...Object.fromEntries(LOCAL_EDITS.map((e) => [e.file, `# local skill\n${e.marker}\n`])),
    ...Object.fromEntries(SELFTEST_OWNED.map((e) => [e.file, `# project skill\n${e.marker}\n`])),
    [COMMON_PS1]: ['Resolve-Template', 'Resolve-TemplateContent']
      .map((n) => `function ${n} {\n  if ($bad) { return $null }\n  $o = Join-Path $b "overrides/$TemplateName.md"\n  if (Test-Path $o) { return $o }\n  $p = Join-Path $r ".specify/presets"\n}\n`)
      .join(''),
    [SETUP_TASKS_PS1]: "$t = Resolve-Template -TemplateName 'tasks-template' -RepoRoot $r\n$c = Resolve-TemplateContent -TemplateName 'tasks-template' -RepoRoot $r\n",
  };
  const scenarios = [
    ['clean', {}, []],
    ['override-missing', { [OVERRIDE_TEMPLATE]: null }, ['override-missing']],
    ['header-invalid', { [OVERRIDE_TEMPLATE]: overrideBody }, ['header-invalid']],
    ['sweep-missing', { [OVERRIDE_TEMPLATE]: `${forkPointLine(sha256(coreBody), '1.4.2')}\n${coreBody}${SWEEP_MARKER} in prose only\n${tddPair}` }, ['sweep-missing']],
    ['tdd-format-missing', { [OVERRIDE_TEMPLATE]: `${forkPointLine(sha256(coreBody), '1.4.2')}\n${coreBody}- [ ] T002 ${SWEEP_MARKER}\n` }, ['tdd-format-missing']],
    ['local-edit-reverted', { [edit.file]: upstream }, ['local-edit-reverted']],
    ['unregistered-edit', {
      [`${INTEGRATIONS_DIR}/claude.manifest.json`]: managed({ ...registered, '.claude/skills/x/SKILL.md': sha256('up\n') }),
      '.claude/skills/x/SKILL.md': 'edited\n',
    }, ['unregistered-edit']],
    ['registry-stale', { [`${INTEGRATIONS_DIR}/claude.manifest.json`]: managed({ ...registered, [edit.file]: undefined }) }, ['registry-stale']],
    ['inventory-stale', { [INVENTORY]: OVERRIDE_TEMPLATE }, ['inventory-stale']],
    ['project-file-lost', { [owned.file]: null }, ['project-file-lost']],
    ['project-file-managed', { [`${INTEGRATIONS_DIR}/claude.manifest.json`]: managed({ ...registered, [owned.file]: sha256(upstream) }) }, ['project-file-managed', 'unregistered-edit']],
    ['core-changed', { [CORE_TEMPLATE]: `${coreBody}- [ ] T009 upstream\n` }, ['core-changed']],
    ['setup bypasses Resolve-Template', { [SETUP_TASKS_PS1]: "$t = '.specify/templates/tasks-template.md'\n" }, ['resolution-broken']],
    ['presets before overrides/', { [COMMON_PS1]: 'function Resolve-Template {\n  $p = ".specify/presets"\n  $o = "overrides/x.md"\n}\nfunction Resolve-TemplateContent {\n  $o = "overrides/x.md"\n}\n' }, ['resolution-broken']],
    ['hook-lost', { [EXTENSIONS_YML]: ymlWith(SELFTEST_HOOKS.filter((h) => h !== hook)) }, ['hook-lost']],
    ['hook-unregistered', { [EXTENSIONS_YML]: ymlWith([...SELFTEST_HOOKS, { event: 'after_selftest', extension: ext.id, command: ext.commands[0], optional: true }]) }, ['hook-unregistered']],
    ['extension-lost', { [skillFileFor(ext.commands[0])]: null }, ['extension-lost']],
    ['extension-unregistered', { [EXTENSIONS_REGISTRY]: registryWith((e) => { e['selftest-extra'] = { ...e[ext.id] }; }) }, ['extension-unregistered']],
    ['extension-changed', { [extensionManifestFor(ext.id)]: 'edited: true\n' }, ['extension-changed']],
    ['setup bypasses Resolve-TemplateContent', { [SETUP_TASKS_PS1]: "$t = Resolve-Template -TemplateName 'tasks-template' -RepoRoot $r\n" }, ['resolution-broken']],
  ];
  let broken = 0;
  for (const [name, patch, want] of scenarios) {
    const root = mkdtempSync(join(tmpdir(), 'speckit-overrides-selftest-'));
    try {
      for (const [rel, body] of Object.entries({ ...clean, ...patch })) {
        if (body === null) continue;
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), body);
      }
      const got = checkSpeckitOverrides({ root, projectOwned: SELFTEST_OWNED, extensions: SELFTEST_EXTENSIONS, extensionHooks: SELFTEST_HOOKS }).failures.map((f) => f.code).sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        broken++;
        console.error(`✗ selftest "${name}": expected [${want}], got [${got}]`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  if (broken) return 1;
  console.log('✓ speckit-overrides gate --selftest passed (clean tree passes; override-missing, header-invalid, sweep-missing, tdd-format-missing, core-changed, every resolution-broken shape, local-edit-reverted, unregistered-edit, registry-stale, project-file-lost, project-file-managed, hook-lost, hook-unregistered, extension-lost, extension-unregistered, extension-changed and inventory-stale are each detected)');
  return 0;
}

export function main(argv, { root = REPO_ROOT } = {}) {
  if (wantsHelp(argv)) {
    console.log(USAGE);
    return 0;
  }
  let flags;
  try {
    ({ flags } = partitionArgs(argv, { accepted: ['--record', '--selftest'], usage: USAGE }));
  } catch (err) {
    dieOnArgvError(err, { hard: false });
    return 2;
  }
  if (flags.size > 1) {
    console.error(`--record and --selftest are mutually exclusive\n\n${USAGE}`);
    return 2;
  }
  if (flags.has('--selftest')) return selftest();
  if (flags.has('--record')) {
    try {
      const { previous, current } = recordForkPoint({ root });
      console.log(`recorded fork point: ${previous ? previous.slice(0, 12) : '(none)'} → ${current.slice(0, 12)} in ${OVERRIDE_TEMPLATE}`);
      return 0;
    } catch (err) {
      console.error(`[speckit-overrides] ✗ ${err.message}`);
      return 1;
    }
  }
  return scan(root);
}

if (isMain(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
