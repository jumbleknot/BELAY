#!/usr/bin/env node
// The dependency bot's policy gate (feature 011): the pin inventory, rules C1–C11 and the run verdict.
//
// WHY THIS EXISTS. MovieCollectionManager (MCM) runs the same bot, and measured that almost every
// way it fails is SILENT:
//   - a schedule window its cron never intersected, so four weekly windows did nothing;
//   - a lock-file channel whose binary was missing, so it vanished;
//   - a regex manager that matched no file, which looks exactly like one with no work;
//   - a run that exited 0 having done nothing.
// Every one of these is a fact sitting statically in renovate.json, the workflow or the tree, so a
// parser can catch it before the bot runs. The rules are contracts/renovate-config.md in
// specs/011-renovate-dependency-bot/, and the run verdict is its data-model.md "Run verdict".
//
// Usage:
//   node scripts/check-renovate-config.mjs                         # rules C1–C11 against the tree; exit 0 / 1
//   node scripts/check-renovate-config.mjs --selftest              # prove every rule can fail; exit 0 / 1
//   node scripts/check-renovate-config.mjs --print-renovate-version
//   node scripts/check-renovate-config.mjs --run-verdict <log.ndjson> [--publish-verdict]
//   node scripts/check-renovate-config.mjs --preflight | --publish-mode   # the workflow's credential and mode steps
//   node scripts/check-renovate-config.mjs --root <dir>            # another root (tests)
//
// Exit codes: 0 pass · 1 a violation, a failed run or a broken selftest · 2 bad arguments or unreadable input.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { isMain } from './lib/is-main.mjs';
import { CHECKSUM_PAIRS } from './refresh-pin-checksum.mjs';

/**
 * The bot's own version: EXACT, and managed by a custom manager in renovate.json, so the bot proposes
 * its own upgrades. That PR's guardrails validator step runs the proposed version against
 * renovate.json before anything uses it (research R1). Both workflows read it from here.
 */
export const RENOVATE_VERSION = '44.257.6';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPOSITORY = 'jumbleknot/BELAY';
const DASHBOARD_LABEL = 'status/bot-managed';
const USAGE = 'Usage: check-renovate-config.mjs [--root <dir>] | --selftest | --print-renovate-version | --run-verdict <log> [--publish-verdict] | --preflight | --publish-mode';
export const RULE_IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11'];

// ── the pin inventory (research R8, data-model.md "Managed pin") ─────────────────────────────────

// Never scanned. Prose and records are not pins. Test fixtures pin on purpose. The lock file is the
// npm manager's, by definition. `.claude/` holds agent skills, which install nothing.
const SKIP_PATH = [
  /^(specs|docs|openwiki|node_modules|\.claude|\.git)\//,
  /(^|\/)__tests__\//,
  /(^|\/)node_modules\//,
  /\.md$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /^security\/(images|sast)\/reports\//,
  /\.(png|jpe?g|gif|ico|gz|tgz|zip|woff2?)$/,
];
const COMMENT = /^\s*(#|\/\/|\*|<!--)/;
const VERSIONISH = /^(v?\d+(\.\d+)+([-+][\w.]+)?|[0-9a-f]{64})$/;
const WORKFLOW = /^\.forgejo\/workflows\/[^/]+\.ya?ml$/;
const DOCKERFILE = (f) => /Dockerfile/.test(basename(f));

function listFiles(root) {
  const top = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status === 0 && realpathSync(top.stdout.trim()) === realpathSync(root)) {
    const r = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    // --others --exclude-standard: a new, not-yet-committed file is in the change being checked.
    if (r.status === 0) return [...new Set(r.stdout.split('\0').filter(Boolean))].filter((f) => existsSync(join(root, f))).sort();
  }
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(root, abs).split(sep).join('/');
      if (statSync(abs).isDirectory()) { if (!/^(\.git|node_modules)$/.test(name)) walk(abs); } else out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

const scannable = (f) => !SKIP_PATH.some((re) => re.test(f));
const shaPairName = new Map(CHECKSUM_PAIRS.map((p) => [p.shaName, p.pin]));
const derivedPairName = (name) => name.replace(/(_PIN\.sha256|_SHA256)$/, '').toLowerCase().replace(/_/g, '-');

function linePins(file, text) {
  const pins = [];
  const add = (line, kind, name, value, lineText) => {
    const pin = { file, line, kind, name, value, text: lineText };
    if (kind === 'script-constant' && /(_SHA256|\.sha256)$/.test(name)) pin.checksumOf = shaPairName.get(name) ?? derivedPairName(name);
    pins.push(pin);
  };
  let frozen = null; // the *_PIN = Object.freeze({ … }) block we are inside, if any
  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    if (COMMENT.test(raw)) return;
    let m;
    if (WORKFLOW.test(file)) {
      if ((m = raw.match(/\buses:\s*([\w.-]+\/[\w./-]+)@([0-9a-f]{40})\b/))) add(n, 'action-sha', m[1], m[2], raw);
      if ((m = raw.match(/\bnode-version:\s*['"]?(\d+\.\d+\.\d+)['"]?/))) add(n, 'node-version', 'node', m[1], raw);
    }
    for (const d of raw.matchAll(/([\w./:-]+@sha256:[0-9a-f]{64})/g)) add(n, 'image-digest', d[1].split('@')[0], d[1], raw);
    if (/\.(m?js|cjs)$/.test(file)) {
      if (frozen && /^\s*\}\)/.test(raw)) frozen = null;
      if ((m = raw.match(/^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*_PIN)\s*=\s*Object\.freeze\(\{\s*$/))) frozen = m[1];
      else if (frozen && (m = raw.match(/^\s*(version|sha256):\s*['"]([^'"]+)['"]/))) add(n, 'script-constant', `${frozen}.${m[1]}`, m[2], raw);
      else if ((m = raw.match(/^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*?(?:_PIN|_VERSION|_TOOLCHAIN|_SHA256))\s*=\s*['"]([^'"]+)['"]/)) && VERSIONISH.test(m[2])) {
        add(n, 'script-constant', m[1], m[2], raw);
      }
    }
    if (DOCKERFILE(file) && (m = raw.match(/^\s*ARG\s+([A-Z0-9_]*VERSION)=(\S+)/))) add(n, 'dockerfile-arg', m[1], m[2], raw);
    for (const u of raw.matchAll(/https?:\/\/[^\s'"`]*?\/v?(\d+\.\d+\.\d+)\/[^\s'"`]*/g)) add(n, 'installer-url', u[0], u[1], raw);
    if ((m = raw.match(/--default-toolchain\s+(\d+\.\d+\.\d+)/))) add(n, 'toolchain-flag', 'rust', m[1], raw);
    if (file.startsWith('.specify/') && (m = raw.match(/speckit_version["']?\s*:\s*["']?([^"',\s]+)/))) add(n, 'init-option', 'speckit_version', m[1], raw);
  });
  return pins;
}

function packageJsonPins(file, text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { return []; }
  const lines = text.split('\n');
  const lineOf = (key, value) => lines.findIndex((l) => l.includes(`"${key}"`) && l.includes(`"${value}"`)) + 1;
  const pin = (kind, name, key, value) => ({ file, line: lineOf(key, value), kind, name, value, text: lines[lineOf(key, value) - 1] ?? '' });
  const pins = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, value] of Object.entries(pkg[field] ?? {})) pins.push(pin('npm', name, name, value));
  }
  for (const [name, value] of Object.entries(pkg.engines ?? {})) pins.push(pin('npm', `engines.${name}`, name, value));
  if (pkg.packageManager) pins.push(pin('package-manager', 'packageManager', 'packageManager', pkg.packageManager));
  return pins;
}

