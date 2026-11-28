// check-renovate-config.mjs (feature 011): the pin inventory, the policy rules C1–C11, and the run verdict.
// Pure where it can be: fixture trees in a temp dir, a config object, a parsed workflow object.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RENOVATE_VERSION, detectPins, classifyPins, loadExclusions, checkRules, judgeRun, publishVerdict, cronIntersects,
  renovateConfigSelftest,
} from '../check-renovate-config.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-renovate-config.mjs');
const SHA40 = 'a'.repeat(40);
const SHA64 = 'b'.repeat(64);

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'renovate-cfg-'));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

// A tree with one pin of every kind the detectors know (data-model.md, ManagedPin.kind).
const PIN_TREE = {
  '.forgejo/workflows/ci.yml': [
    'jobs:', '  a:', '    steps:',
    `      - uses: actions/checkout@${SHA40} # v7`,
    '      - uses: actions/setup-node@' + SHA40, '        with:', '          node-version: 26.13.1',
    '      # - uses: old/action@' + SHA40 + ' (a comment is not a pin)',
    '      - run: curl -LsSf https://astral.sh/uv/0.13.9/install.sh | sh',
  ].join('\n'),
  '.devcontainer/toolchain.Dockerfile': [
    `FROM node:26-bookworm@sha256:${SHA64}`,
    'ARG POWERSHELL_VERSION=7.6.5',
    'RUN curl https://sh.rustup.rs | sh -s -- --default-toolchain 1.100.0',
  ].join('\n'),
  'package.json': JSON.stringify({ packageManager: 'pnpm@12.21.0', engines: { node: '>=24' }, devDependencies: { nx: '24.0.6' } }, null, 2),
  'scripts/tool.mjs': [
    "export const SEMGREP_PIN = '1.185.0';",
    "export const RUSTUP_INIT_SHA256 = '" + SHA64 + "';",
    'export const TRIVY_PIN = Object.freeze({', "  version: '0.76.2',", "  sha256: '" + SHA64 + "',", '});',
    "const NOT_A_PIN = 'hello';",
  ].join('\n'),
  'scripts/__tests__/fixture.test.mjs': "export const FIXTURE_VERSION = '9.9.9';",
  '.specify/init-options.json': '{\n  "speckit_version": "1.4.2"\n}\n',
};

test('detectPins finds one pin of every kind, with file, 1-based line and the verbatim value', () => {
  const pins = detectPins(tree(PIN_TREE));
  const kinds = new Set(pins.map((p) => p.kind));
  for (const k of ['action-sha', 'node-version', 'image-digest', 'npm', 'package-manager', 'script-constant',
    'dockerfile-arg', 'installer-url', 'toolchain-flag', 'init-option']) {
    assert.ok(kinds.has(k), `no pin of kind ${k}`);
  }
  const nv = pins.find((p) => p.kind === 'node-version');
  assert.deepEqual([nv.file, nv.line, nv.value], ['.forgejo/workflows/ci.yml', 7, '26.13.1']);
});

test('detectPins skips comment lines and test fixtures', () => {
  const pins = detectPins(tree(PIN_TREE));
  assert.equal(pins.filter((p) => p.kind === 'action-sha').length, 2);
  assert.ok(!pins.some((p) => p.file.includes('__tests__')));
  assert.ok(!pins.some((p) => p.value === 'hello'));
});

test('detectPins marks a sha256 constant with checksumOf naming its pair', () => {
  const pins = detectPins(tree(PIN_TREE));
  const sums = pins.filter((p) => p.checksumOf).map((p) => p.checksumOf).sort();
  assert.deepEqual(sums, ['rustup-init', 'trivy']);
});

test('detectPins reads package.json dependencies, packageManager and engines', () => {
  const pins = detectPins(tree(PIN_TREE)).filter((p) => p.file === 'package.json');
  assert.deepEqual(pins.map((p) => `${p.kind}:${p.value}`).sort(), ['npm:24.0.6', 'npm:>=24', 'package-manager:pnpm@12.21.0']);
});

