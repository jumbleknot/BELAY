// Guards scripts/check-toolchain-consistency.mjs.
//
// Ported from MovieCollectionManager, where the gate exists because a pnpm 10 → 11 bump broke CI
// twice on facts that were sitting statically in the files (a Node pin below pnpm's `engines`, and a
// pnpm version pinned in four places). These tests pin the exact shapes that broke, so a refactor of
// the parser cannot quietly stop seeing them. Trimmed to the rules BELAY keeps (research R2 of
// specs/005-guardrail-gate-ports): the Playwright-image relation and MCM's shipped-image pin site are
// gone, because BELAY has neither.
//
// Runs in CI under `pnpm nx run scripts:test`: offline, token-free, node built-ins only. Every drift
// case runs against a throwaway root built in a temp dir; the real-tree cases read this checkout.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(HERE, '..', 'check-toolchain-consistency.mjs');
const REAL = resolve(HERE, '..', '..');

// Imported per-case, not at module scope: a static import of a not-yet-existing module throws at
// LOAD time and collapses every case in this file into one opaque failure, hiding what RED proves.
const gate = () => import('../check-toolchain-consistency.mjs');

const runGate = (...args) => spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });

// Every throwaway root is removed when the file finishes.
const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempRoot = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); made.push(d); return d; };

/** Build a throwaway repo root with the given files. */
function repo({ pkg, workflows = {}, dockerfiles = {}, nxJson = null, manifests = {}, raw = {} }) {
  const root = tempRoot('toolchain-');
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  if (nxJson) writeFileSync(join(root, 'nx.json'), JSON.stringify(nxJson, null, 2));
  mkdirSync(join(root, '.forgejo', 'workflows'), { recursive: true });
  for (const [n, body] of Object.entries(workflows)) writeFileSync(join(root, '.forgejo', 'workflows', n), body);
  for (const [rel, body] of Object.entries({ ...dockerfiles, ...raw })) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  // Nested package.json manifests. Serialised rather than taken as text: the cases that matter are
  // all about a KEY being present, which an object expresses exactly.
  for (const [rel, body] of Object.entries(manifests)) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), JSON.stringify(body, null, 2));
  }
  return root;
}

const PKG = { packageManager: 'pnpm@12.21.0', engines: { node: '>=24' } };
const TOOLCHAIN = '.devcontainer/toolchain.Dockerfile';
const SETUP_NODE = (v = '26.13.1') =>
  `      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7\n        with:\n          node-version: ${v}\n`;
const wfJob = (runsOn, steps) => `on: push\njobs:\n  gate:\n    runs-on: ${runsOn}\n    steps:\n      - uses: actions/checkout@abc\n${steps}`;

// --- version comparison ---------------------------------------------------------------------------

test('versions parse and pad, junk is rejected', async () => {
  const { parseVersion, compareVersions } = await gate();
  assert.deepEqual(parseVersion('22.13'), [22, 13, 0]);
  assert.deepEqual(parseVersion('24.14.1'), [24, 14, 1]);
  assert.equal(parseVersion('lts/*'), null);
  assert.ok(compareVersions([24, 0, 0], [22, 13, 0]) > 0);
});

test('a pin below the floor does not satisfy it; at or above does', async () => {
  const { satisfiesFloor } = await gate();
  assert.equal(satisfiesFloor('20', '>=22.13'), false);
  assert.equal(satisfiesFloor('22.12', '>=22.13'), false);
  assert.equal(satisfiesFloor('22.13', '>=22.13'), true);
  assert.equal(satisfiesFloor('26', '>=24'), true);
});