/** Every pinned version or digest in the tree (data-model.md ManagedPin.file/.line/.kind/.value/.checksumOf). */
export function detectPins(root) {
  const pins = [];
  for (const file of listFiles(root).filter(scannable)) {
    let text;
    try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    pins.push(...(basename(file) === 'package.json' ? packageJsonPins(file, text) : linePins(file, text)));
  }
  return pins.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ── exclusions (data-model.md "Exclusion") ───────────────────────────────────────────────────────

export class ConfigInputError extends Error {}

/** Parse and validate security/dependencies/unmanaged-pins.yaml. A bad entry is refused, naming it. */
export function loadExclusions(text) {
  const list = parseYaml(text) ?? [];
  if (!Array.isArray(list)) throw new ConfigInputError('unmanaged-pins.yaml must be a list of exclusions');
  return list.map((e, i) => {
    const at = `exclusion #${i + 1}${e?.file ? ` (${e.file})` : ''}`;
    for (const k of ['file', 'match', 'reason', 'addedBy']) {
      if (typeof e?.[k] !== 'string' || !e[k].trim()) throw new ConfigInputError(`${at}: ${k} is required`);
    }
    if (e.reason.trim().length < 20) throw new ConfigInputError(`${at}: reason must be at least 20 characters, so it explains something`);
    try { new RegExp(e.match); } catch (err) { throw new ConfigInputError(`${at}: match is not a valid regular expression: ${err.message}`); }
    return { file: e.file, match: e.match, reason: e.reason, addedBy: e.addedBy };
  });
}

// ── custom managers, evaluated offline ───────────────────────────────────────────────────────────

/** `/re/flags` → RegExp. A glob returns null: only the regex form can be evaluated here exactly. */
function parsePattern(s) {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(String(s));
  return m ? new RegExp(m[1], m[2].replace('g', '')) : null;
}

/** Per custom manager: the { file, line } of every currentValue / currentDigest it captures. */
function managerCaptures(config, root, files) {
  return (config.customManagers ?? []).map((mgr) => {
    const patterns = (mgr.managerFilePatterns ?? []).map(parsePattern);
    const caps = [];
    if (patterns.some((p) => p === null)) return { caps, globs: true };
    for (const file of files.filter((f) => patterns.some((p) => p.test(f)))) {
      const text = readFileSync(join(root, file), 'utf8');
      for (const src of mgr.matchStrings ?? []) {
        for (const m of text.matchAll(new RegExp(src, 'gd'))) {
          for (const g of ['currentValue', 'currentDigest']) {
            const at = m.indices?.groups?.[g];
            if (at) caps.push({ file, line: text.slice(0, at[0]).split('\n').length });
          }
        }
      }
    }
    return { caps, globs: false };
  });
}

/** Assign each pin its ManagedPin.managedBy: builtin:<manager>, custom:<index>, excluded, or null. */
export function classifyPins(pins, config, exclusions = [], root = REPO_ROOT) {
  const captures = managerCaptures(config, root, listFiles(root));
  const customOf = (p) => captures.findIndex((c) => c.caps.some((x) => x.file === p.file && x.line === p.line));
  const out = pins.map((p) => {
    let managedBy = null;
    if (p.kind === 'action-sha' || p.kind === 'node-version') managedBy = 'builtin:github-actions';
    else if (p.kind === 'npm' || p.kind === 'package-manager') managedBy = 'builtin:npm';
    else if (p.kind === 'image-digest' && DOCKERFILE(p.file) && /^\s*FROM\s/i.test(p.text)) managedBy = 'builtin:dockerfile';
    else if (customOf(p) >= 0) managedBy = `custom:${customOf(p)}`;
    else if (exclusions.some((e) => e.file === p.file && new RegExp(e.match).test(p.text))) managedBy = 'excluded';
    return { ...p, managedBy };
  });
  // A checksum is moved by its pair's post-upgrade task (research R7), so it is managed exactly when
  // its version is. C8 checks that the task exists.
  for (const p of out.filter((x) => x.checksumOf && !x.managedBy)) {
    const pair = CHECKSUM_PAIRS.find((c) => c.pin === p.checksumOf);
    const version = pair && out.find((x) => x.file === p.file && x.name === pair.versionName);
    if (version?.managedBy?.startsWith('custom:')) p.managedBy = version.managedBy;
  }
  return out;
}

// ── cron (five fields; the window and the triggers) ──────────────────────────────────────────────

function cronField(field, lo, hi) {
  const set = new Set();
  for (const part of field.split(',')) {
    const [range, stepS] = part.split('/');
    const step = stepS === undefined ? 1 : Number(stepS);
    let [a, b] = range === '*' ? [lo, hi] : range.split('-').map(Number);
    if (b === undefined) b = stepS === undefined ? a : hi;
    if (![a, b, step].every(Number.isInteger) || a < lo || b > hi || step < 1) throw new Error(`bad cron field "${field}"`);
    for (let v = a; v <= b; v += step) set.add(v);
  }
  return set;
}

/** The minutes of the week (0 = Sunday 00:00, UTC) a five-field cron fires on. */
export function cronMinutes(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`"${expr}" is not a five-field cron`);
  if (f[2] !== '*' || f[3] !== '*') throw new Error(`"${expr}": day-of-month and month must be *`);
  const mins = cronField(f[0], 0, 59);
  const hours = cronField(f[1], 0, 23);
  const days = new Set([...cronField(f[4], 0, 7)].map((d) => d % 7));
  const out = new Set();
  for (const d of days) for (const h of hours) for (const m of mins) out.add(d * 1440 + h * 60 + m);
  return out;
}

