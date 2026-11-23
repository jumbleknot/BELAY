// Tests for the inline-secret gate (scripts/check-no-inline-secrets.mjs).
//
// BELAY's constitution requires a root `compose.yaml` whose secrets are read from files, plus
// per-project compose files. None exists yet; this gate is in place before the first one lands, so
// that first one is gated. A compose file must never hold a credential literally: every secret-shaped
// key, password-bearing URL and command/healthcheck auth argument must be a pure `${VAR}` or
// `${VAR:?message}` reference. An inline `${VAR:-default}` re-introduces the literal and fails.
//
// Runs in CI under `pnpm nx run scripts:test`, so it stays deterministic and offline: every scan runs
// against a throwaway git repository built in a temp dir, through the gate's `--dir <root>` seam,
// never against this checkout.
//
// Credential-looking values are ASSEMBLED FROM FRAGMENTS at run time, so this file never holds one
// contiguously and scripts/secret-scan.mjs has nothing to flag in it. Do not "tidy" them into
// single strings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-no-inline-secrets.mjs');

// A literal that must never appear in the gate's output.
const LITERAL = ['plain', 'text', '-pw-', '7c41'].join('');

const run = (...args) => {
  const res = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
};

/** A git repository holding `files` (path → text), all tracked. Returns the gate's result. */
function scanRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'inline-secrets-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    execFileSync('git', ['add', '-A'], { cwd: dir });
    return run('--dir', dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A compose file with one service `db` whose `environment` map holds `env` (key → raw YAML value). */
const composeWithEnv = (env) =>
  ['services:', '  db:', '    image: postgres:18', '    environment:',
    ...Object.entries(env).map(([k, v]) => `      ${k}: ${v}`), ''].join('\n');

test('a literal credential under a secret-shaped key fails, naming file and key but NOT the value', () => {
  const { status, out } = scanRepo({ 'compose.yaml': composeWithEnv({ POSTGRES_PASSWORD: `'${LITERAL}'` }) });
  assert.equal(status, 1, out);
  assert.match(out, /^compose\.yaml:5: [a-z-]+: /m, `a finding follows <file>:<line>: <rule>: <message>\n${out}`);
  assert.match(out, /POSTGRES_PASSWORD/, 'the finding names the key');
  assert.ok(!out.includes(LITERAL), `the finding must never print the credential\n${out}`);
});

test('the list form of environment (`- KEY=VALUE`) is scanned too', () => {
  const text = ['services:', '  db:', '    environment:', `      - API_TOKEN=${LITERAL}`, ''].join('\n');
  const { status, out } = scanRepo({ 'compose.yaml': text });
  assert.equal(status, 1, out);
  assert.match(out, /API_TOKEN/);
  assert.ok(!out.includes(LITERAL), out);
});

test('a password-bearing URL fails, without printing the password', () => {
  const url = ['postgres', '://app:', LITERAL, '@db:5432/app'].join('');
  const { status, out } = scanRepo({ 'compose.yaml': composeWithEnv({ DATABASE_URL: `'${url}'` }) });
  assert.equal(status, 1, out);
  assert.match(out, /DATABASE_URL/);
  assert.ok(!out.includes(LITERAL), `the URL's password must never be printed\n${out}`);
});

test('a command auth literal (--requirepass) fails', () => {
  const text = ['services:', '  cache:', `    command: ["valkey-server", "--requirepass", "${LITERAL}"]`, ''].join('\n');
  const { status, out } = scanRepo({ 'compose.yaml': text });
  assert.equal(status, 1, out);
  assert.match(out, /cache\.command/);
  assert.ok(!out.includes(LITERAL), out);
});

test('an inline ${VAR:-default} under a secret-shaped key fails — the default is a literal', () => {
  const ref = '${' + 'API_SECRET:-' + LITERAL + '}';
  const { status, out } = scanRepo({ 'compose.yaml': composeWithEnv({ API_SECRET: `'${ref}'` }) });
  assert.equal(status, 1, out);
  assert.match(out, /API_SECRET/);
  assert.ok(!out.includes(LITERAL), out);
});

test('a pure ${VAR} and ${VAR:?msg} pass, in a key and inside a URL', () => {
  const { status, out } = scanRepo({
    'compose.yaml': composeWithEnv({
      POSTGRES_PASSWORD: "'${POSTGRES_PASSWORD}'",
      API_SECRET: "'${API_SECRET:?set it in the stack env file}'",
      DATABASE_URL: "'postgres://app:${PG_PW:?message with spaces}@db:5432/app'",
    }),
  });
  assert.equal(status, 0, out);
});

test('*_FILE, *_USER and *_CLIENT_ID keys are not credentials and pass', () => {
  const { status, out } = scanRepo({
    'compose.yaml': composeWithEnv({
      POSTGRES_PASSWORD_FILE: '/run/secrets/postgres_password',
      TOKEN_SERVICE_USER: 'app',
      OIDC_TOKEN_CLIENT_ID: 'belay-app',
    }),
  });
  assert.equal(status, 0, out);
});

test('compose files are found anywhere in the tree, under every compose name', () => {
  const bad = composeWithEnv({ POSTGRES_PASSWORD: `'${LITERAL}'` });
  const { status, out } = scanRepo({
    'compose.yaml': 'services: {}\n',
    'backend/example-service/compose.override.yml': bad,
    'infrastructure-as-code/docker/docker-compose.dev.yaml': bad,
    'notes/not-compose.yaml': bad, // not a compose file name: out of scope
  });
  assert.equal(status, 1, out);
  assert.match(out, /backend\/example-service\/compose\.override\.yml:5:/);
  assert.match(out, /infrastructure-as-code\/docker\/docker-compose\.dev\.yaml:5:/);
  assert.ok(!out.includes('not-compose.yaml'), `a non-compose YAML is not scanned\n${out}`);
});

test('an untracked compose file is not scanned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inline-secrets-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, 'compose.yaml'), composeWithEnv({ POSTGRES_PASSWORD: `'${LITERAL}'` }));
    const { status, out } = run('--dir', dir);
    assert.equal(status, 0, out);
    assert.match(out, /\b0 compose file/, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tree with ZERO compose files exits 0 and prints a count of 0', () => {
  const { status, out } = scanRepo({ 'README.md': '# nothing to compose\n' });
  assert.equal(status, 0, out);
  assert.match(out, /\b0 compose file/, `a scan of nothing must say so\n${out}`);
});

test('a clean tree prints how many compose files it scanned', () => {
  const { status, out } = scanRepo({
    'compose.yaml': composeWithEnv({ POSTGRES_PASSWORD_FILE: '/run/secrets/pw' }),
    'backend/example-service/compose.yaml': 'services: {}\n',
  });
  assert.equal(status, 0, out);
  assert.match(out, /\b2 compose file/, out);
});

test('an unparseable compose file exits 2 rather than being skipped', () => {
  const { status, out } = scanRepo({ 'compose.yaml': 'services:\n  db: [unclosed\n' });
  assert.equal(status, 2, out);
  assert.match(out, /compose\.yaml/);
});

test('--dir on a directory that is not a git work tree exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inline-secrets-nogit-'));
  try {
    const { status, out } = run('--dir', dir);
    assert.equal(status, 2, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown flag exits 2', () => {
  const { status, out } = run('--nope');
  assert.equal(status, 2, out);
});

test('--dir with no directory exits 2', () => {
  const { status, out } = run('--dir');
  assert.equal(status, 2, out);
});

test('--help prints usage and exits 0', () => {
  const { status, out } = run('--help');
  assert.equal(status, 0, out);
  assert.match(out, /Usage: check-no-inline-secrets\.mjs/);
});

test('--selftest proves detection on planted input and exits 0', () => {
  const { status, out } = run('--selftest');
  assert.equal(status, 0, out);
});

test('the live tree passes and prints its count', () => {
  const { status, out } = run();
  assert.equal(status, 0, out);
  assert.match(out, /\b\d+ compose file/, out);
});