test('a floor form the parser does not understand throws rather than guessing', async () => {
  // A half-implemented semver that silently mis-reads `^22` would be worse than refusing it.
  const { satisfiesFloor } = await gate();
  assert.throws(() => satisfiesFloor('24', '^22'), /plain ">=/);
});

// --- pin extraction --------------------------------------------------------------------------------

test('every pin shape BELAY uses (and the ones MCM measured) is recognised', async () => {
  const { collectPins } = await gate();
  const cases = [
    ['        with: { node-version: 20, cache: pnpm }', 'node', '20'],
    ['          node-version: 26.13.1', 'node', '26.13.1'],
    ['FROM node:24.14.1-alpine3.23 AS builder', 'node', '24.14.1'],
    // The toolchain image's real shape: a major-only tag with a digest.
    ['FROM node:26-bookworm@sha256:' + 'b'.repeat(64), 'node', '26'],
    ['RUN corepack enable && corepack prepare pnpm@11.17.0 --activate', 'pnpm', '11.17.0'],
    // A `version:` is a pnpm pin only when the enclosing step IS pnpm/action-setup.
    ['      - uses: pnpm/action-setup@abc\n        with: { version: 10.33.0 }', 'pnpm', '10.33.0'],
  ];
  for (const [line, kind, value] of cases) {
    const pins = collectPins(line, 'f');
    assert.equal(pins.length, 1, `no pin found in: ${line}`);
    assert.equal(pins[0].kind, kind, line);
    assert.equal(pins[0].value, value, line);
  }
});

test('a `version:` input belonging to ANOTHER action is not read as a pnpm pin', async () => {
  const { collectPins } = await gate();
  assert.deepEqual(collectPins("      - uses: astral-sh/setup-uv@abc\n        with:\n          version: '0.12.7'", 'f'), []);
  const pnpm = collectPins('      - uses: pnpm/action-setup@abc\n        with: { version: 10.33.0 }', 'f');
  assert.equal(pnpm.length, 1, 'the narrowing must not simply switch the pnpm check off');
});

test('a COMMENT mentioning a pin is not treated as one', async () => {
  const { collectPins } = await gate();
  assert.deepEqual(collectPins('      # pin `version: 10.33.0` explicitly, which made it DUAL-sourced', 'f'), []);
  assert.deepEqual(collectPins('# FROM node:20 was the old base', 'f'), []);
});

test('a backslash-separated location is emitted with forward slashes', async () => {
  const { posixLocation, collectPins } = await gate();
  assert.equal(posixLocation('.forgejo\\workflows\\ci.yml'), '.forgejo/workflows/ci.yml');
  for (const f of collectPins('    node-version: 18.0.0\n', '.forgejo\\workflows\\x.yml')) {
    assert.doesNotMatch(f.file, /\\/);
  }
});

// --- floor, pnpm single source --------------------------------------------------------------------

test('a Node pin below the engines.node floor is caught, naming the file and line', async () => {
  const { findDrift } = await gate();
  const root = repo({ pkg: PKG, workflows: { 'ci.yml': 'jobs:\n  a:\n    steps:\n      - with: { node-version: 22, cache: pnpm }\n' } });
  const d = findDrift(root);
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.match(d[0].problem, /BELOW the repo floor/);
  assert.equal(d[0].file, '.forgejo/workflows/ci.yml');
  assert.equal(d[0].line, 4);
});

test('a pnpm version named outside packageManager that disagrees is caught', async () => {
  const { findDrift } = await gate();
  const root = repo({ pkg: PKG, dockerfiles: { [TOOLCHAIN]: 'FROM node:26-bookworm\nRUN corepack prepare pnpm@10.33.0 --activate\n' } });
  const d = findDrift(root);
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.equal(d[0].file, TOOLCHAIN);
  assert.match(d[0].problem, /disagrees with packageManager/);
});

test('a pnpm/action-setup version that disagrees is caught', async () => {
  const { findDrift } = await gate();
  const root = repo({ pkg: PKG, workflows: { 'x.yml': 'jobs:\n  a:\n    steps:\n      - uses: pnpm/action-setup@abc\n        with: { version: 11.0.0 }\n' } });
  assert.ok(findDrift(root).some((f) => /pnpm 11\.0\.0 .*disagrees with packageManager/.test(f.problem)));
});

test('an agreeing repo — several workflows and the toolchain image — is clean', async () => {
  const { findDrift } = await gate();
  const root = repo({
    pkg: PKG,
    workflows: {
      'guardrails.yml': wfJob('belay', `${SETUP_NODE()}      - run: node scripts/a.mjs\n`),
      'another.yml': wfJob('belay-host', `${SETUP_NODE()}      - run: pnpm install\n`),
      'no-node.yml': wfJob('belay-host', '      - run: docker version\n'),
    },
    dockerfiles: { [TOOLCHAIN]: 'FROM node:26-bookworm@sha256:' + 'c'.repeat(64) + '\n' },
  });
  assert.deepEqual(findDrift(root), []);
});

test('action-setup with NO version reads packageManager and always passes', async () => {
  const { findDrift } = await gate();
  const root = repo({ pkg: PKG, workflows: { 'ci.yml': 'jobs:\n  a:\n    steps:\n      - uses: pnpm/action-setup@abc\n' } });
  assert.deepEqual(findDrift(root), []);
});

test('a missing engines.node floor fails loudly rather than passing vacuously', async () => {
  const { findDrift } = await gate();
  const d = findDrift(repo({ pkg: { packageManager: 'pnpm@12.21.0' } }));
  assert.equal(d.length, 1);
  assert.match(d[0].problem, /engines\.node/);
});

test('an unparseable Node pin is reported, never silently accepted', async () => {
  const { findDrift } = await gate();
  const root = repo({ pkg: PKG, workflows: { 'ci.yml': 'jobs:\n  a:\n    steps:\n      - with: { node-version: lts/*, cache: pnpm }\n' } });
  const d = findDrift(root);
  assert.equal(d.length, 1);
  assert.match(d[0].problem, /not a plain version/);
});

// --- packageManager declared once, at the root ------------------------------------------------------

test('a nested manifest declaring its own packageManager is caught, naming both versions', async () => {
  const { findDrift } = await gate();
  const root = repo({ pkg: PKG, manifests: { 'packages/app/package.json': { name: 'app', packageManager: 'pnpm@10.34.5' } } });
  const d = findDrift(root);
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.equal(d[0].file, 'packages/app/package.json');
  assert.ok(d[0].line > 1, 'the finding must point at the field, not line 1');
  assert.match(d[0].problem, /10\.34\.5/);
  assert.match(d[0].problem, /12\.21\.0/);
});

test('an AGREEING nested packageManager is still a finding — the rule is declared ONCE', async () => {
  const { findDrift } = await gate();
  const root = repo({ pkg: PKG, manifests: { 'tools/x/package.json': { name: 'x', packageManager: 'pnpm@12.21.0' } } });
  const d = findDrift(root);
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.match(d[0].problem, /remove it/i);
});

test('a nested manifest without the field, and the root itself, are clean', async () => {
  const { findDrift } = await gate();
  assert.deepEqual(findDrift(repo({ pkg: PKG, manifests: { 'packages/ds/package.json': { name: 'ds' } } })), []);
  assert.deepEqual(findDrift(repo({ pkg: PKG })), []);
});

test('installed trees (node_modules) are never walked for manifests', async () => {
  const { findDrift } = await gate();
  const root = repo({ pkg: PKG, manifests: { 'node_modules/dep/package.json': { packageManager: 'pnpm@9.0.0' } } });
  assert.deepEqual(findDrift(root), []);
});

// --- lockstep groups pinned exactly (constitution "Lockstep groups MUST be exact") --------------------

test('a range on nx is rejected', async () => {
  const { findDrift } = await gate();
  const d = findDrift(repo({ pkg: { ...PKG, devDependencies: { nx: '^24.0.6' } } }));
  assert.ok(d.some((f) => f.file === 'package.json' && /nx is declared as "\^24\.0\.6".*pinned EXACTLY/.test(f.problem)), JSON.stringify(d));
});

test('a range on an @nx/* plugin, and an exact one that disagrees with nx, are both rejected', async () => {
  const { findLockstepPinDrift } = await gate();
  const root = repo({ pkg: { ...PKG, devDependencies: { nx: '24.0.6', '@nx/js': '24.0.5', '@nx/workspace': '~24.0.6' } } });
  const d = findLockstepPinDrift(root);
  assert.equal(d.length, 2, JSON.stringify(d));
  assert.ok(d.some((f) => /@nx\/js 24\.0\.5 disagrees with nx 24\.0\.6/.test(f.problem)));
  assert.ok(d.some((f) => /@nx\/workspace .*pinned EXACTLY/.test(f.problem)));
});

test('a range on @playwright/test in a nested manifest is rejected at that manifest', async () => {
  const { findLockstepPinDrift } = await gate();
  const root = repo({ pkg: PKG, manifests: { 'packages/e2e/package.json': { devDependencies: { '@playwright/test': '^1.59.1' } } } });
  const d = findLockstepPinDrift(root);
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.equal(d[0].file, 'packages/e2e/package.json');
  assert.match(d[0].problem, /pinned EXACTLY/);
});

test('two different exact @playwright/test pins across manifests are rejected', async () => {
  const { findLockstepPinDrift } = await gate();
  const root = repo({
    pkg: { ...PKG, devDependencies: { '@playwright/test': '1.63.0' } },
    manifests: { 'packages/e2e/package.json': { devDependencies: { '@playwright/test': '1.64.0' } } },
  });
  const d = findLockstepPinDrift(root);
  assert.equal(d.length, 1);
  assert.match(d[0].problem, /1\.63\.0 and 1\.64\.0/);
});

test('exact, agreeing lockstep pins are clean — non-lockstep look-alikes and other ranges are ignored', async () => {
  const { findLockstepPinDrift } = await gate();
  const root = repo({
    pkg: { ...PKG, devDependencies: { nx: '24.0.6', '@nx/js': '24.0.6', '@nxlv/python': '^21.0.3', yaml: '^2.9.1', '@playwright/test': '1.63.0' } },
    manifests: { 'packages/e2e/package.json': { devDependencies: { '@playwright/test': '1.63.0' } } },
  });
  assert.deepEqual(findLockstepPinDrift(root), []);
});

test('the lockstep relation is wired into findDrift, not merely exported', async () => {
  const { findDrift } = await gate();
  const d = findDrift(repo({ pkg: { ...PKG, devDependencies: { '@playwright/test': '^1.60.0' } } }));
  assert.equal(d.length, 1, JSON.stringify(d));
});

// --- the Nx wrapper pin (generic Nx, kept from MCM) ------------------------------------------------

test('a package.json-only nx bump is caught when nx.json pins installation.version', async () => {
  const { findNxPinDrift } = await gate();
  const root = repo({ pkg: { ...PKG, devDependencies: { nx: '24.0.6' } }, nxJson: { installation: { version: '24.0.1' } } });
  const d = findNxPinDrift(root);
  assert.equal(d.length, 1);
  assert.equal(d[0].file, 'nx.json');
  assert.match(d[0].problem, /WRAPPER wins/);
});

test('no installation block means the wrapper is unused — not drift', async () => {
  const { findNxPinDrift } = await gate();
  assert.deepEqual(findNxPinDrift(repo({ pkg: { ...PKG, devDependencies: { nx: '24.0.6' } }, nxJson: { plugins: [] } })), []);
});

// --- ONE Node major across every pin -----------------------------------------------------------------

test('two Node majors across pins are caught at the odd pin\'s file and line', async () => {
  const { findDrift } = await gate();
  const root = repo({
    pkg: PKG,
    workflows: {
      'a.yml': wfJob('belay', `${SETUP_NODE('26.13.1')}      - run: node a.mjs\n`),
      'b.yml': wfJob('belay', `${SETUP_NODE('24.22.2')}      - run: node a.mjs\n`),
    },
    dockerfiles: { [TOOLCHAIN]: 'FROM node:26-bookworm\n' },
  });
  const d = findDrift(root).filter((f) => /Node major/.test(f.problem));
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.equal(d[0].file, '.forgejo/workflows/b.yml');
  assert.equal(d[0].line, 9);
  assert.match(d[0].problem, /Node major 24/);
});

test('the toolchain image on another major than every setup-node is caught', async () => {
  const { findDrift } = await gate();
  const root = repo({
    pkg: PKG,
    workflows: {
      'a.yml': wfJob('belay', `${SETUP_NODE()}      - run: node a.mjs\n`),
      'b.yml': wfJob('belay-host', `${SETUP_NODE()}      - run: node a.mjs\n`),
    },
    dockerfiles: { [TOOLCHAIN]: 'FROM node:24-bookworm\n' },
  });
  const d = findDrift(root).filter((f) => /Node major/.test(f.problem));
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.equal(d[0].file, TOOLCHAIN);
});

// --- every Node-running job pins Node with setup-node before its first Node use ----------------------

const implicitFindings = async (root) => (await gate()).findDrift(root).filter((f) => /job `/.test(f.problem));
const inRepo = (runsOn, steps) => repo({ pkg: PKG, workflows: { 'g.yml': wfJob(runsOn, steps) } });

test('a job running node with no setup-node fails, naming the job and the runner Node it would use', async () => {
  const d = await implicitFindings(inRepo('belay', '      - run: bash scripts/ci-log-step.sh x node scripts/gate.mjs\n'));
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.equal(d[0].file, '.forgejo/workflows/g.yml');
  assert.equal(d[0].line, 3, 'the finding points at the job key');
  assert.match(d[0].problem, /`gate`/);
  assert.match(d[0].problem, /node:26-bookworm/);
});

test('a belay-host host job running pnpm with no setup-node fails too', async () => {
  const d = await implicitFindings(inRepo('belay-host', '      - run: pnpm install --frozen-lockfile\n'));
  assert.equal(d.length, 1);
  assert.match(d[0].problem, /host's own Node/);
});

test('Node used BEFORE setup-node fails; install-pnpm.sh is the one step allowed there', async () => {
  assert.equal((await implicitFindings(inRepo('belay', `      - run: node scripts/a.mjs\n${SETUP_NODE()}`))).length, 1);
  assert.equal((await implicitFindings(inRepo('belay', `      - run: bash scripts/ci-log-step.sh p bash scripts/install-pnpm.sh\n${SETUP_NODE()}      - run: pnpm install\n`))).length, 0);
});

test('install-pnpm.sh with no setup-node at all fails', async () => {
  assert.equal((await implicitFindings(inRepo('belay', '      - run: bash scripts/install-pnpm.sh\n'))).length, 1);
});

test('a setup-node with no node-version fails — it installs a major nothing can check', async () => {
  const d = await implicitFindings(inRepo('belay', '      - uses: actions/setup-node@abc\n      - run: node a.mjs\n'));
  assert.equal(d.length, 1);
  assert.match(d[0].problem, /node-version/);
});

test('controls: setup-node first is clean; prose, image names and comments are not Node use', async () => {
  assert.equal((await implicitFindings(inRepo('belay', `${SETUP_NODE()}      - run: node a.mjs\n`))).length, 0);
  assert.equal((await implicitFindings(inRepo('belay', '      - run: |\n          echo "and npm, which the next step runs"\n          docker run --rm node:26 true\n          # node scripts/x.mjs\n'))).length, 0);
});

test('an unparseable workflow is an error (exit 2), never a silent pass', () => {
  const root = repo({ pkg: PKG, workflows: { 'broken.yml': 'jobs:\n  a: [unclosed\n' } });
  const r = runGate('--dir', root);
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

// --- the real repo, and the CLI contract ---------------------------------------------------------------

test('THE REAL REPO passes — this is the invariant the gate protects', () => {
  const r = runGate();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  // "It passed" must say WHAT it passed, or a silently-disabled relation reads like a working one.
  for (const relation of [/engines\.node/, /root manifest only/, /lockstep package is pinned exactly/, /ONE Node major/, /every Node-running job pins its Node with setup-node/]) {
    assert.match(r.stdout, relation);
  }
});

test('--dir scans a fixture root: drift there exits 1 and names the file', () => {
  const root = repo({ pkg: { ...PKG, devDependencies: { nx: '^24.0.6' } } });
  const r = runGate('--dir', root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^package\.json:\d+: /m, 'findings use the `<file>:<line>: <rule>: <message>` shape');
});

test('--selftest passes; --help exits 0; an unknown arg and a bare --dir exit 2', () => {
  assert.equal(runGate('--selftest').status, 0);
  const help = runGate('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage/);
  assert.equal(runGate('--bogus').status, 2);
  assert.equal(runGate('--dir').status, 2);
});

test('importing the gate does NOT run the scan — the module is importable', () => {
  // A gate whose import runs the CLI dies inside its own test suite exactly when it fires.
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(GATE)}); console.log('IMPORTED');`], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /IMPORTED/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /toolchain-consistency/);
});

test('the real repo has no lockstep range and no second packageManager', async () => {
  const { findDrift } = await gate();
  assert.deepEqual(findDrift(REAL), []);
});