test('detectPins reports the frozen pin object\'s fields by name', () => {
  const pins = detectPins(tree(PIN_TREE)).filter((p) => p.file === 'scripts/tool.mjs');
  assert.deepEqual(pins.map((p) => p.name).sort(), ['RUSTUP_INIT_SHA256', 'SEMGREP_PIN', 'TRIVY_PIN.sha256', 'TRIVY_PIN.version']);
});

test('detectPins reads the Spec Kit version from init-options.json', () => {
  const pin = detectPins(tree(PIN_TREE)).find((p) => p.kind === 'init-option');
  assert.deepEqual([pin.file, pin.line, pin.value], ['.specify/init-options.json', 2, '1.4.2']);
});

// ── loadExclusions / checkRules scaffold ────────────────────────────────────────────────────────

const EXCL = "- file: 'a.txt'\n  match: 'foo'\n  reason: 'a fixture that tests the rule, not an install'\n  addedBy: 'claude (feature 011)'\n";

test('loadExclusions parses a valid exclusion list', () => {
  assert.deepEqual(loadExclusions(EXCL), [{ file: 'a.txt', match: 'foo', reason: 'a fixture that tests the rule, not an install', addedBy: 'claude (feature 011)' }]);
});

test('loadExclusions refuses a reason under 20 characters, naming the entry', () => {
  assert.throws(() => loadExclusions(EXCL.replace(/reason: '[^']+'/, "reason: 'too short'")), /reason.*20/);
});

test('loadExclusions refuses an entry missing file, match or addedBy', () => {
  const entry = { file: 'a.txt', match: 'foo', reason: 'a fixture that tests the rule, not an install', addedBy: 'claude' };
  for (const k of ['file', 'match', 'addedBy']) {
    const { [k]: _gone, ...rest } = entry;
    const text = Object.entries(rest).map(([key, val], i) => `${i ? '  ' : '- '}${key}: '${val}'`).join('\n') + '\n';
    assert.throws(() => loadExclusions(text), new RegExp(k), k);
  }
});

test('checkRules scaffold: returns sorted { rule, file, detail } and nothing for a compliant fixture', () => {
  const v = checkRules({ ...good(), only: [] });
  assert.deepEqual(v, []);
});

// ── the fixtures for the rules ──────────────────────────────────────────────────────────────────

const WINDOW = '* 5-6 * * 3';
function goodConfig() {
  return {
    timezone: 'UTC',
    schedule: [WINDOW],
    prHourlyLimit: 4,
    prConcurrentLimit: 6,
    osvVulnerabilityAlerts: true,
    vulnerabilityAlerts: { labels: ['security'], schedule: [], minimumReleaseAge: '12 hours' },
    lockFileMaintenance: { enabled: true, schedule: [WINDOW] },
    dependencyDashboard: { enabled: true, labels: ['status/bot-managed'] },
    customManagers: [],
    packageRules: [
      { matchPackageNames: ['*'], minimumReleaseAge: '3 days' },
      { matchUpdateTypes: ['lockFileMaintenance'], prPriority: 5 },
      { matchDatasources: ['docker'], groupName: 'docker base images', prPriority: 3 },
      { matchDepNames: ['node'], groupName: 'node toolchain', prPriority: 3 },
      { matchPackageNames: ['nx', '/^@nx\\//'], groupName: 'nx', prPriority: 0 },
      { matchDepNames: ['rust'], groupName: 'rust toolchain', prPriority: 0 },
      { matchDepNames: ['astral-sh/uv'], groupName: 'uv', prPriority: 0 },
      { matchDepNames: ['github/spec-kit'], groupName: 'spec kit', prPriority: 0, dependencyDashboardApproval: true,
        description: 'Why: needs specify integration upgrade. Re-check: never, it is the procedure.' },
      { matchDatasources: ['docker'], matchUpdateTypes: ['pinDigest', 'digest'], groupName: 'docker digest pins', prPriority: 2 },
      { matchDatasources: ['docker'], matchUpdateTypes: ['pinDigest', 'digest'], minimumReleaseAgeBehaviour: 'timestamp-optional' },
      { matchUpdateTypes: ['major'], dependencyDashboardApproval: true, description: 'Why: every major is toolchain. Re-check: never.' },
      { matchPackageNames: ['actions/upload-artifact'], allowedVersions: '<4',
        description: 'Why: Forgejo rejects v4. Tracked in item #62. Re-check: a Forgejo release with the v4 API.' },
    ],
  };
}
function goodWorkflow() {
  return {
    on: { schedule: [{ cron: '17 1,7,13,19 * * *' }, { cron: '0 5 * * 3' }] },
    jobs: { renovate: { steps: [
      { run: 'bash scripts/ci-log-step.sh renovate-install-pnpm bash scripts/install-pnpm.sh' },
      { env: { RENOVATE_ALLOWED_COMMANDS: '["^node scripts/refresh-pin-checksum\\\\.mjs (trivy|rustup-init|cargo-audit|pwsh)$"]' }, run: 'x' },
    ] } },
  };
}
const good = (over = {}) => ({ config: goodConfig(), workflow: goodWorkflow(), root: tree({ 'pnpm-lock.yaml': '' }), exclusions: [], ...over });
const rulesOf = (v, id) => v.filter((x) => x.rule === id);
const run = (id, mutate) => { const ctx = good(); mutate?.(ctx); return rulesOf(checkRules({ ...ctx, only: [id] }), id); };

// ── judgeRun (RunVerdict) ───────────────────────────────────────────────────────────────────────

const finished = (result, over = {}) => ({ level: 30, msg: 'Repository finished', repository: 'jumbleknot/BELAY', result, ...over });

test('judgeRun passes done, no-work and not-scheduled', () => {
  for (const r of ['done', 'no-work', 'not-scheduled']) assert.equal(judgeRun([finished(r)]).ok, true, r);
});

test('judgeRun fails any other result by name', () => {
  const v = judgeRun([finished('disabled')]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /disabled/);
});

test('judgeRun fails on one ERROR record', () => {
  const v = judgeRun([{ level: 50, msg: 'Repository has invalid config' }, finished('done')]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /invalid config/);
});

test('judgeRun fails when the run never reached the repository', () => {
  const v = judgeRun([{ level: 30, msg: 'Renovate started' }]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /never reached the repository/);
});

test('judgeRun fails an empty log as "the run produced no log"', () => {
  assert.match(judgeRun([]).reason, /the run produced no log/);
});

test('judgeRun fails a WARN that reports a refused lookup or credential', () => {
  for (const msg of ['Failed to look up docker package node', 'Response code 401 (Unauthorized)', 'authentication failure']) {
    assert.equal(judgeRun([{ level: 40, msg }, finished('done')]).ok, false, msg);
  }
});

test('judgeRun ignores a WARN that is not a refusal (a remapped message is INFO and never counted)', () => {
  assert.equal(judgeRun([{ level: 40, msg: 'Branch is not pending' }, { level: 30, msg: 'did not have a releaseTimestamp' }, finished('done')]).ok, true);
});

test('judgeRun publishVerdict posts renovate/verdict with GITHUB_TOKEN to the run commit', async () => {
  const calls = [];
  const env = { GITHUB_TOKEN: 't0k', GITHUB_SERVER_URL: 'https://forge.example', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'c'.repeat(40) };
  const rc = await publishVerdict({ ok: true, line: '✅ renovate run: done' }, { env, fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201 }; }, log: () => {} });
  assert.equal(rc, 0);
  assert.equal(calls[0].url, `https://forge.example/api/v1/repos/o/r/statuses/${'c'.repeat(40)}`);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual([body.context, body.state], ['renovate/verdict', 'success']);
  assert.equal(calls[0].init.headers.Authorization, 'token t0k');
});