/** Does a Renovate schedule window contain at least one firing of a workflow cron? */
export function cronIntersects(windowCron, triggerCron) {
  const w = cronMinutes(windowCron);
  for (const t of cronMinutes(triggerCron)) if (w.has(t)) return true;
  return false;
}

function durationMinutes(s) {
  const m = /^(\d+)\s*(minute|hour|day|week)s?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * { minute: 1, hour: 60, day: 1440, week: 10080 }[m[2]];
}

// ── workflow helpers ─────────────────────────────────────────────────────────────────────────────

const workflowCrons = (wf) => (wf?.on?.schedule ?? []).map((s) => s.cron).filter(Boolean);
const isDaily = (cron) => String(cron).trim().split(/\s+/)[4] === '*';
function workflowSteps(wf) {
  return Object.values(wf?.jobs ?? {}).flatMap((j) => (j.steps ?? []).map((s) => ({ ...s, env: { ...(j.env ?? {}), ...(s.env ?? {}) } })));
}
function allowedCommands(wf) {
  for (const s of workflowSteps(wf)) {
    const v = s.env?.RENOVATE_ALLOWED_COMMANDS;
    if (v) { try { return JSON.parse(v).map((r) => new RegExp(r)); } catch { return []; } }
  }
  return [];
}

// ── the rules ────────────────────────────────────────────────────────────────────────────────────

const rules = (config) => config.packageRules ?? [];
const descOf = (r) => [].concat(r.description ?? []).join(' ');
const matchKeys = (r) => Object.keys(r).filter((k) => k.startsWith('match'));
const names = (r) => [...(r.matchPackageNames ?? []), ...(r.matchDepNames ?? [])].join(', ') || matchKeys(r).join(', ');
const starRule = (config) => rules(config).find((r) => JSON.stringify(r.matchPackageNames) === '["*"]' && r.minimumReleaseAge);
const covers = (r, name) => [...(r.matchPackageNames ?? []), ...(r.matchDepNames ?? [])]
  .some((n) => (parsePattern(n) ? parsePattern(n).test(name) : n === name));

/** The lockstep groups of data-model.md "Group": each one groupName, covering every member. */
export const LOCKSTEP_GROUPS = [
  { groupName: 'node toolchain', members: ['node'] },
  { groupName: 'nx', members: ['nx', '@nx/js'] },
  { groupName: 'rust toolchain', members: ['rust'] },
  { groupName: 'uv', members: ['astral-sh/uv'] },
  { groupName: 'spec kit', members: ['github/spec-kit'] },
];

// The package-manager lock files lockFileMaintenance refreshes, and what installs their toolchain.
const LOCK_TOOLCHAINS = [
  { lock: /(^|\/)pnpm-lock\.yaml$/, toolchain: /install-pnpm\.sh/, name: 'pnpm (scripts/install-pnpm.sh)' },
  { lock: /(^|\/)Cargo\.lock$/, toolchain: /rustup|sast-prepare\.mjs rust/, name: 'cargo (rustup)' },
  { lock: /(^|\/)uv\.lock$/, toolchain: /setup-uv|astral\.sh\/uv/, name: 'uv' },
  { lock: /(^|\/)package-lock\.json$/, toolchain: /setup-node/, name: 'npm (setup-node)' },
];

