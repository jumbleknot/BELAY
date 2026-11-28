#!/usr/bin/env node
// Toolchain-consistency gate — every Node/pnpm pin in the repo must agree.
//
// WHY THIS EXISTS. Ported from MovieCollectionManager (MCM), where a pnpm 10 → 11 bump broke CI
// twice, both times from a fact that was sitting statically in the files: pnpm 11 declared
// `engines.node >= 22.13` while four CI jobs pinned `node-version: 20`, and the pnpm version was
// pinned in four places, so a bump to one left the others behind. On its first run the gate also
// caught a third instance review had missed (the production deploy job still on Node 20). This class
// of bug is invisible to review and obvious to a parser. BELAY is shared tooling, so a toolchain
// split here reaches every consumer.
//
// BELAY's pin sites: root package.json (`packageManager`, `engines.node`, the lockstep
// devDependencies), every `.forgejo/workflows/*.yml` (`node-version:`, read generically so a new
// workflow is covered without editing this file), and `.devcontainer/toolchain.Dockerfile`
// (`FROM node:`).
//
// THE RULES
//   1. Every Node pin (workflow `node-version:`, Dockerfile `FROM node:<v>`) must satisfy the repo's
//      declared floor, root package.json `engines.node`. That floor is what makes the pnpm
//      requirement checkable WITHOUT a network call or a hardcoded pnpm→node table that would rot.
//      Raise the floor when the package manager's own `engines` rises.
//   2. The pnpm version is SINGLE-SOURCED by `packageManager`. Any other place naming a pnpm version
//      (`corepack prepare pnpm@X`, a `pnpm/action-setup` `version:`) must name the SAME one. BELAY's
//      one installer, scripts/install-pnpm.sh, reads `packageManager` and names no version.
//   2b. `packageManager` itself is declared EXACTLY ONCE, in the ROOT manifest. This is the one rule
//      that does not offer "or match it": pnpm switches to the field of the WORKSPACE ROOT it operates
//      on, so a second one silently WINS in a nested workspace, and Renovate maintains it as a
//      SEPARATE dependency on its own track (measured in MCM: a nested copy drifted a whole major).
//   3. Lockstep groups are pinned EXACTLY (constitution, "Lockstep groups MUST be exact"): `nx`, every
//      `@nx/*` and `@playwright/test`, in every workspace package.json, with every `@nx/*` equal to
//      `nx` and one `@playwright/test` version. A lockfile refresh re-resolves manifest ranges with no
//      grouping, so a range lets one refresh split a lockstep set.
//   4. ONE Node major across every `FROM node:` and every `node-version:`. Renovate proposes a Node
//      major on separate tracks (base images and CI actions), and each half passes rule 1 alone.
//      A job that runs Node with NO setup-node pins nothing and would be invisible to that comparison,
//      so every Node-running job must have a pinned setup-node before its first Node use
//      (scripts/install-pnpm.sh excepted) — else it runs on the runner's implicit Node.
//   Also kept from MCM, generic to Nx: when nx.json pins `installation.version`, it must equal the
//   package.json `nx` (the wrapper decides what runs; a no-op while BELAY's nx.json has no such block).
//
// Dropped in the port (MCM-only surfaces): the Playwright container-image tag vs. pnpm-lock.yaml
// relation and its EXPECTED_NODE_MAJOR pass-through (BELAY has no app CI), and MCM's shipped-image
// Dockerfile as the Node-major reference (the most common major is the reference instead).
//
// Deliberately NOT checked: that a pin is the newest available. This gate is about internal
// agreement, which is offline-checkable and deterministic; "is there a newer Node" needs the network.
//
// Usage:
//   node scripts/check-toolchain-consistency.mjs              # scan; exit 0 clean / 1 drift
//   node scripts/check-toolchain-consistency.mjs --selftest   # prove detection; exit 0/1
//   node scripts/check-toolchain-consistency.mjs --dir <root> # scan a different repo root (tests)
//   node scripts/check-toolchain-consistency.mjs --help
//
// Exit codes: 0 clean · 1 drift found / selftest broken · 2 bad args or unreadable input.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, LineCounter } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: check-toolchain-consistency.mjs [--selftest | --dir <root> | --help]';