test('judgeRun publishVerdict: a refused post is reported and returns non-zero, without throwing', async () => {
  const env = { GITHUB_TOKEN: 't', GITHUB_SERVER_URL: 'https://f', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'c' };
  const errors = [];
  const rc = await publishVerdict({ ok: false, line: '❌ x' }, { env, fetch: async () => ({ ok: false, status: 403 }), log: () => {}, error: (m) => errors.push(m) });
  assert.equal(rc, 1);
  assert.match(errors.join(), /403/);
});

// ── C3: the security channel ────────────────────────────────────────────────────────────────────

test('C3 passes the planned security settings', () => assert.deepEqual(run('C3'), []));
test('C3 fails when vulnerabilityAlerts has a schedule', () => assert.equal(run('C3', (c) => { c.config.vulnerabilityAlerts.schedule = [WINDOW]; }).length, 1));
test('C3 fails when the security age is not shorter than the routine one', () => {
  const v = run('C3', (c) => { c.config.vulnerabilityAlerts.minimumReleaseAge = '3 days'; });
  assert.ok(v.some((x) => /must be shorter/.test(x.detail)));
});
test('C3 fails without osvVulnerabilityAlerts', () => assert.equal(run('C3', (c) => { delete c.config.osvVulnerabilityAlerts; }).length, 1));
test('C3 fails when the worst-case delay exceeds 24 hours', () => {
  const v = run('C3', (c) => { c.workflow.on.schedule[0].cron = '17 1 * * *'; });
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /36h|worst/);
});