const RULES = {
  // C1 — the bot proposes; a human merges (FR-002, SC-003).
  C1({ config }) {
    const v = [];
    const walk = (o, path) => {
      if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${path}[${i}]`));
      if (!o || typeof o !== 'object') return;
      for (const [k, val] of Object.entries(o)) {
        const here = `${path}${path ? '.' : ''}${k}`;
        if ((k === 'automerge' || k === 'platformAutomerge') && val !== false) v.push({ file: 'renovate.json', detail: `${here} is ${JSON.stringify(val)}: nothing may merge without a human` });
        walk(val, here);
      }
    };
    walk(config, '');
    return v;
  },

  // C2 — UTC, every schedule meets a cron, the window cron lands in the window, security does not (FR-013).
  C2({ config, workflow }) {
    const v = [];
    const crons = workflowCrons(workflow);
    const wfFile = '.forgejo/workflows/renovate.yml';
    if (config.timezone !== 'UTC') v.push({ file: 'renovate.json', detail: `timezone is ${JSON.stringify(config.timezone)}: it must be "UTC", so daylight saving cannot move the window off the cron` });
    if (!config.lockFileMaintenance?.schedule) {
      v.push({ file: 'renovate.json', detail: 'lockFileMaintenance has no schedule: the config:recommended preset default ("before 4am on monday") would replace the window' });
    }
    const schedules = [['schedule', config.schedule], ['lockFileMaintenance.schedule', config.lockFileMaintenance?.schedule],
      ...rules(config).map((r, i) => [`packageRules[${i}].schedule`, r.schedule])].filter(([, s]) => s !== undefined);
    for (const [where, sched] of schedules) {
      if (!Array.isArray(sched) || !sched.length) { v.push({ file: 'renovate.json', detail: `${where} must be a non-empty list of crons` }); continue; }
      try {
        if (!sched.some((w) => crons.some((c) => cronIntersects(w, c)))) {
          v.push({ file: 'renovate.json', detail: `${where} ${JSON.stringify(sched)} meets none of the workflow's crons ${JSON.stringify(crons)}` });
        }
      } catch (e) { v.push({ file: 'renovate.json', detail: `${where}: ${e.message}` }); }
    }
    const window = config.schedule ?? [];
    const inWindow = (c) => { try { return window.some((w) => cronIntersects(w, c)); } catch { return false; } };
    const weekly = crons.filter((c) => !isDaily(c));
    const daily = crons.filter(isDaily);
    if (!weekly.length) v.push({ file: wfFile, detail: 'no weekly window cron' });
    for (const c of weekly) if (!inWindow(c)) v.push({ file: wfFile, detail: `the window cron "${c}" does not land in the window ${JSON.stringify(window)}` });
    if (!daily.length) v.push({ file: wfFile, detail: 'no daily security cron' });
    for (const c of daily) if (inWindow(c)) v.push({ file: wfFile, detail: `the security cron "${c}" falls inside the window ${JSON.stringify(window)}: routine work would run on it` });
    return v;
  },

  // C3 — security fixes outside the window, within 24 hours, with a shorter cooling-off (FR-003, FR-006, SC-001).
  C3({ config, workflow }) {
    const v = [];
    const va = config.vulnerabilityAlerts ?? {};
    if (JSON.stringify(va.schedule) !== '[]') v.push({ file: 'renovate.json', detail: 'vulnerabilityAlerts.schedule must be [] so security fixes ignore the window' });
    if (config.osvVulnerabilityAlerts !== true) v.push({ file: 'renovate.json', detail: 'osvVulnerabilityAlerts must be true: Forgejo has no advisory API of its own' });
    const age = durationMinutes(va.minimumReleaseAge);
    const routine = durationMinutes(starRule(config)?.minimumReleaseAge);
    if (age === null || routine === null || age >= routine) {
      v.push({ file: 'renovate.json', detail: `vulnerabilityAlerts.minimumReleaseAge (${va.minimumReleaseAge}) must be shorter than the routine cooling-off (${starRule(config)?.minimumReleaseAge})` });
    }
    const fires = [...new Set(workflowCrons(workflow).filter(isDaily).flatMap((c) => [...cronMinutes(c)]))].sort((a, b) => a - b);
    if (fires.length && age !== null) {
      const gaps = fires.map((m, i) => (i + 1 < fires.length ? fires[i + 1] : fires[0] + 10080) - m);
      const worst = Math.max(...gaps) + age;
      if (worst > 1440) v.push({ file: '.forgejo/workflows/renovate.yml', detail: `worst-case security delay is ${Math.round(worst / 60)}h (cooling-off + the largest gap between security crons): it must be ≤ 24h` });
    }
    return v;
  },

  // C4 — limits and the slot order lock files > base images > digest pins > the rest (FR-004, SC-004).
  C4({ config }) {
    const v = [];
    const f = 'renovate.json';
    if (!(config.prHourlyLimit >= 1)) v.push({ file: f, detail: 'prHourlyLimit must be at least 1' });
    if (!(config.prConcurrentLimit > config.prHourlyLimit)) v.push({ file: f, detail: `prConcurrentLimit (${config.prConcurrentLimit}) must exceed prHourlyLimit (${config.prHourlyLimit}), or open PRs starve the window` });
    if (config.lockFileMaintenance?.prPriority !== undefined) v.push({ file: f, detail: 'lockFileMaintenance.prPriority is ignored there: set it in a packageRules entry matching lockFileMaintenance' });
    rules(config).forEach((r, i) => {
      if (r.groupName !== undefined && r.prPriority === undefined) v.push({ file: f, detail: `packageRules[${i}] (${r.groupName}) sets groupName without prPriority, so it inherits an earlier rule's` });
    });
    const p = (pred) => rules(config).find(pred)?.prPriority;
    const lock = p((r) => (r.matchUpdateTypes ?? []).includes('lockFileMaintenance'));
    const base = p((r) => r.groupName === 'docker base images');
    const digest = p((r) => r.groupName === 'docker digest pins');
    if (!(lock > base && base > digest && digest > 0)) {
      v.push({ file: f, detail: `prPriority order must be lock files > docker base images > docker digest pins > 0; got ${lock} / ${base} / ${digest}` });
    }
    return v;
  },

  // C5 — lock-file maintenance on, and every lock file's toolchain on PATH (FR-005).
  C5({ config, workflow, files }) {
    const v = [];
    if (config.lockFileMaintenance?.enabled !== true) v.push({ file: 'renovate.json', detail: 'lockFileMaintenance.enabled must be true' });
    const runs = workflowSteps(workflow).map((s) => `${s.run ?? ''} ${s.uses ?? ''}`).join('\n');
    for (const t of LOCK_TOOLCHAINS) {
      const lock = files.find((f) => t.lock.test(f));
      if (lock && !t.toolchain.test(runs)) v.push({ file: lock, detail: `the bot job installs no ${t.name}, so its lock-file channel would die silently` });
    }
    return v;
  },

  // C6 — every pin managed or excluded; every manager and exclusion earns its place (FR-008, SC-002).
  C6({ config, root, exclusions, files }) {
    const v = [];
    (config.customManagers ?? []).forEach((m, i) => {
      if (m.fileMatch !== undefined) v.push({ file: 'renovate.json', detail: `customManagers[${i}] uses fileMatch: renovate@41+ reads managerFilePatterns and silently ignores fileMatch` });
      if ((m.managerFilePatterns ?? []).some((p) => !parsePattern(p))) v.push({ file: 'renovate.json', detail: `customManagers[${i}] has a glob managerFilePattern: use the /regex/ form, which this gate can evaluate exactly` });
    });
    managerCaptures(config, root, files).forEach((c, i) => {
      if (!c.globs && !c.caps.length) v.push({ file: 'renovate.json', detail: `customManagers[${i}] (${config.customManagers[i].depNameTemplate ?? '?'}) captures nothing: a manager that matches nothing looks like one with no work` });
    });
    const pins = classifyPins(detectPins(root), config, exclusions, root);
    for (const p of pins.filter((x) => !x.managedBy)) {
      v.push({ file: `${p.file}:${p.line}`, detail: `${p.kind} ${p.name} = ${p.value} is neither managed nor excluded (security/dependencies/unmanaged-pins.yaml)` });
    }
    for (const e of exclusions) {
      if (!pins.some((p) => p.file === e.file && new RegExp(e.match).test(p.text))) v.push({ file: e.file, detail: `exclusion /${e.match}/ is stale: it matches no detected pin` });
    }
    return v;
  },

  // C7 — every hold explained; every major approved; no approval on a patch track (FR-010, FR-011).
  C7({ config }) {
    const v = [];
    const f = 'renovate.json';
    if (config.ignoreDeps !== undefined) v.push({ file: f, detail: 'top-level ignoreDeps is a hold with nowhere to explain it: use a packageRules entry' });
    if (config.dependencyDashboardApproval === true) v.push({ file: f, detail: 'top-level dependencyDashboardApproval would hold every update, security patches included' });
    rules(config).forEach((r, i) => {
      const at = `packageRules[${i}] (${names(r)})`;
      const d = descOf(r);
      const hold = r.enabled === false || r.allowedVersions !== undefined || r.ignoreDeps !== undefined;
      if (hold) {
        if (!matchKeys(r).length) v.push({ file: f, detail: `${at} is a hold with no match* key: it would hold everything` });
        const missing = [[/Why:/, 'Why:'], [/item #\d+/i, 'item #N'], [/Re-check:/, 'Re-check:']].filter(([re]) => !re.test(d)).map(([, n]) => n);
        if (missing.length) v.push({ file: f, detail: `${at} is a hold whose description lacks ${missing.join(', ')}` });
      }
      if (r.dependencyDashboardApproval === true) {
        const missing = [[/Why:/, 'Why:'], [/Re-check:/, 'Re-check:']].filter(([re]) => !re.test(d)).map(([, n]) => n);
        if (missing.length) v.push({ file: f, detail: `${at} is an approval rule whose description lacks ${missing.join(', ')}` });
        const types = r.matchUpdateTypes;
        const onPatch = !types || types.some((t) => t === 'patch' || t === 'minor');
        if (onPatch && r.groupName !== 'spec kit') v.push({ file: f, detail: `${at} requires approval on a patch/minor track: a security patch would wait for a tick` });
      }
    });
    const majors = rules(config).some((r) => r.dependencyDashboardApproval === true && JSON.stringify(r.matchUpdateTypes) === '["major"]'
      && matchKeys(r).length === 1);
    if (!majors) v.push({ file: f, detail: 'no rule requires dashboard approval for every major ({ matchUpdateTypes: ["major"], dependencyDashboardApproval: true })' });
    return v;
  },

  // C8 — each version-and-checksum pair moves together, through an allowed post-upgrade task (FR-009).
  C8({ config, workflow }) {
    const v = [];
    const allowed = allowedCommands(workflow);
    const isRefresh = (c) => /^node scripts\/refresh-pin-checksum\.mjs [a-z-]+$/.test(c);
    rules(config).forEach((r, i) => {
      for (const c of r.postUpgradeTasks?.commands ?? []) if (!isRefresh(c)) v.push({ file: 'renovate.json', detail: `packageRules[${i}] runs "${c}": the only post-upgrade task allowed is the checksum refresh` });
    });
    for (const pair of CHECKSUM_PAIRS) {
      const cmd = `node scripts/refresh-pin-checksum.mjs ${pair.pin}`;
      const rule = rules(config).find((r) => JSON.stringify(r.postUpgradeTasks?.commands) === JSON.stringify([cmd]) && (r.postUpgradeTasks?.fileFilters ?? []).includes(pair.file));
      if (!rule) { v.push({ file: 'renovate.json', detail: `the ${pair.pin} pair has no post-upgrade task "${cmd}" with fileFilters ["${pair.file}"]` }); continue; }
      if (!allowed.some((re) => re.test(cmd))) v.push({ file: '.forgejo/workflows/renovate.yml', detail: `"${cmd}" (the ${pair.pin} pair) is not allowed by RENOVATE_ALLOWED_COMMANDS` });
    }
    return v;
  },

  // C9 — one dashboard, labelled so `backlog.mjs ready` hides it (FR-014, SC-005).
  // renovate@44 takes the dashboard as ONE object, { enabled, labels }. The older pair,
  // dependencyDashboard: true plus dependencyDashboardLabels, is a "Config migration necessary" that
  // --strict refuses (measured in PR #63's first sast run), so the legacy shape fails here too, offline.
  C9({ config }) {
    const v = [];
    const d = config.dependencyDashboard;
    if (typeof d !== 'object' || d === null || config.dependencyDashboardLabels !== undefined) {
      v.push({ file: 'renovate.json', detail: 'dependencyDashboard must be the object { enabled, labels }: the legacy true + dependencyDashboardLabels shape is a config migration renovate@44 --strict refuses' });
      return v;
    }
    if (d.enabled !== true) v.push({ file: 'renovate.json', detail: 'dependencyDashboard.enabled must be true' });
    if (JSON.stringify(d.labels) !== JSON.stringify([DASHBOARD_LABEL])) {
      v.push({ file: 'renovate.json', detail: `dependencyDashboard.labels must be ["${DASHBOARD_LABEL}"], the label backlog.mjs ready excludes` });
    }
    return v;
  },

  // C10 — lockstep groups move as one, and the cooling-off holds (FR-006, FR-007).
  C10({ config }) {
    const v = [];
    for (const g of LOCKSTEP_GROUPS) {
      const r = rules(config).find((x) => x.groupName === g.groupName);
      if (!r) { v.push({ file: 'renovate.json', detail: `lockstep group "${g.groupName}" has no rule` }); continue; }
      const missing = g.members.filter((m) => !covers(r, m));
      if (missing.length) v.push({ file: 'renovate.json', detail: `lockstep group "${g.groupName}" does not match ${missing.join(', ')}, so a bump would split it` });
    }
    if (starRule(config)?.minimumReleaseAge !== '3 days') v.push({ file: 'renovate.json', detail: 'the routine cooling-off ({ matchPackageNames: ["*"], minimumReleaseAge }) must be "3 days"' });
    const tsOptional = rules(config).some((r) => (r.matchDatasources ?? []).includes('docker') && ['pinDigest', 'digest'].every((t) => (r.matchUpdateTypes ?? []).includes(t))
      && r.minimumReleaseAgeBehaviour === 'timestamp-optional');
    if (!tsOptional) v.push({ file: 'renovate.json', detail: 'docker pinDigest/digest updates need minimumReleaseAgeBehaviour "timestamp-optional", or they stay pending for ever' });
    return v;
  },

  // C11 — no wiki page cites a file the bot rewrites (ADR-0002; the OKF gate's V17 would fail every bot PR).
  C11({ config, root, files }) {
    const v = [];
    const patterns = (config.customManagers ?? []).flatMap((m) => (m.managerFilePatterns ?? []).map(parsePattern)).filter(Boolean);
    const rewritten = (p) => /(^|\/)package\.json$/.test(p) || /(^|\/)pnpm-lock\.yaml$/.test(p) || /^\.forgejo\/workflows\//.test(p)
      || DOCKERFILE(p) || patterns.some((re) => re.test(p));
    for (const page of files.filter((f) => /^openwiki\/.*\.md$/.test(f))) {
      const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(root, page), 'utf8'));
      const res = fm && /^resource:\s*(\S+)\s*$/m.exec(fm[1]);
      if (res && rewritten(res[1])) v.push({ file: page, detail: `its resource ${res[1]} is rewritten by the bot, so every bot PR would make this page stale` });
    }
    return v;
  },
};

