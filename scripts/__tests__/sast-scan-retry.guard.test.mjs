// Tests for scripts/lib/scanner-retry.mjs and its wiring into scripts/sast-scan.mjs: a transient
// advisory-service or registry outage must not red the `guardrails / sast` gate, and a scanner that
// could not run must still never report clean.
//
// WHY THIS GUARD EXISTS. Ported from MovieCollectionManager (MCM), where on 2026-09-13 a required
// `guardrails / sast` run failed on:
//
//   [sast-scan] FAILED fast: [pip-audit] <python project> produced non-JSON output:
//     File ".../pip_audit/_service/osv.py", line 79, in query
//       raise ServiceError from http_error
//   pip_audit._service.interface.ServiceError
//
// The scan had otherwise COMPLETED (`findings=16 blocking=0`). No security finding was involved;
// osv.dev answered 200 minutes later and the identical path passed on two other PRs the same day. One
// transient HTTP error from a third party had redded a required gate for every PR open at that
// moment, and the orchestrator contained zero occurrences of `retry`, `backoff` or `attempt`.
//
// The fail-closed behaviour is CORRECT and these tests pin it: a scanner that could not run must never
// report clean. What was missing is a bounded retry before that verdict, and an output that
// distinguishes "the advisory service was unreachable" from "the scanner ran and found something".
//
// The usual outcome of a retry is that it silently never triggers, so the classifier and the retry
// driver are exported and tested directly rather than inferred from a scan that happens to pass.
//
// Runs in CI under `pnpm nx run scripts:test`: offline, token-free, node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  isTransientScannerFailure,
  TransientScannerError,
  transientOr,
  readTail,
} from '../lib/scanner-retry.mjs';
import { retryTransient } from '../sast-scan.mjs';

// ── The classifier ───────────────────────────────────────────────────────────

test('the measured osv.dev ServiceError traceback is classified transient', () => {
  const measured = [
    'Traceback (most recent call last):',
    '  File ".../pip_audit/_service/osv.py", line 79, in query',
    '    raise ServiceError from http_error',
    'pip_audit._service.interface.ServiceError',
  ].join('\n');
  assert.equal(
    isTransientScannerFailure(measured),
    true,
    'the measured osv.dev failure that redded MCM\'s required gate must be retryable',
  );
});

test('common transport failures from every network-dependent scanner are classified transient', () => {
  for (const sample of [
    'pip_audit._service.interface.ServiceError',
    'requests.exceptions.ConnectionError: HTTPSConnectionPool(host=\'api.osv.dev\', port=443)',
    'requests.exceptions.ReadTimeout: HTTPSConnectionPool(host=\'api.osv.dev\', port=443): Read timed out.',
    'urllib3.exceptions.MaxRetryError: Max retries exceeded with url: /v1/querybatch',
    'HTTP Error 502: Bad Gateway',
    'HTTP Error 503: Service Unavailable',
    'HTTP Error 504: Gateway Timeout',
    'HTTP Error 429: Too Many Requests',
    'error: failed to fetch advisory database: network failure',
    'fatal: unable to access https://github.com/RustSec/advisory-db: Could not resolve host',
    'Error: connect ECONNRESET 140.82.121.6:443',
    'Error: connect ETIMEDOUT',
    'getaddrinfo EAI_AGAIN registry.npmjs.org',
    'Temporary failure in name resolution',
    'Error: socket hang up',
    'WARN GET https://registry.npmjs.org/-/npm/v1/security/audits error (ECONNREFUSED)',
  ]) {
    assert.equal(isTransientScannerFailure(sample), true, `should be transient: ${sample}`);
  }
});

test('the measured Trivy vulnerability-DB fetch strings classify transient on their own', () => {
  // The list is shared by every scanner orchestrator (MCM's infra-image scan added these, measured on
  // its runs). BELAY has no Trivy caller yet; the signatures are kept so the list is not re-learned.
  for (const sample of [
    'ERROR\t[vulndb] Failed to download artifact\trepo="mirror.gcr.io/aquasec/trivy-db:2"',
    'err="oci download error: failed to fetch the layer: GET https://mirror.gcr.io/v2/…"',
    'FATAL\tFatal error\tinit error: DB error: failed to download vulnerability DB',
    'ERROR\t[javadb] Failed to download artifact',
    'TOOMANYREQUESTS: too many requests',
  ]) {
    assert.equal(isTransientScannerFailure(sample), true, `should be transient: ${sample}`);
  }
});