test('print-renovate-version prints exactly RENOVATE_VERSION', () => {
  const r = spawnSync(process.execPath, [CLI, '--print-renovate-version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), RENOVATE_VERSION);
});

// ── C2: the window and the crons ────────────────────────────────────────────────────────────────

test('cronIntersects: the window cron lands in the window', () => assert.equal(cronIntersects(WINDOW, '0 5 * * 3'), true));
test('cronIntersects: 03:00 Wednesday does not', () => assert.equal(cronIntersects(WINDOW, '0 3 * * 3'), false));
test('cronIntersects: lists, ranges and steps', () => {
  assert.equal(cronIntersects('* 5-6 * * 3', '17 1,7,13,19 * * *'), false);
  assert.equal(cronIntersects('*/15 6 * * 1-5', '30 6 * * 3'), true);
});
test('C2 passes the planned window and crons', () => assert.deepEqual(run('C2'), []));
test('C2 fails a lockFileMaintenance with no schedule, naming the preset default', () => {
  const v = run('C2', (c) => { delete c.config.lockFileMaintenance.schedule; });
  assert.match(v[0].detail, /before 4am on monday|preset/);
});
test('C2 fails a packageRules schedule that meets no cron', () => assert.equal(run('C2', (c) => { c.config.packageRules[0].schedule = ['* 9 * * 1']; }).length, 1));
test('C2 fails when the window cron does not land in the window', () => assert.ok(run('C2', (c) => { c.config.schedule = ['* 5-6 * * 4']; c.config.lockFileMaintenance.schedule = ['* 5-6 * * 4']; }).length >= 1));
test('C2 fails a security cron inside the window', () => assert.equal(run('C2', (c) => { c.workflow.on.schedule[0].cron = '17 5 * * *'; }).length, 1));
test('C2 fails a timezone other than UTC', () => assert.equal(run('C2', (c) => { c.config.timezone = 'America/New_York'; }).length, 1));

// ── C4, C5: limits, priority, lock-file toolchains ──────────────────────────────────────────────

test('C4 passes the planned limits and priorities', () => assert.deepEqual(run('C4'), []));
test('C4 fails prConcurrentLimit not above prHourlyLimit', () => assert.equal(run('C4', (c) => { c.config.prConcurrentLimit = 4; }).length, 1));
test('C4 fails a prPriority set inside lockFileMaintenance (Renovate ignores it there)', () => assert.equal(run('C4', (c) => { c.config.lockFileMaintenance.prPriority = 5; }).length, 1));
test('C4 fails a groupName rule without prPriority', () => assert.equal(run('C4', (c) => { delete c.config.packageRules[4].prPriority; }).length, 1));
test('C4 fails the priority order lock files > base images > digest pins > 0', () => assert.equal(run('C4', (c) => { c.config.packageRules[8].prPriority = 4; }).length, 1));
test('C5 fails a tracked lock file whose toolchain the workflow does not install', () => {
  assert.equal(run('C5', (c) => { c.workflow.jobs.renovate.steps[0].run = 'echo'; }).length, 1);
  assert.deepEqual(run('C5'), []);
});

// ── C10 and the cooling-off ─────────────────────────────────────────────────────────────────────

test('C10 passes the planned lockstep groups', () => assert.deepEqual(run('C10'), []));
test('C10 fails a lockstep group that is missing', () => assert.equal(run('C10', (c) => { c.config.packageRules.splice(5, 1); }).length, 1));
test('C10 fails a group whose matchers miss a member (nx without @nx/*)', () => assert.equal(run('C10', (c) => { c.config.packageRules[4].matchPackageNames = ['nx']; }).length, 1));
test('cooling-off fails a routine minimumReleaseAge other than 3 days', () => assert.equal(run('C10', (c) => { c.config.packageRules[0].minimumReleaseAge = '1 day'; }).length, 1));
test('cooling-off fails docker digest updates without timestamp-optional', () => assert.equal(run('C10', (c) => { c.config.packageRules.splice(9, 1); }).length, 1));

// ── classifyPins and C6 ─────────────────────────────────────────────────────────────────────────

const SEMGREP_MGR = { customType: 'regex', managerFilePatterns: ['/^scripts\\/tool\\.mjs$/'], matchStrings: ["SEMGREP_PIN = '(?<currentValue>[\\d.]+)'"], depNameTemplate: 'semgrep', datasourceTemplate: 'pypi' };
const c6ctx = (over = {}) => {
  const root = tree({ 'scripts/tool.mjs': "export const SEMGREP_PIN = '1.185.0';\n", 'a.txt': `img@sha256:${SHA64}\n`,
    '.forgejo/workflows/w.yml': `      - uses: actions/checkout@${SHA40}\n`, 'pnpm-lock.yaml': '' });
  const ctx = good({ root });
  ctx.config.customManagers = [structuredClone(SEMGREP_MGR)];
  ctx.exclusions = [{ file: 'a.txt', match: 'img@sha256', reason: 'a fixture line that only looks like an image pin', addedBy: 't' }];
  return { ...ctx, ...over };
};

test('classifyPins: built-in, custom and excluded', () => {
  const ctx = c6ctx();
  const pins = classifyPins(detectPins(ctx.root), ctx.config, ctx.exclusions, ctx.root);
  const by = Object.fromEntries(pins.map((p) => [p.file, p.managedBy]));
  assert.deepEqual(by, { 'scripts/tool.mjs': 'custom:0', 'a.txt': 'excluded', '.forgejo/workflows/w.yml': 'builtin:github-actions' });
});
test('C6 passes when every pin is managed or excluded', () => assert.deepEqual(rulesOf(checkRules({ ...c6ctx(), only: ['C6'] }), 'C6'), []));
test('C6 fails an uncovered pin, naming its file and line', () => {
  const ctx = c6ctx(); ctx.config.customManagers = [];
  const v = rulesOf(checkRules({ ...ctx, only: ['C6'] }), 'C6');
  assert.ok(v.some((x) => x.file === 'scripts/tool.mjs:1'));
});
test('C6 fails a manager using fileMatch', () => {
  const ctx = c6ctx(); ctx.config.customManagers[0].fileMatch = ['x'];
  assert.ok(rulesOf(checkRules({ ...ctx, only: ['C6'] }), 'C6').some((x) => /fileMatch/.test(x.detail)));
});
test('C6 fails a manager that captures nothing', () => {
  const ctx = c6ctx(); ctx.config.customManagers.push({ ...SEMGREP_MGR, matchStrings: ["NOPE = '(?<currentValue>x)'"] });
  assert.ok(rulesOf(checkRules({ ...ctx, only: ['C6'] }), 'C6').some((x) => /captures nothing/.test(x.detail)));
});
test('C6 fails a stale exclusion that matches no pin', () => {
  const ctx = c6ctx(); ctx.exclusions.push({ file: 'a.txt', match: 'zzz', reason: 'stale on purpose for this test', addedBy: 't' });
  assert.ok(rulesOf(checkRules({ ...ctx, only: ['C6'] }), 'C6').some((x) => /stale/.test(x.detail)));
});
test('C6 fails a glob managerFilePattern (only the /regex/ form can be checked offline)', () => {
  const ctx = c6ctx(); ctx.config.customManagers[0].managerFilePatterns = ['scripts/*.mjs'];
  assert.ok(rulesOf(checkRules({ ...ctx, only: ['C6'] }), 'C6').some((x) => /regex/.test(x.detail)));
});

// ── C8: version-and-checksum pairs ──────────────────────────────────────────────────────────────

const PAIR_FILE = { trivy: 'scripts/install-trivy.mjs', 'rustup-init': 'scripts/sast-prepare.mjs', 'cargo-audit': 'scripts/sast-prepare.mjs', pwsh: 'scripts/install-pwsh.mjs' };
const pairRules = () => ['trivy', 'rustup-init', 'cargo-audit', 'pwsh'].map((pin) => ({
  matchDepNames: [pin], postUpgradeTasks: { commands: [`node scripts/refresh-pin-checksum.mjs ${pin}`],
    fileFilters: [PAIR_FILE[pin]], executionMode: 'update' },
}));
test('C8 passes when each pair has its post-upgrade task, allowed by the workflow', () => {
  assert.deepEqual(run('C8', (c) => c.config.packageRules.push(...pairRules())), []);
});
test('C8 fails when the pwsh pair (feature 016) has no post-upgrade task', () => {
  const v = run('C8', (c) => c.config.packageRules.push(...pairRules().filter((r) => r.matchDepNames[0] !== 'pwsh')));
  assert.ok(v.some((x) => /pwsh/.test(x.detail)), JSON.stringify(v));
});
test('C8 fails a pair with no post-upgrade task', () => {
  assert.equal(run('C8', (c) => c.config.packageRules.push(...pairRules().slice(1))).length, 1);
});
test('C8 fails a command other than the refresh script', () => {
  const v = run('C8', (c) => { const r = pairRules(); r[0].postUpgradeTasks.commands = ['sh -c evil']; c.config.packageRules.push(...r); });
  assert.ok(v.some((x) => /trivy/.test(x.detail)));
});
test('C8 fails a command the workflow does not allow', () => {
  assert.equal(run('C8', (c) => { c.config.packageRules.push(...pairRules()); c.workflow.jobs.renovate.steps[1].env.RENOVATE_ALLOWED_COMMANDS = '["^node scripts/refresh-pin-checksum\\\\.mjs trivy$"]'; }).length, 3,
    'one violation for each pair the workflow does not allow: rustup-init, cargo-audit and pwsh');
});

// ── C1, C7: automerge, holds and approvals ──────────────────────────────────────────────────────

test('C1 passes with no automerge anywhere', () => assert.deepEqual(run('C1'), []));
test('C1 fails automerge: true at any depth', () => {
  assert.equal(run('C1', (c) => { c.config.automerge = true; }).length, 1);
  assert.equal(run('C1', (c) => { c.config.packageRules[3].automerge = true; }).length, 1);
  assert.equal(run('C1', (c) => { c.config.lockFileMaintenance.automerge = true; }).length, 1);
});
test('C1 fails platformAutomerge', () => assert.equal(run('C1', (c) => { c.config.platformAutomerge = true; }).length, 1));
test('C7 passes the planned holds and approvals', () => assert.deepEqual(run('C7'), []));
test('C7 fails a hold missing Why:, item #N or Re-check:, naming its index and packages', () => {
  for (const drop of [/Why:[^.]*\./, /Tracked in item #62\./, /Re-check:.*/]) {
    const v = run('C7', (c) => { c.config.packageRules[11].description = c.config.packageRules[11].description.replace(drop, ''); });
    assert.equal(v.length, 1, String(drop));
    assert.match(v[0].detail, /packageRules\[11\].*actions\/upload-artifact/);
  }
});
test('C7 fails a hold with no match* key', () => assert.equal(run('C7', (c) => { delete c.config.packageRules[11].matchPackageNames; }).length, 1));
test('C7 fails an approval rule missing Re-check:', () => assert.equal(run('C7', (c) => { c.config.packageRules[10].description = 'Why: x'; }).length, 1));
test('C7 fails approval on a patch track outside spec kit', () => {
  assert.equal(run('C7', (c) => c.config.packageRules.push({ matchUpdateTypes: ['patch'], matchDepNames: ['x'], dependencyDashboardApproval: true, description: 'Why: x. Re-check: y.' })).length, 1);
});
test('C7 requires the majors-approval rule', () => assert.equal(run('C7', (c) => { c.config.packageRules.splice(10, 1); }).length, 1));

// ── C11: no wiki page cites a bot-rewritten file ────────────────────────────────────────────────

test('C11 fails a wiki page whose resource is a bot-rewritten file, naming the page', () => {
  for (const resource of ['package.json', '.forgejo/workflows/w.yml', 'scripts/tool.mjs']) {
    const ctx = c6ctx();
    writeFileSync(join(ctx.root, 'page.md'), '');
    mkdirSync(join(ctx.root, 'openwiki/runbooks'), { recursive: true });
    writeFileSync(join(ctx.root, 'openwiki/runbooks/x.md'), `---\ntitle: x\nresource: ${resource}\n---\n`);
    const v = rulesOf(checkRules({ ...ctx, only: ['C11'] }), 'C11');
    assert.equal(v.length, 1, resource);
    assert.equal(v[0].file, 'openwiki/runbooks/x.md');
  }
});
test('C11 passes a page citing a runbook', () => {
  const ctx = c6ctx();
  mkdirSync(join(ctx.root, 'openwiki'), { recursive: true });
  writeFileSync(join(ctx.root, 'openwiki/x.md'), '---\nresource: docs/runbooks/ci.md\n---\n');
  assert.deepEqual(rulesOf(checkRules({ ...ctx, only: ['C11'] }), 'C11'), []);
});

// ── C9: the dashboard ───────────────────────────────────────────────────────────────────────────

test('C9 passes the planned dashboard', () => assert.deepEqual(run('C9'), []));
test('C9 fails a dashboard that is disabled or absent', () => {
  assert.equal(run('C9', (c) => { c.config.dependencyDashboard.enabled = false; }).length, 1);
  assert.equal(run('C9', (c) => { delete c.config.dependencyDashboard; }).length, 1);
});
test('C9 fails a dashboard label other than status/bot-managed', () => assert.equal(run('C9', (c) => { c.config.dependencyDashboard.labels = ['renovate']; }).length, 1));
test('C9 fails the legacy dependencyDashboard: true + dependencyDashboardLabels shape (renovate@44 --strict refuses it as a migration)', () => {
  const v = run('C9', (c) => { c.config.dependencyDashboard = true; c.config.dependencyDashboardLabels = ['status/bot-managed']; });
  assert.ok(v.some((x) => /migration|object/.test(x.detail)));
});

// ── selftest ────────────────────────────────────────────────────────────────────────────────────

test('selftest: every rule can fail, and the selftest passes', () => {
  const r = renovateConfigSelftest();
  assert.deepEqual(r.failures, []);
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11']) assert.ok(r.proved.includes(id), id);
});

test.after(() => { /* temp trees are left to the OS temp cleaner, as in the other suites */ });
void rmSync;

// ── the workflow's preflight and dispatch-mode steps (tokens from the environment, never argv) ──

import { preflightToken, publishMode } from '../check-renovate-config.mjs';
const FENV = { GITHUB_SERVER_URL: 'https://forge.example', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'c'.repeat(40), GITHUB_TOKEN: 'run-token' };

test('preflight: an empty RENOVATE_TOKEN fails, naming the secret', async () => {
  const r = await preflightToken({ env: { ...FENV, RENOVATE_TOKEN: '' }, fetch: async () => { throw new Error('must not call'); } });
  assert.equal(r.ok, false);
  assert.match(r.line, /RENOVATE_TOKEN is empty/);
});
test('preflight: GET /api/v1/user refused fails with the status, and never prints the token', async () => {
  const calls = [];
  const r = await preflightToken({ env: { ...FENV, RENOVATE_TOKEN: 'sekrit-123' }, fetch: async (url, init) => { calls.push({ url, init }); return { ok: false, status: 401 }; } });
  assert.equal(r.ok, false);
  assert.match(r.line, /401/);
  assert.doesNotMatch(r.line, /sekrit-123/);
  assert.equal(calls[0].url, 'https://forge.example/api/v1/user');
  assert.equal(calls[0].init.headers.Authorization, 'token sekrit-123');
});
test('preflight: an accepted token passes', async () => {
  const r = await preflightToken({ env: { ...FENV, RENOVATE_TOKEN: 't' }, fetch: async () => ({ ok: true, status: 200 }) });
  assert.equal(r.ok, true);
});
test('publishMode: posts renovate/mode as DRY RUN or LIVE, with the run token', async () => {
  for (const [dry, want] of [['full', /DRY RUN/], ['', /LIVE/]]) {
    const calls = [];
    await publishMode({ env: { ...FENV, RENOVATE_DRY_RUN: dry }, fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201 }; }, log: () => {} });
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.context, 'renovate/mode');
    assert.match(body.description, want);
    assert.equal(calls[0].init.headers.Authorization, 'token run-token');
  }
});