/** Run the rules (all, or `only`) and return sorted violations [{ rule, file, detail }]. */
export function checkRules({ config, workflow, root = REPO_ROOT, exclusions = [], only = RULE_IDS }) {
  const files = listFiles(root);
  const ctx = { config, workflow, root, exclusions, files };
  const out = [];
  for (const id of only) for (const x of RULES[id](ctx)) out.push({ rule: id, ...x });
  return out.sort((a, b) => Number(a.rule.slice(1)) - Number(b.rule.slice(1)) || a.file.localeCompare(b.file) || a.detail.localeCompare(b.detail));
}

// ── the run verdict (research R11, data-model.md "Run verdict") ──────────────────────────────────

const PASSING = new Set(['done', 'no-work', 'not-scheduled']);
const REFUSAL = /Failed to look up|\b40[13]\b|authenticat/i;

/** Judge Renovate's JSON log records: RunVerdict.result, .errors, .refusals and .repository. */
/** The lock-file-maintenance branch's result in this run, from Renovate's own record (feature 012, R3). */
function lockfileResult(records) {
  const info = records.filter((r) => r.msg === 'branches info extended').at(-1);
  return info?.branchesInformation?.find((b) => b.branchName === 'renovate/lock-file-maintenance')?.result ?? 'absent';
}