test('a REAL scanner fault is NOT classified transient, so it fails on the first attempt', () => {
  // These are the failures where retrying is pure waste and, worse, hides the real cause behind a
  // multi-attempt delay. A misconfigured venv or an unparseable report is not an outage.
  for (const sample of [
    'error: No virtual environment found; run `uv sync`',
    'ModuleNotFoundError: No module named \'pip_audit\'',
    'error: Failed to parse `pyproject.toml`',
    'thread \'main\' panicked at src/main.rs:12:5',
    'error: the lock file Cargo.lock needs to be updated but --locked was passed',
    'ERR_PNPM_NO_LOCKFILE  Cannot audit without a lockfile',
    'Permission denied (os error 13)',
    '',
  ]) {
    assert.equal(isTransientScannerFailure(sample), false, `should NOT be transient: ${sample || '(empty output)'}`);
  }
});

test('the classifier does not fall for ordinary words in a finding title', () => {
  // A finding's own title routinely contains "error", "timeout" or a URL. Classifying on those would
  // retry real findings and, after the retries, still report them: slower, for nothing. The HTTP-status
  // signatures require the CODE, and "Read timed out" requires requests' terminating period, because
  // MCM measured advisory titles containing each bare phrase.
  for (const title of [
    'GHSA-xxxx: improper error handling in foo',
    'RUSTSEC-2024-0001: timeout handling is unsound',
    'CVE-2025-68121: net/http: server does not limit Service Unavailable responses',
    'GHSA-aaaa: proxy mishandles a Bad Gateway response body',
    'RUSTSEC-2025-0002: Too Many Requests are queued without bound',
    'openssl: read timed out while parsing a certificate',
    'GHSA-xxxx-yyyy: openssl: TLS connection state confusion',
  ]) {
    assert.equal(isTransientScannerFailure(title), false, `a finding must never be retried: ${title}`);
  }
});

test('transientOr marks a transport failure transient and keeps a real fault as a plain error', () => {
  const transient = transientOr('[pnpm-audit] failed', 'Error: connect ECONNRESET');
  assert.ok(transient instanceof TransientScannerError);
  assert.equal(transient.transient, true);
  const real = transientOr('[pnpm-audit] failed', 'ERR_PNPM_NO_LOCKFILE');
  assert.ok(!(real instanceof TransientScannerError));
  assert.equal(real.transient, undefined);
  class ScanError extends Error {}
  assert.ok(transientOr('x', 'not a transport line', ScanError) instanceof ScanError, 'the caller keeps its own error type');
});

test('readTail keeps the END of a long output and says how much it dropped', () => {
  // The fatal line is at the end. MCM once truncated a scanner's stderr from the HEAD, and the captured
  // failure ended mid-URL exactly where the HTTP status would have been.
  const out = readTail('x'.repeat(3000), 100);
  assert.match(out, /2900 earlier chars omitted/);
  assert.equal(out.endsWith('x'.repeat(100)), true, 'and keeps the END');
  assert.equal(readTail('short'), 'short', 'a short output is passed through unchanged');
});

// ── The retry driver ─────────────────────────────────────────────────────────

/** A sleep that records what it was asked to wait, so backoff is asserted without spending the time. */
function fakeSleep() {
  const waited = [];
  const fn = (ms) => waited.push(ms);
  fn.waited = waited;
  return fn;
}

const quietRetry = () => {};

test('a transient failure is RETRIED and a later success is returned', () => {
  let calls = 0;
  const sleep = fakeSleep();
  const out = retryTransient(
    'pip-audit',
    () => {
      calls += 1;
      if (calls < 3) throw new TransientScannerError('pip_audit._service.interface.ServiceError');
      return { ok: true };
    },
    { attempts: 3, baseDelayMs: 1000, sleep, onRetry: quietRetry },
  );
  assert.deepEqual(out, { ok: true });
  assert.equal(calls, 3, 'should have taken all three attempts');
  assert.equal(sleep.waited.length, 2, 'should sleep between attempts, not after the last one');
});

test('the retry BACKS OFF: a fixed-interval retry is not a retry against a service under load', () => {
  const sleep = fakeSleep();
  assert.throws(() =>
    retryTransient('pip-audit', () => { throw new TransientScannerError('ServiceError'); },
      { attempts: 4, baseDelayMs: 1000, sleep, onRetry: quietRetry }),
  );
  assert.equal(sleep.waited.length, 3);
  for (let i = 1; i < sleep.waited.length; i += 1) {
    assert.ok(
      sleep.waited[i] > sleep.waited[i - 1],
      `delay ${i} (${sleep.waited[i]}ms) must exceed delay ${i - 1} (${sleep.waited[i - 1]}ms)`,
    );
  }
});

