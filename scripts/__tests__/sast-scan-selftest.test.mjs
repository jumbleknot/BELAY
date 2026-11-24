// sast-scan.mjs --selftest: the orchestrator proves its own parse → normalize → report path still
// reports what a scanner emits, before CI trusts a real scan (backlog item 57). Every other scanner
// script already has one; without it, a scan that runs but parses nothing reads as "0 findings".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sastSelftest } from '../sast-scan.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('--selftest exits 0 and says it passed, with no scanner installed and no network', () => {
  const r = spawnSync(process.execPath, ['scripts/sast-scan.mjs', '--selftest'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ sast-scan --selftest passed/);
});

test('the real path passes', () => {
  assert.deepEqual(sastSelftest().failures, []);
});

test('a Semgrep normalizer that drops results fails the selftest, naming semgrep', () => {
  const { failures } = sastSelftest({ normalizeSemgrep: () => [] });
  assert.ok(failures.some((f) => /semgrep/.test(f)), failures.join('\n'));
});

test('a pnpm-audit normalizer that drops advisories fails the selftest, naming pnpm-audit', () => {
  const { failures } = sastSelftest({ normalizePnpmAudit: () => [] });
  assert.ok(failures.some((f) => /pnpm-audit/.test(f)), failures.join('\n'));
});

test('a normalizer that loses blocking (High runtime → not blocking) fails the selftest', () => {
  const { failures } = sastSelftest({ deriveBlocking: () => false });
  assert.ok(failures.some((f) => /blocking/.test(f)), failures.join('\n'));
});

test('a summary that omits a finding fails the selftest', () => {
  const { failures } = sastSelftest({ summarize: () => '── SAST/SCA scan summary ──' });
  assert.ok(failures.some((f) => /summary/.test(f)), failures.join('\n'));
});

test('a failed scanner must read as NOT scanned in the summary, never as a count', () => {
  const { failures } = sastSelftest({ summarize: (report) => report.scanners.map((s) => `${s.scanner}: 0 finding(s)`).join('\n') });
  assert.ok(failures.some((f) => /FAILED/.test(f)), failures.join('\n'));
});

test('a report scrubber that lets a JWT through fails the selftest', () => {
  const { failures } = sastSelftest({ scrubSecretsInText: (t) => t });
  assert.ok(failures.some((f) => /scrub|redact/i.test(f)), failures.join('\n'));
});