// The health report's freshness states that fail the bot's own verdict (feature 012, research R6).
const STALE_HEALTH = /^(stale|missing|unknown)\b/;

export function judgeRun(records, { repository = DEFAULT_REPOSITORY, health } = {}) {
  const fail = (reason) => ({ ok: false, reason, line: `❌ renovate run: ${reason}` });
  if (!records.length) return fail('the run produced no log');
  const error = records.find((r) => r.level >= 50);
  if (error) return fail(`ERROR: ${error.msg}${error.err?.message ? ` (${error.err.message})` : ''}`);
  const refusal = records.find((r) => r.level === 40 && REFUSAL.test(`${r.msg ?? ''} ${r.err?.message ?? ''} ${r.statusCode ?? ''}`));
  if (refusal) return fail(`a lookup or credential was refused: ${refusal.msg}`);
  const finished = records.filter((r) => /^Repository finished/i.test(r.msg ?? '') && r.repository === repository);
  if (!finished.length) return fail(`the run never reached the repository ${repository}`);
  const last = finished.at(-1);
  const result = last.result ?? last.res;
  if (!PASSING.has(result)) return fail(`the repository finished with result "${result}"`);
  const prs = records.filter((r) => /^PR created/i.test(r.msg ?? '')).length;
  // The lock-file suffix is what check-lockfile-refresh.mjs reads off this status on the window run.
  const tail = `; lock file: ${lockfileResult(records)}${health ? `; health report: ${health}` : ''}`;
  if (health && STALE_HEALTH.test(health)) {
    return { ok: false, result, reason: `the weekly health report is ${health}`, line: `❌ renovate run: ${result}, ${prs} PR(s) created${tail}` };
  }
  return { ok: true, result, line: `✅ renovate run: ${result}, ${prs} PR(s) created${tail}` };
}