test('FAIL-CLOSED is preserved: exhausting the retries still throws', () => {
  // This is about not failing on the FIRST blip. It is NOT about tolerating a scanner that cannot
  // run. If this assertion is ever relaxed, the gate starts reporting clean on an outage.
  assert.throws(
    () => retryTransient('pip-audit', () => { throw new TransientScannerError('ServiceError'); },
      { attempts: 3, baseDelayMs: 1, sleep: fakeSleep(), onRetry: quietRetry }),
    (err) => err instanceof Error,
    'a scanner that never ran must never report clean',
  );
});

test('the exhausted error says TRANSPORT, names the attempt count, and denies a finding was involved', () => {
  let thrown;
  try {
    retryTransient('pip-audit', () => { throw new TransientScannerError('osv.dev ServiceError'); },
      { attempts: 3, baseDelayMs: 1, sleep: fakeSleep(), onRetry: quietRetry });
  } catch (e) { thrown = e; }
  assert.ok(thrown, 'must throw');
  const msg = String(thrown.message);
  assert.match(msg, /transport|service/i, 'must name the failure CLASS, not just repeat the scanner output');
  assert.match(msg, /3/, 'must say how many attempts were made');
  assert.match(msg, /not a (security )?finding/i,
    'the measured outage read as a security failure, so the output must say which it is');
  assert.match(msg, /pip-audit/, 'must name the scanner');
});

test('a NON-transient failure is thrown on the FIRST attempt, unretried and unwrapped', () => {
  let calls = 0;
  const sleep = fakeSleep();
  assert.throws(
    () => retryTransient('pip-audit', () => {
      calls += 1;
      throw new Error('error: No virtual environment found; run `uv sync`');
    }, { attempts: 3, baseDelayMs: 1, sleep, onRetry: quietRetry }),
    /No virtual environment/,
    'a real fault must surface verbatim and immediately',
  );
  assert.equal(calls, 1, 'a real fault must NOT be retried');
  assert.equal(sleep.waited.length, 0, 'and must not spend backoff time');
});

test('each retry is reported, so a retry that fires is VISIBLE in the job log', () => {
  // A silent retry is indistinguishable from no retry at all, which is how this defect class survives.
  const seen = [];
  retryTransient('pip-audit', (() => {
    let n = 0;
    return () => { n += 1; if (n < 2) throw new TransientScannerError('ServiceError'); return 'ok'; };
  })(), { attempts: 3, baseDelayMs: 1, sleep: fakeSleep(), onRetry: (info) => seen.push(info) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].scanner, 'pip-audit');
  assert.equal(seen[0].attempt, 1);
  assert.equal(seen[0].attempts, 3);
  assert.match(String(seen[0].reason), /ServiceError/);
});

// ── The wiring ───────────────────────────────────────────────────────────────
//
// The classifier and driver above can be perfect while nothing calls them. These read the source and
// pin that every network-dependent scanner invocation is actually wrapped: the mutation that removes
// a `retryTransient(` call turns one of these red.

const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'sast-scan.mjs'), 'utf8');

test('every network-dependent scanner invocation is wrapped in retryTransient', () => {
  // pip-audit queries osv.dev, cargo-audit fetches the RustSec advisory DB, pnpm audit queries the npm
  // registry's advisory endpoint, and Semgrep fetches its rule packs from the registry (the spec's
  // edge case: "the Semgrep rule registry ... briefly unreachable ... is retried"). All are a third
  // party over the network on the gate's critical path, and all fail the same way.
  for (const fn of ['auditOnePythonSurface', 'runCargoAudit', 'pnpmAuditJson', 'runSemgrep']) {
    const at = SRC.indexOf(`function ${fn}(`);
    assert.notEqual(at, -1, `${fn} should still exist: update this guard if it was renamed`);
    // The body runs to the next top-level function, so a call in a NEIGHBOUR cannot satisfy it.
    const rest = SRC.slice(at + 1);
    const next = rest.search(/\n(?:export )?function /);
    const body = SRC.slice(at, next === -1 ? undefined : at + 1 + next);
    assert.match(body, /retryTransient\(/, `${fn} must run its scanner through retryTransient`);
  }
});

test('the scanner failure paths classify before throwing, rather than throwing a bare Error', () => {
  // The classifier only ever runs if the throw sites consult it.
  assert.match(SRC, /from '\.\/lib\/scanner-retry\.mjs'/, 'must import the shared module, not a copy');
  const marks = SRC.match(/new TransientScannerError\(|transientOr\(/g) ?? [];
  assert.ok(marks.length >= 4, `expected at least 4 classified throw sites, found ${marks.length}`);
});