// ── feature 012: the lock-file and health-report suffixes on the verdict line ────────────────────

const doneRec = { level: 30, msg: 'Repository finished', repository: 'jumbleknot/BELAY', result: 'done' };
const infoRec = (result) => ({ level: 20, msg: 'branches info extended', branchesInformation: [
  { branchName: 'renovate/semgrep-1.x', result: 'pr-created' }, { branchName: 'renovate/lock-file-maintenance', result }] });

test('lock file suffix: the lock-file-maintenance branch result is appended', () => {
  assert.match(judgeRun([infoRec('no-work'), doneRec]).line, /; lock file: no-work$/);
});
test('lock file suffix: no branches record, or no lock-file entry, is "absent"', () => {
  assert.match(judgeRun([doneRec]).line, /; lock file: absent$/);
  assert.match(judgeRun([{ level: 20, msg: 'branches info extended', branchesInformation: [] }, doneRec]).line, /; lock file: absent$/);
});
test('health report suffix: a fresh report is appended and passes', () => {
  const v = judgeRun([infoRec('no-work'), doneRec], { health: 'fresh 2d' });
  assert.equal(v.ok, true);
  assert.match(v.line, /; lock file: no-work; health report: fresh 2d$/);
});
test('health report suffix: stale, missing or unknown fails the verdict, naming it', () => {
  for (const h of ['stale 9d', 'missing', 'unknown']) {
    const v = judgeRun([doneRec], { health: h });
    assert.equal(v.ok, false, h);
    assert.match(v.line, new RegExp(`health report: ${h}`));
  }
});
test('health report suffix: no-report-yet passes', () => assert.equal(judgeRun([doneRec], { health: 'no-report-yet' }).ok, true));