/** Files that may pin a Node or pnpm version. Globs are avoided — an explicit list is auditable. */
export const PINNED_FILES = [
  '.forgejo/workflows',                    // directory: every *.yml inside
  '.devcontainer/toolchain.Dockerfile',
];

/** `20` → [20,0,0] · `24.14.1` → [24,14,1] · `22.13` → [22,13,0]. Non-numeric parts are rejected. */
export function parseVersion(v) {
  const parts = String(v).trim().split('.');
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [a = 0, b = 0, c = 0] = parts.map(Number);
  return [a, b, c];
}

/** Compare two parsed versions. Returns <0, 0, >0. */
export function compareVersions(x, y) {
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * Does `pin` satisfy a `>=X[.Y[.Z]]` floor?
 *
 * Only the `>=` form is understood, on purpose: it is the only shape a toolchain floor needs, and a
 * partial semver implementation that silently mis-handles `^`/`~`/ranges would be worse than one
 * that refuses them out loud.
 */
export function satisfiesFloor(pin, floor) {
  const m = String(floor).trim().match(/^>=\s*(\d+(?:\.\d+){0,2})$/);
  if (!m) throw new Error(`engines.node must be a plain ">=X.Y.Z" floor, got ${JSON.stringify(floor)}`);
  const p = parseVersion(pin);
  const f = parseVersion(m[1]);
  if (!p) return null; // unparseable pin (e.g. `lts/*`) — reported separately, never silently passed
  return compareVersions(p, f) >= 0;
}

/**
 * A finding's location, in a form that does not depend on the operating system it was produced on.
 * `join()` emits the platform separator; the findings output is a report a human reads and pastes
 * into an issue, so a stable forward-slash form is worth more than the platform's native one.
 */
export const posixLocation = (p) => String(p).split('\\').join('/');

/** Collect every Node/pnpm pin from one file's text. */
export function collectPins(text, file) {
  const pins = [];
  const lines = text.split('\n');
  const location = posixLocation(file);
  // WHICH ACTION the current `with:` block belongs to. A bare `version:` key is a pnpm pin only under
  // `pnpm/action-setup`: in MCM, `astral-sh/setup-uv` also took `version:`, and the gate reported five
  // uv pins as five disagreeing pnpm versions — loud, and wrong. Narrowing to the enclosing step
  // asserts a RELATION rather than a coincidence of key names.
  let currentUses = null;
  lines.forEach((line, i) => {
    const at = { file: location, line: i + 1 };
    // Skip comment lines so prose describing a past pin is never read as a pin.
    if (/^\s*#/.test(line)) return;

    // A new YAML list item is a new step, so the previous step's action no longer governs. Reset
    // BEFORE reading this line's own `uses:`, because `- uses: …` is both at once.
    if (/^\s*-\s/.test(line)) currentUses = null;
    const u = line.match(/\buses:\s*([^\s#]+)/);
    if (u) currentUses = u[1];

    let m = line.match(/node-version:\s*'?"?([\w.*/-]+)'?"?/);
    if (m) pins.push({ ...at, kind: 'node', value: m[1], how: 'node-version' });

    m = line.match(/^\s*FROM\s+node:([\w.-]+)/i);
    if (m) pins.push({ ...at, kind: 'node', value: m[1].split('-')[0], how: 'FROM node:' });

    m = line.match(/corepack\s+prepare\s+pnpm@([\w.-]+)/);
    if (m) pins.push({ ...at, kind: 'pnpm', value: m[1], how: 'corepack prepare' });

    m = line.match(/^\s*(?:with:\s*\{\s*)?version:\s*'?"?(\d[\w.-]*)'?"?/);
    if (m && !/node-version/.test(line) && /(^|\/)pnpm\/action-setup/.test(currentUses ?? '')) {
      pins.push({ ...at, kind: 'pnpm', value: m[1], how: 'action-setup version' });
    }
  });
  return pins;
}

function filesToScan(root) {
  const out = [];
  for (const entry of PINNED_FILES) {
    const p = join(root, entry);
    if (!existsSync(p)) continue;
    try {
      const names = readdirSync(p).sort(); // throws ENOTDIR for a file
      for (const n of names) if (/\.ya?ml$/.test(n)) out.push(posixLocation(join(entry, n)));
    } catch {
      out.push(posixLocation(entry));
    }
  }
  return out;
}

/**
 * When nx.json pins `installation.version`, it must equal package.json `nx`.
 *
 * Measured in MCM: a `[security]` bump moved package.json `nx` and merged green while nx.json
 * `installation.version` stayed behind. With an `installation` block present the Nx wrapper resolves
 * the CLI from the gitignored `.nx/installation`, so nx.json decides what every `pnpm nx` really runs
 * and the security update silently did not take effect.
 *
 * @returns {{file:string,line:number,problem:string}[]}
 */
export function findNxPinDrift(root = REPO_ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const nxJsonPath = join(root, 'nx.json');
  if (!existsSync(nxJsonPath)) return [];
  const nxJsonText = readFileSync(nxJsonPath, 'utf8');
  const nxJson = JSON.parse(nxJsonText);

  const declared = pkg.devDependencies?.nx ?? pkg.dependencies?.nx ?? null;
  const installed = nxJson.installation?.version ?? null;

  // No `installation` block: the wrapper is not in use and package.json alone decides.
  if (installed === null) return [];
  if (declared === null) {
    return [{
      file: 'package.json', line: 1,
      problem: `nx.json pins installation.version ${installed} but package.json declares no nx dependency — the wrapper version would go unchecked`,
    }];
  }
  // A range is reported by the lockstep rule; it cannot equal a single version anyway.
  if (!/^\d+\.\d+\.\d+$/.test(declared) || declared === installed) return [];

  const line = nxJsonText.split('\n').findIndex((l) => l.includes(`"${installed}"`)) + 1;
  return [{
    file: 'nx.json', line: line || 1,
    problem:
      `nx.json installation.version ${installed} disagrees with package.json nx ${declared} — the Nx WRAPPER wins, ` +
      `so every \`pnpm nx\` (and all of CI) actually runs ${installed}. Bump both together; a package.json-only ` +
      'bump does not take effect, which has already defeated a security update.',
  }];
}

/** Dependency maps a lockstep declaration can live in. peerDependencies are ranges by design. */
const DEPENDENCY_MAPS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** True for the packages that move AS ONE UNIT and therefore must be pinned exactly. */
export const isLockstepPackage = (name) => name === 'nx' || name.startsWith('@nx/') || name === '@playwright/test';

const EXACT = /^\d+\.\d+\.\d+$/;

/**
 * The lockstep comparison itself, kept pure so the selftest can drive it without a filesystem.
 *
 * @param {{file:string,line:number,name:string,spec:string}[]} decls every lockstep declaration found
 * @param {string|null} nxVersion the root manifest's exact `nx` pin, or null when it has none
 * @returns {{file:string,line:number,problem:string}[]}
 */
export function compareLockstepDeclarations(decls, nxVersion) {
  const findings = [];
  for (const d of decls) {
    if (!EXACT.test(d.spec)) {
      findings.push({
        file: d.file, line: d.line,
        problem:
          `${d.name} is declared as ${JSON.stringify(d.spec)} — it must be pinned EXACTLY (constitution, "Lockstep ` +
          'groups MUST be exact"). A lockfile refresh re-resolves a RANGE with no grouping, so it can move this ' +
          'package alone and split its group (measured in MCM: a `^` Playwright range ran zero e2e tests).',
      });
      continue;
    }
    if (d.name.startsWith('@nx/') && nxVersion && EXACT.test(nxVersion) && d.spec !== nxVersion) {
      findings.push({
        file: d.file, line: d.line,
        problem:
          `${d.name} ${d.spec} disagrees with nx ${nxVersion} — the Nx core and its plugins are one release and ` +
          'move together. Pin every @nx/* to the nx version.',
      });
    }
  }
  const playwright = [...new Set(decls.filter((d) => d.name === '@playwright/test' && EXACT.test(d.spec)).map((d) => d.spec))];
  if (playwright.length > 1) {
    const first = decls.find((d) => d.name === '@playwright/test');
    findings.push({
      file: first.file, line: first.line,
      problem: `@playwright/test is pinned to ${playwright.join(' and ')} across manifests — one runner, one version.`,
    });
  }
  return findings;
}

/**
 * Every lockstep package must be pinned EXACTLY in every workspace manifest, and the Nx plugins must
 * equal the Nx core. Reads MANIFESTS rather than the lockfile on purpose: the lockfile shows drift
 * after it has happened; an exact manifest pin makes it impossible.
 *
 * @returns {{file:string,line:number,problem:string}[]}
 */
export function findLockstepPinDrift(root = REPO_ROOT) {
  const decls = [];
  let nxVersion = null;
  for (const rel of ['package.json', ...collectNestedManifests(root)]) {
    const text = readFileSync(join(root, rel), 'utf8');
    let pkg;
    try {
      pkg = JSON.parse(text);
    } catch {
      continue; // findNestedPackageManagerDrift already reports an unparseable manifest
    }
    const lines = text.split(/\r?\n/);
    for (const map of DEPENDENCY_MAPS) {
      for (const [name, spec] of Object.entries(pkg[map] ?? {})) {
        if (!isLockstepPackage(name)) continue;
        const idx = lines.findIndex((l) => l.includes(`"${name}"`));
        decls.push({ file: posixLocation(rel), line: idx === -1 ? 1 : idx + 1, name, spec: String(spec) });
        if (rel === 'package.json' && name === 'nx') nxVersion = String(spec);
      }
    }
  }
  return compareLockstepDeclarations(decls, nxVersion);
}

/** Directories a manifest walk must never descend into. Installed trees are full of package.json. */
const MANIFEST_SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'target', 'dist', 'build', '.nx', '.pnpm-store',
  'coverage', 'test-results', 'playwright-report', '.expo', 'android', 'ios',
]);

/** Every package.json under `root` EXCEPT the root's own, as POSIX repo-relative paths. */
export function collectNestedManifests(root) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // an unreadable directory is not a manifest claim
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (MANIFEST_SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name === 'package.json' && rel) {
        out.push(`${rel}/package.json`);
      }
    }
  };
  walk(root, '');
  return out;
}

/**
 * `packageManager` must be declared EXACTLY ONCE, in the root manifest.
 *
 * THE RULE IS "DECLARED ONCE", NOT "DECLARED CONSISTENTLY": pnpm switches to the `packageManager` of
 * the WORKSPACE ROOT it operates on, so a second field silently WINS in a nested workspace; and an
 * agreeing copy is one bot PR from drifting, which is exactly how MCM's drifted a whole major.
 *
 * @returns {{file:string,line:number,problem:string}[]}
 */
export function findNestedPackageManagerDrift(root = REPO_ROOT) {
  const rootPnpm = String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager ?? '');
  const findings = [];

  for (const rel of collectNestedManifests(root)) {
    const text = readFileSync(join(root, rel), 'utf8');
    let declared;
    try {
      declared = JSON.parse(text).packageManager;
    } catch {
      // A manifest that cannot be parsed cannot be cleared, and silence would read as "no field".
      findings.push({ file: posixLocation(rel), line: 1, problem: 'package.json is not parseable JSON — the gate cannot confirm it declares no `packageManager`' });
      continue;
    }
    if (declared === undefined) continue;

    const lineIdx = text.split(/\r?\n/).findIndex((l) => /"packageManager"\s*:/.test(l));
    findings.push({
      file: posixLocation(rel),
      line: lineIdx === -1 ? 1 : lineIdx + 1,
      problem:
        `declares its own packageManager ${JSON.stringify(declared)} — the root declares ${JSON.stringify(rootPnpm)}. ` +
        'pnpm switches to this field for any nested workspace that declares it, so this one can silently win ' +
        'there, and Renovate maintains it as a SEPARATE dependency that drifts onto its own track. Remove it — ' +
        'the root manifest is the single source.',
    });
  }
  return findings;
}

/**
 * ONE Node major across every pin. Without a shipped image to defer to (MCM used its app image), the
 * reference is the most common major, so the finding lands on the pin that left the others behind.
 *
 * @returns {{file:string,line:number,problem:string}[]}
 */
export function compareNodeMajors(nodePins) {
  const majorOf = (v) => parseVersion(String(v).split('.')[0])?.[0] ?? null;
  const known = nodePins.map((p) => ({ ...p, major: majorOf(p.value) })).filter((p) => p.major !== null);
  if (!known.length) return [];

  const counts = new Map();
  for (const p of known) counts.set(p.major, (counts.get(p.major) ?? 0) + 1);
  const reference = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const findings = [];
  for (const p of known) {
    if (p.major === reference) continue;
    findings.push({
      file: p.file,
      line: p.line,
      problem:
        `Node ${p.value} (${p.how}) is Node major ${p.major}, but the other pins are on Node major ${reference} — ` +
        'move the images and every setup-node as ONE change, never as two separate major bumps',
    });
  }
  return findings;
}

/** @returns {{file:string,line:number,problem:string}[]} */
export function findNodeMajorDrift(root = REPO_ROOT) {
  const pins = filesToScan(root).flatMap((rel) => collectPins(readFileSync(join(root, rel), 'utf8'), rel).filter((p) => p.kind === 'node'));
  return compareNodeMajors(pins);
}

/**
 * Where a job gets its Node when no setup-node runs, per runner label (the guardrails workflow header
 * names both). Used only to word the finding: the rule holds for EVERY label.
 */
export const RUNNER_IMPLICIT_NODE = {
  belay: "BELAY's runner container image (node:26-bookworm), whose Node only the host config sets",
  'belay-host': "the CI host's own Node (belay-host:host)",
};

/**
 * A `run:` line that executes Node — directly, or through pnpm/npm/npx/corepack — in COMMAND position:
 * line start, after `;` `&&` `||` `|` `(` `$(` or a backtick, after a shell keyword or `VAR=x` prefixes,
 * or as the command `scripts/ci-log-step.sh <name>` wraps. Command position matters: the word `npm` in
 * an `echo "…"` sentence is prose, and reading it as Node use is a gate failing loudly on a false
 * premise. Comment lines never count.
 */
const CMD_PREFIX = String.raw`(?:(?:if|then|else|elif|do|exec|time|!|env|timeout\s+\S+)\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*`;
const NODE_CMD = String.raw`(?:node|pnpm|npx|npm|corepack)(?=\s|$|\))`;
const RUNS_NODE = new RegExp(
  String.raw`(?:(?:^|[;&|(\x60]|\$\()\s*${CMD_PREFIX}${NODE_CMD})|(?:ci-log-step\.sh\s+\S+\s+${CMD_PREFIX}${NODE_CMD})`,
);
/** The one step allowed to run before setup-node: setup-node's `cache: pnpm` needs pnpm on PATH already. */
const PNPM_BOOTSTRAP = /\bscripts\/install-pnpm\.sh\b/;

const runsNode = (run) =>
  typeof run === 'string' && run.split('\n').some((l) => !/^\s*#/.test(l) && (RUNS_NODE.test(l) || PNPM_BOOTSTRAP.test(l)));

/**
 * Rule 4's blind spot: a job that runs Node with NO setup-node pins nothing, so the major comparison
 * never sees it, and it runs on whatever Node the runner carries. Measured in MCM: nine jobs ran on
 * the runner image's Node 22 while every pin said 26, and the gate passed, because an absent pin is
 * not a disagreeing one.
 *
 * So: every job that runs node/pnpm/npm/npx/corepack MUST have an `actions/setup-node` step with an
 * explicit `node-version:`, before the job's first Node use. The single exception is
 * scripts/install-pnpm.sh placed before it — setup-node's `cache: pnpm` runs `pnpm store path`, so
 * pnpm must already be on PATH, and once setup-node has run, pnpm's `#!/usr/bin/env node` resolves
 * to the pinned Node.
 *
 * A workflow YAML that does not parse throws: an unreadable workflow is never a silent pass.
 *
 * @returns {{file:string,line:number,problem:string}[]}
 */
export function collectImplicitNodeJobs(text, file) {
  const location = posixLocation(file);
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  if (doc.errors.length) throw new Error(`${location}: not parseable YAML — ${doc.errors[0].message.split('\n')[0]}`);
  const jobs = doc.get('jobs', true);
  if (!jobs || !Array.isArray(jobs.items)) return [];

  const findings = [];
  for (const pair of jobs.items) {
    const id = String(pair.key?.value ?? pair.key);
    const job = pair.value?.toJSON?.() ?? null;
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    const line = pair.key?.range ? lineCounter.linePos(pair.key.range[0]).line : 1;

    const setupAt = steps.findIndex((s) => /(^|\/)setup-node@/.test(String(s?.uses ?? '')));
    const firstUse = steps.findIndex((s, i) => runsNode(s?.run) && !(setupAt > i && PNPM_BOOTSTRAP.test(s.run)));
    if (firstUse === -1) continue;

    const labels = [job['runs-on']].flat().map(String);
    const implicit = labels.map((l) => RUNNER_IMPLICIT_NODE[l]).find(Boolean) ?? "the runner's own Node";
    const use = steps[firstUse].name ? `step "${steps[firstUse].name}"` : `step ${firstUse + 1}`;

    if (setupAt === -1) {
      findings.push({
        file: location, line,
        problem:
          `job \`${id}\` runs Node (${use}) with NO actions/setup-node, so it runs on ${implicit} — a Node no pin ` +
          'declares and the Node-major rule cannot see. Add the pinned setup-node step with the repo\'s ' +
          'node-version right after checkout (after scripts/install-pnpm.sh only if it uses `cache: pnpm`).',
      });
    } else if (steps[setupAt]?.with?.['node-version'] === undefined) {
      findings.push({
        file: location, line,
        problem: `job \`${id}\`'s setup-node names no \`node-version:\`, so the major it installs is not a pin the gate can check — pin it explicitly.`,
      });
    } else if (firstUse < setupAt) {
      findings.push({
        file: location, line,
        problem:
          `job \`${id}\` runs Node (${use}) BEFORE its setup-node step, so that step runs on ${implicit}. ` +
          'Move setup-node up; only scripts/install-pnpm.sh may precede it.',
      });
    }
  }
  return findings;
}

/** @returns {{file:string,line:number,problem:string}[]} */
export function findImplicitNodeJobs(root = REPO_ROOT) {
  return filesToScan(root)
    .filter((rel) => rel.startsWith('.forgejo/workflows/'))
    .flatMap((rel) => collectImplicitNodeJobs(readFileSync(join(root, rel), 'utf8'), rel));
}

/** @returns {{file:string,line:number,problem:string}[]} */
export function findDrift(root = REPO_ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const findings = [];

  const floor = pkg.engines?.node;
  if (!floor) {
    return [{
      file: 'package.json', line: 1,
      problem: 'no `engines.node` floor declared — the gate needs it to check every Node pin. Set it to the minimum the pinned packageManager requires.',
    }];
  }

  const pmMatch = String(pkg.packageManager ?? '').match(/^pnpm@(\d[\w.-]*)$/);
  if (!pmMatch) {
    return [{ file: 'package.json', line: 1, problem: `packageManager must be "pnpm@<version>", got ${JSON.stringify(pkg.packageManager)}` }];
  }
  const pnpmVersion = pmMatch[1];

  for (const rel of filesToScan(root)) {
    const text = readFileSync(join(root, rel), 'utf8');
    for (const pin of collectPins(text, rel)) {
      if (pin.kind === 'node') {
        const ok = satisfiesFloor(pin.value, floor);
        if (ok === null) {
          findings.push({ file: pin.file, line: pin.line, problem: `Node pin "${pin.value}" (${pin.how}) is not a plain version — pin an explicit one so it can be checked against engines.node (${floor})` });
        } else if (!ok) {
          findings.push({ file: pin.file, line: pin.line, problem: `Node ${pin.value} (${pin.how}) is BELOW the repo floor engines.node ${floor} — pnpm ${pnpmVersion} may refuse to run` });
        }
      } else if (pin.value !== pnpmVersion) {
        findings.push({ file: pin.file, line: pin.line, problem: `pnpm ${pin.value} (${pin.how}) disagrees with packageManager pnpm@${pnpmVersion} — single-source it (drop the explicit version, or match it)` });
      }
    }
  }

  findings.push(...findNestedPackageManagerDrift(root));
  findings.push(...findNxPinDrift(root));
  findings.push(...findLockstepPinDrift(root));
  findings.push(...findNodeMajorDrift(root));
  findings.push(...findImplicitNodeJobs(root));
  return findings;
}

/** The rule name a finding is reported under (the `<file>:<line>: <rule>: <message>` contract). */
function ruleOf(problem) {
  if (/job `/.test(problem)) return 'implicit-node';
  if (/Node major/.test(problem)) return 'node-major';
  if (/packageManager/.test(problem) && /declares its own|not parseable/.test(problem)) return 'package-manager-once';
  if (/pinned EXACTLY|disagrees with nx|one runner, one version/.test(problem)) return 'lockstep-exact';
  if (/nx\.json|WRAPPER/.test(problem)) return 'nx-wrapper';
  if (/^pnpm |packageManager must/.test(problem)) return 'pnpm-single-source';
  return 'node-floor';
}

function runScan(root) {
  let findings;
  try {
    findings = findDrift(root);
  } catch (e) {
    console.error(`[toolchain-consistency] could not run: ${e.message}`);
    process.exit(2);
  }
  if (findings.length) {
    for (const f of findings) console.error(`${f.file}:${f.line}: ${ruleOf(f.problem)}: ${f.problem}`);
    console.error(
      `[toolchain-consistency] ❌ ${findings.length} pin(s) disagree. Every Node pin must satisfy package.json ` +
      '`engines.node`, pnpm is single-sourced by the ROOT `packageManager` and declared nowhere else, nx, @nx/* ' +
      'and @playwright/test are pinned exactly with @nx/* equal to nx, every pin shares ONE Node major, and ' +
      'every Node-running job pins its Node with setup-node.',
    );
    process.exit(1);
  }
  console.log(
    '[toolchain-consistency] ✅ every Node pin satisfies engines.node; pnpm is single-sourced and declared in the ' +
    'root manifest only; every lockstep package is pinned exactly and @nx/* equals nx; nx agrees with nx.json ' +
    'installation.version; every pin shares ONE Node major; every Node-running job pins its Node with setup-node.',
  );
}

function selftest() {
  const fails = [];
  const t = (label, cond) => { if (!cond) fails.push(label); };

  t('parseVersion pads', JSON.stringify(parseVersion('22.13')) === '[22,13,0]');
  t('parseVersion rejects junk', parseVersion('lts/*') === null);
  t('20 does NOT satisfy >=22.13', satisfiesFloor('20', '>=22.13') === false);
  t('22.13 satisfies >=22.13', satisfiesFloor('22.13', '>=22.13') === true);
  t('26 (major only) satisfies >=24', satisfiesFloor('26', '>=24') === true);
  t('unparseable pin returns null', satisfiesFloor('lts/*', '>=22.13') === null);
  let threw = false;
  try { satisfiesFloor('20', '^22'); } catch { threw = true; }
  t('a non->= floor is refused loudly', threw);

  const wf = collectPins('        with: { node-version: 20, cache: pnpm }', 'x.yml');
  t('inline node-version parsed', wf.length === 1 && wf[0].kind === 'node' && wf[0].value === '20');
  const df = collectPins('FROM node:26-bookworm@sha256:' + 'a'.repeat(64), 'Dockerfile');
  t('FROM node: parsed, suffix and digest stripped', df.length === 1 && df[0].value === '26');
  const cp = collectPins('RUN corepack enable && corepack prepare pnpm@11.17.0 --activate', 'Dockerfile');
  t('corepack pnpm pin parsed', cp.length === 1 && cp[0].kind === 'pnpm' && cp[0].value === '11.17.0');
  const as = collectPins('      - uses: pnpm/action-setup@abc\n        with: { version: 10.33.0 }', 'x.yml');
  t('action-setup version parsed', as.length === 1 && as[0].kind === 'pnpm' && as[0].value === '10.33.0');
  const uv = collectPins("      - uses: astral-sh/setup-uv@abc\n        with:\n          version: '0.12.7'", 'x.yml');
  t("another action's version: input is not read as a pnpm pin", uv.length === 0);
  t('a COMMENT naming a pin is ignored', collectPins('      # pin `version: 10.33.0` explicitly, which…', 'x.yml').length === 0);

  // The lockstep pins. The case that matters is the REJECTION.
  const decl = (name, spec, file = 'package.json') => ({ file, line: 1, name, spec });
  t('exact, agreeing lockstep pins are clean', compareLockstepDeclarations([decl('nx', '24.0.6'), decl('@nx/js', '24.0.6'), decl('@playwright/test', '1.63.0')], '24.0.6').length === 0);
  t('a caret nx is REJECTED', compareLockstepDeclarations([decl('nx', '^24.0.6')], '^24.0.6').length === 1);
  t('a caret @playwright/test is REJECTED', compareLockstepDeclarations([decl('@playwright/test', '^1.59.1')], null).length === 1);
  t('a tilde @nx/* plugin is REJECTED', compareLockstepDeclarations([decl('@nx/js', '~24.0.6')], '24.0.6').length === 1);
  t('an exact @nx/* plugin that disagrees with nx is REJECTED', compareLockstepDeclarations([decl('@nx/js', '24.0.5')], '24.0.6').length === 1);
  t('two different exact @playwright/test pins are REJECTED', compareLockstepDeclarations([decl('@playwright/test', '1.63.0'), decl('@playwright/test', '1.64.0', 'a/package.json')], null).length === 1);
  t('a non-lockstep package is ignored', !isLockstepPackage('@nxlv/python') && !isLockstepPackage('yaml'));

  // The Node-major split.
  const nodePin = (file, value) => ({ file, line: 1, kind: 'node', value, how: 'x' });
  t('one Node major everywhere is clean', compareNodeMajors([nodePin('Dockerfile', '26'), nodePin('a.yml', '26.13.1')]).length === 0);
  t('a split Node major is REJECTED at the odd pin', (() => {
    const d = compareNodeMajors([nodePin('Dockerfile', '26'), nodePin('a.yml', '26.13.1'), nodePin('b.yml', '24.22.2')]);
    return d.length === 1 && d[0].file === 'b.yml';
  })());

  // The implicit-Node blind spot. The REJECTIONS are the cases worth running.
  const SN = '      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n        with: { node-version: 26.13.1 }\n';
  const job = (runsOn, steps) => `jobs:\n  j:\n    runs-on: ${runsOn}\n    steps:\n      - uses: actions/checkout@abc\n${steps}`;
  const implicit = (runsOn, steps) => collectImplicitNodeJobs(job(runsOn, steps), 'x.yml');
  t('a job running node with no setup-node is REJECTED', implicit('belay', '      - run: node scripts/gate.mjs\n').length === 1);
  t('a belay-host job running pnpm via ci-log-step with no setup-node is REJECTED', implicit('belay-host', '      - run: bash scripts/ci-log-step.sh x pnpm install --frozen-lockfile\n').length === 1);
  t('node used BEFORE setup-node is REJECTED', implicit('belay', `      - run: node scripts/gate.mjs\n${SN}`).length === 1);
  t('setup-node with no node-version is REJECTED', implicit('belay', '      - uses: actions/setup-node@abc\n      - run: node x.mjs\n').length === 1);
  t('install-pnpm.sh before setup-node is allowed', implicit('belay', `      - run: bash scripts/install-pnpm.sh\n${SN}      - run: pnpm install\n`).length === 0);
  t('install-pnpm.sh with no setup-node at all is REJECTED', implicit('belay', '      - run: bash scripts/install-pnpm.sh\n').length === 1);
  t('setup-node first is clean', implicit('belay', `${SN}      - run: node scripts/gate.mjs\n`).length === 0);
  t('a job that never runs Node needs no setup-node', implicit('belay-host', '      - run: echo hi\n      - run: docker run node:26 true\n').length === 0);
  t('`npm` in an echo sentence is prose, not Node use', implicit('belay', '      - run: |\n          echo "and npm, which the step below runs"\n').length === 0);
  t('node inside $( ) and after && is Node use', implicit('belay', '      - run: X=$(node -p 1) && true\n').length === 1 && implicit('belay', '      - run: true && pnpm -v\n').length === 1);
  let yamlThrew = false;
  try { collectImplicitNodeJobs('jobs:\n  a: [unclosed\n', 'x.yml'); } catch { yamlThrew = true; }
  t('an unparseable workflow throws rather than passing', yamlThrew);

  if (fails.length) {
    console.error('[toolchain-consistency --selftest] ❌ FAILED:\n  - ' + fails.join('\n  - '));
    process.exit(1);
  }
  console.log('[toolchain-consistency --selftest] ✅ floor comparison, pin extraction, comment immunity, lockstep exact-pin rejection, Node-major split rejection, implicit-Node job rejection.');
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

// Guarded so importing the module (as the tests do) never runs the scan: in MCM this block once ran
// at import, and the day the repo drifted the scan called process.exit(1) DURING IMPORT, collapsing
// the gate's own suite exactly when the gate fired.
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

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
