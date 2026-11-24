// sast-scan.mjs's pure transforms: SARIF output, cargo-audit normalization and the proposed-allowlist
// file. They run without any scanner installed, so they are tested here directly (feature 009,
// research R7: they are what lifts the orchestrator above the coverage floor without a scanner run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toSarif, normalizeCargoAudit, emitProposedAllowlist, loadSeverityMap } from '../sast-scan.mjs';

const MAP = loadSeverityMap();

const sastFinding = {
  scanner: 'semgrep', kind: 'sast', id: 'belay-no-token-logging', title: 'token logged',
  location: 'scripts/x.mjs:12', severity: 'High', scope: null, blocking: true,
};
const scaFinding = {
  scanner: 'pnpm-audit', kind: 'sca', id: 'GHSA-aaaa-bbbb-cccc', title: 'proto pollution',
  location: 'lodash@4.17.0', severity: 'Medium', scope: 'dev', blocking: false,
};

// ── toSarif ─────────────────────────────────────────────────────────────────────────────────────

test('toSarif emits a SARIF 2.1.0 log with one result per finding', () => {
  const log = toSarif([sastFinding, scaFinding]);
  assert.equal(log.version, '2.1.0');
  assert.equal(log.runs.length, 1);
  assert.equal(log.runs[0].tool.driver.name, 'belay-sast-scan');
  assert.equal(log.runs[0].results.length, 2);
});

test('a SAST finding maps to a physical location with its line, and High to level error', () => {
  const [r] = toSarif([sastFinding]).runs[0].results;
  assert.equal(r.ruleId, 'semgrep:belay-no-token-logging');
  assert.equal(r.level, 'error');
  assert.deepEqual(r.locations[0].physicalLocation, { artifactLocation: { uri: 'scripts/x.mjs' }, region: { startLine: 12 } });
  assert.equal(r.message.text, '[High/blocking] token logged');
});

test('an SCA finding maps to a logical package location, and Medium to level warning', () => {
  const [r] = toSarif([scaFinding]).runs[0].results;
  assert.equal(r.level, 'warning');
  assert.deepEqual(r.locations[0].logicalLocations, [{ name: 'lodash@4.17.0', kind: 'package' }]);
  assert.equal(r.properties.scope, 'dev');
});

// ── normalizeCargoAudit ─────────────────────────────────────────────────────────────────────────

const CARGO_NATIVE = {
  vulnerabilities: {
    list: [
      { advisory: { id: 'RUSTSEC-2026-0001', title: 'heap overflow', cvss: 9.8 }, package: { name: 'smallvec', version: '1.0.0' }, versions: { patched: ['>=1.0.1'] } },
      { advisory: { id: 'RUSTSEC-2026-0002', title: 'dos', cvss: 5.3 }, package: { name: 'dev-only', version: '0.2.0' }, versions: { patched: [] } },
      { advisory: { id: 'RUSTSEC-2026-0003', title: 'no score' }, package: { name: 'smallvec', version: '1.0.0' } },
    ],
  },
  warnings: { unmaintained: [{ advisory: { id: 'RUSTSEC-2026-0004', title: 'unmaintained' }, package: { name: 'old', version: '0.1.0' } }] },
};

test('normalizeCargoAudit bands CVSS into severities and scopes by the runtime set', () => {
  const out = normalizeCargoAudit(CARGO_NATIVE, new Set(['smallvec']), MAP);
  const byId = Object.fromEntries(out.map((f) => [f.id, f]));
  assert.equal(byId['RUSTSEC-2026-0001'].severity, 'Critical');
  assert.equal(byId['RUSTSEC-2026-0001'].scope, 'runtime');
  assert.equal(byId['RUSTSEC-2026-0001'].blocking, true);
  assert.equal(byId['RUSTSEC-2026-0001'].fixAvailable, '>=1.0.1');
  assert.equal(byId['RUSTSEC-2026-0002'].severity, 'Medium');
  assert.equal(byId['RUSTSEC-2026-0002'].scope, 'dev');
  assert.equal(byId['RUSTSEC-2026-0002'].blocking, false);
});

test('an advisory with no CVSS score is surfaced as High, not down-ranked', () => {
  const f = normalizeCargoAudit(CARGO_NATIVE, new Set(['smallvec']), MAP).find((x) => x.id === 'RUSTSEC-2026-0003');
  assert.equal(f.severity, 'High');
  assert.equal(f.nativeSeverity, 'unscored');
});

test('an informational warning is Low and never blocking, whatever its package', () => {
  const f = normalizeCargoAudit(CARGO_NATIVE, new Set(['old']), MAP).find((x) => x.id === 'RUSTSEC-2026-0004');
  assert.equal(f.severity, 'Low');
  assert.equal(f.blocking, false);
  assert.equal(f.nativeSeverity, 'unmaintained');
});

test('a workspace other than the root prefixes the location', () => {
  const [f] = normalizeCargoAudit({ vulnerabilities: { list: [CARGO_NATIVE.vulnerabilities.list[0]] } }, null, MAP, 'tools/x');
  assert.match(f.location, /^tools\/x:smallvec@1\.0\.0$/);
});

// ── emitProposedAllowlist ───────────────────────────────────────────────────────────────────────

test('emitProposedAllowlist writes one entry per distinct finding, with TODO triage lines and escaped patterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'belay-allowlist-'));
  try {
    const out = join(dir, 'allowlist.proposed.yaml');
    const n = emitProposedAllowlist([sastFinding, sastFinding, scaFinding], out);
    assert.equal(n, 2);
    const text = readFileSync(out, 'utf8');
    assert.equal((text.match(/^- scanner:/gm) ?? []).length, 2);
    assert.match(text, /locationPattern: "scripts\/x\\\.mjs:12"/);
    assert.match(text, /locationPattern: "lodash@4\\\.17\\\.0"/);
    assert.equal((text.match(/justification: "TODO/g) ?? []).length, 2);
    assert.match(text, /# High\/blocking — token logged/);
    assert.match(text, /# Medium\/dev-scope — proto pollution/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