/** Post the verdict as the commit status renovate/verdict: a scheduled run has no other readable record. */
export async function publishVerdict(verdict, { env = process.env, fetch: doFetch = fetch, log = console.log, error = console.error } = {}) {
  for (const k of ['GITHUB_TOKEN', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'GITHUB_SHA']) {
    if (!env[k]) { error(`[renovate] ✗ cannot publish the verdict status: ${k} is not set`); return 1; }
  }
  const state = verdict.ok ? 'success' : 'failure';
  try {
    const res = await doFetch(`${env.GITHUB_SERVER_URL}/api/v1/repos/${env.GITHUB_REPOSITORY}/statuses/${env.GITHUB_SHA}`, {
      method: 'POST',
      headers: { Authorization: `token ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, context: 'renovate/verdict', description: verdict.line.slice(0, 250),
        target_url: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_NUMBER ?? ''}` }),
    });
    if (!res.ok) { error(`[renovate] ✗ the status POST was refused: HTTP ${res.status}`); return 1; }
  } catch (e) { error(`[renovate] ✗ the status POST failed: ${e.message}`); return 1; }
  log(`[renovate] renovate/verdict → ${state}`);
  return 0;
}

function readLog(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

// ── the real tree ────────────────────────────────────────────────────────────────────────────────

export function loadTree(root = REPO_ROOT) {
  const cfgPath = join(root, 'renovate.json');
  if (!existsSync(cfgPath)) throw new ConfigInputError('no renovate.json at the repository root');
  const config = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const wfPath = join(root, '.forgejo/workflows/renovate.yml');
  const workflow = existsSync(wfPath) ? parseYaml(readFileSync(wfPath, 'utf8')) : {};
  const exPath = join(root, 'security/dependencies/unmanaged-pins.yaml');
  const exclusions = existsSync(exPath) ? loadExclusions(readFileSync(exPath, 'utf8')) : [];
  return { config, workflow, root, exclusions };
}

// ── --selftest ───────────────────────────────────────────────────────────────────────────────────
// Every rule must pass a compliant fixture and fail a broken one, before CI trusts its silence.

function selftestFixture() {
  const window = '* 5-6 * * 3';
  const root = mkdtempSync(join(tmpdir(), 'renovate-selftest-'));
  const put = (p, t) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), t); };
  put('pnpm-lock.yaml', '');
  put('scripts/tool.mjs', "export const SEMGREP_PIN = '1.185.0';\n");
  put('openwiki/x.md', '---\nresource: docs/runbooks/x.md\n---\n');
  const config = {
    timezone: 'UTC', schedule: [window], prHourlyLimit: 4, prConcurrentLimit: 6, osvVulnerabilityAlerts: true,
    vulnerabilityAlerts: { schedule: [], minimumReleaseAge: '12 hours' }, lockFileMaintenance: { enabled: true, schedule: [window] },
    dependencyDashboard: { enabled: true, labels: [DASHBOARD_LABEL] },
    customManagers: [{ customType: 'regex', managerFilePatterns: ['/^scripts\\/tool\\.mjs$/'], matchStrings: ["SEMGREP_PIN = '(?<currentValue>[\\d.]+)'"], depNameTemplate: 'semgrep', datasourceTemplate: 'pypi' }],
    packageRules: [
      { matchPackageNames: ['*'], minimumReleaseAge: '3 days' },
      { matchUpdateTypes: ['lockFileMaintenance'], prPriority: 5 },
      { matchDatasources: ['docker'], groupName: 'docker base images', prPriority: 3 },
      ...LOCKSTEP_GROUPS.map((g) => ({ matchPackageNames: g.groupName === 'nx' ? ['nx', '/^@nx\\//'] : g.members, groupName: g.groupName, prPriority: 0,
        ...(g.groupName === 'spec kit' ? { dependencyDashboardApproval: true, description: 'Why: x. Re-check: y.' } : {}) })),
      { matchDatasources: ['docker'], matchUpdateTypes: ['pinDigest', 'digest'], groupName: 'docker digest pins', prPriority: 2 },
      { matchDatasources: ['docker'], matchUpdateTypes: ['pinDigest', 'digest'], minimumReleaseAgeBehaviour: 'timestamp-optional' },
      { matchUpdateTypes: ['major'], dependencyDashboardApproval: true, description: 'Why: x. Re-check: y.' },
      { matchPackageNames: ['actions/upload-artifact'], allowedVersions: '<4', description: 'Why: x. item #1. Re-check: y.' },
      ...CHECKSUM_PAIRS.map((p) => ({ matchDepNames: [p.depName], postUpgradeTasks: { commands: [`node scripts/refresh-pin-checksum.mjs ${p.pin}`], fileFilters: [p.file] } })),
    ],
  };
  const workflow = { on: { schedule: [{ cron: '17 1,7,13,19 * * *' }, { cron: '0 5 * * 3' }] }, jobs: { r: { steps: [
    { run: 'bash scripts/install-pnpm.sh' },
    { env: { RENOVATE_ALLOWED_COMMANDS: JSON.stringify([`^node scripts/refresh-pin-checksum\\.mjs (${CHECKSUM_PAIRS.map((p) => p.pin).join('|')})$`]) } },
  ] } } };
  return { config, workflow, root, exclusions: [] };
}

const BREAKS = {
  C1: (c) => { c.config.automerge = true; },
  C2: (c) => { c.config.timezone = 'America/New_York'; },
  C3: (c) => { c.config.vulnerabilityAlerts.schedule = ['* 5-6 * * 3']; },
  C4: (c) => { c.config.prConcurrentLimit = 1; },
  C5: (c) => { c.workflow.jobs.r.steps[0].run = 'echo'; },
  C6: (c) => { c.config.customManagers = []; },
  C7: (c) => { c.config.packageRules = c.config.packageRules.filter((r) => JSON.stringify(r.matchUpdateTypes) !== '["major"]'); },
  C8: (c) => { c.config.packageRules = c.config.packageRules.filter((r) => !r.postUpgradeTasks); },
  C9: (c) => { c.config.dependencyDashboard.labels = ['renovate']; },
  C10: (c) => { c.config.packageRules = c.config.packageRules.filter((r) => r.groupName !== 'nx'); },
  C11: (c) => { writeFileSync(join(c.root, 'openwiki/x.md'), '---\nresource: package.json\n---\n'); },
};

export function renovateConfigSelftest() {
  const failures = [];
  const proved = [];
  for (const id of RULE_IDS) {
    const fx = selftestFixture();
    const clean = checkRules({ ...fx, only: [id] });
    if (clean.length) { failures.push(`${id} fails the compliant fixture: ${clean[0].detail}`); continue; }
    BREAKS[id](fx);
    if (!checkRules({ ...fx, only: [id] }).length) { failures.push(`${id} passes a broken fixture`); continue; }
    proved.push(id);
  }
  const good = judgeRun([{ level: 30, msg: 'Repository finished', repository: DEFAULT_REPOSITORY, result: 'done' }]);
  if (good.ok && !judgeRun([]).ok) proved.push('verdict'); else failures.push('the run verdict passes an empty log or fails a done run');
  return { proved, failures };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

// ── the workflow's preflight and dispatch-mode steps ─────────────────────────────────────────────
// Here rather than as `curl -H "Authorization: token $X"` in the workflow, which would put a credential
// on a process's argv (scripts/check-no-argv-secrets.mjs exists for exactly that).

/** Fail the run by name, before Renovate starts, when its credential is missing or refused (FR-015). */
export async function preflightToken({ env = process.env, fetch: doFetch = fetch } = {}) {
  if (!env.RENOVATE_TOKEN?.trim()) {
    return { ok: false, line: '❌ RENOVATE_TOKEN is empty: add the bot account\'s token as the repository Actions secret RENOVATE_TOKEN (docs/runbooks/renovate.md)' };
  }
  let status;
  try {
    const res = await doFetch(`${env.GITHUB_SERVER_URL}/api/v1/user`, { headers: { Authorization: `token ${env.RENOVATE_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
    status = res.status;
    if (res.ok) return { ok: true, line: '✅ RENOVATE_TOKEN accepted (GET /api/v1/user → 200)' };
  } catch (e) { return { ok: false, line: `❌ GET /api/v1/user failed before an answer: ${e.message}` }; }
  return { ok: false, line: `❌ GET /api/v1/user with RENOVATE_TOKEN answered HTTP ${status}: the token is expired, revoked or lacks read:user` };
}

/** On a dispatch, record the RESOLVED mode as renovate/mode: this forge shows no step's resolved expression. */
export async function publishMode({ env = process.env, fetch: doFetch = fetch, log = console.log, error = console.error } = {}) {
  const mode = env.RENOVATE_DRY_RUN ? 'DRY RUN (creates nothing)' : 'LIVE';
  log(`[renovate] resolved mode: ${mode}`);
  try {
    const res = await doFetch(`${env.GITHUB_SERVER_URL}/api/v1/repos/${env.GITHUB_REPOSITORY}/statuses/${env.GITHUB_SHA}`, {
      method: 'POST',
      headers: { Authorization: `token ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: 'renovate/mode', state: 'success', description: mode }),
    });
    if (!res.ok) { error(`[renovate] ✗ the renovate/mode POST was refused: HTTP ${res.status}`); return 1; }
  } catch (e) { error(`[renovate] ✗ the renovate/mode POST failed: ${e.message}`); return 1; }
  return 0;
}

export async function main(argv = process.argv.slice(2), { env = process.env, log = console.log, error = console.error } = {}) {
  if (argv.includes('--help')) { log(USAGE); return 0; }
  if (argv[0] === '--print-renovate-version') { log(RENOVATE_VERSION); return 0; }
  if (argv[0] === '--selftest') {
    const { proved, failures } = renovateConfigSelftest();
    for (const f of failures) error(`[renovate-config] ✗ selftest: ${f}`);
    if (failures.length) return 1;
    log(`[renovate-config] ✅ selftest: ${proved.join(', ')} each fail a broken fixture and pass a compliant one`);
    return 0;
  }
  if (argv[0] === '--preflight') {
    const r = await preflightToken({ env });
    (r.ok ? log : error)(`[renovate] ${r.line}`);
    return r.ok ? 0 : 1;
  }
  if (argv[0] === '--publish-mode') return publishMode({ env, log, error });
  if (argv[0] === '--run-verdict') {
    if (!argv[1]) { error(USAGE); return 2; }
    const h = argv.indexOf('--health-freshness');
    // A freshness file the watchdog step failed to write is `unknown`, which fails: never silently fresh.
    const health = h < 0 ? undefined : (existsSync(argv[h + 1] ?? '') ? readFileSync(argv[h + 1], 'utf8').trim() || 'unknown' : 'unknown');
    const verdict = judgeRun(readLog(argv[1]), { repository: env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY, health });
    (verdict.ok ? log : error)(`[renovate] ${verdict.line}`);
    if (argv.includes('--publish-verdict')) await publishVerdict(verdict, { env, log, error });
    return verdict.ok ? 0 : 1;
  }
  let root = REPO_ROOT;
  if (argv[0] === '--root') { if (!argv[1]) { error(USAGE); return 2; } root = resolve(argv[1]); } else if (argv.length) { error(USAGE); return 2; }
  let tree;
  try { tree = loadTree(root); } catch (e) { error(`[renovate-config] ✗ ${e.message}`); return 2; }
  const violations = checkRules(tree);
  for (const x of violations) error(`[renovate-config] ✗ ${x.rule} ${x.file}: ${x.detail}`);
  if (violations.length) { error(`[renovate-config] ❌ ${violations.length} violation(s)`); return 1; }
  const pins = classifyPins(detectPins(root), tree.config, tree.exclusions, root);
  const excluded = pins.filter((p) => p.managedBy === 'excluded').length;
  const holds = rules(tree.config).filter((r) => r.enabled === false || r.allowedVersions !== undefined || r.ignoreDeps !== undefined).length;
  log(`[renovate-config] ✅ renovate config: ${pins.length - excluded} pins managed, ${excluded} excluded, ${holds} holds justified`);
  return 0;
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => { console.error(`[renovate-config] ✗ ${e.message}`); process.exit(2); });
}
