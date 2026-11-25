// Configuration from the environment (data-model.md Configuration; US5-AC2, FR-004, FR-018). A missing
// or invalid value names the variable, and the token is never echoed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, ConfigError } from '../../src/config.mjs';

const CANARY = 'canary-0123456789abcdef0123456789abcdef';
const root = mkdtempSync(join(tmpdir(), 'pdlc-config-'));
test.after(() => rmSync(root, { recursive: true, force: true }));

const valid = () => ({
  PDLC_FORGE_URL: 'https://forge.example',
  PDLC_FORGE_OWNER: 'operator',
  PDLC_FORGE_TOKEN: CANARY,
  PDLC_CLONE_ROOT: root,
});

const refusal = (env, variable, reason) => {
  let error;
  try { loadConfig(env); } catch (e) { error = e; }
  assert.ok(error instanceof ConfigError, `expected a ConfigError for ${variable}`);
  assert.equal(error.variable, variable);
  assert.match(error.message, new RegExp(variable));
  if (reason) assert.match(error.message, reason);
  assert.doesNotMatch(error.message, /canary-/);
  return error;
};

test('a valid environment gives a frozen config with the derived apiBase', () => {
  const c = loadConfig(valid());
  assert.deepEqual({ ...c }, {
    forgeUrl: 'https://forge.example', owner: 'operator', token: CANARY, cloneRoot: root,
    apiBase: 'https://forge.example/api/v1',
  });
  assert.ok(Object.isFrozen(c));
});

test('the forge URL scheme is taken as written (http over the tailnet is allowed), and a trailing / is dropped', () => {
  const c = loadConfig({ ...valid(), PDLC_FORGE_URL: 'http://forge.tailnet-name.example:3000/' });
  assert.equal(c.forgeUrl, 'http://forge.tailnet-name.example:3000');
  assert.equal(c.apiBase, 'http://forge.tailnet-name.example:3000/api/v1');
});

test('each variable, when missing or blank, is named', () => {
  for (const v of ['PDLC_FORGE_URL', 'PDLC_FORGE_OWNER', 'PDLC_FORGE_TOKEN', 'PDLC_CLONE_ROOT']) {
    const env = valid(); delete env[v];
    refusal(env, v);
    refusal({ ...valid(), [v]: '   ' }, v);
  }
});

test('the forge URL must be http(s), with no path, query or fragment', () => {
  for (const bad of ['ftp://forge.example', 'forge.example', 'https://forge.example/sub', 'https://forge.example/?q=1', 'https://forge.example/#x', 'not a url']) {
    refusal({ ...valid(), PDLC_FORGE_URL: bad }, 'PDLC_FORGE_URL');
  }
});

test('a forge URL with userinfo is refused without echoing it', () => {
  const e = refusal({ ...valid(), PDLC_FORGE_URL: `https://someone:${CANARY}@forge.example` }, 'PDLC_FORGE_URL', /userinfo/);
  assert.doesNotMatch(e.message, /someone/);
});

test('the owner must be forge user-name characters', () => {
  for (const bad of ['two words', 'a/b', '-lead', 'x;y']) refusal({ ...valid(), PDLC_FORGE_OWNER: bad }, 'PDLC_FORGE_OWNER');
  assert.equal(loadConfig({ ...valid(), PDLC_FORGE_OWNER: 'Some.User_1-x' }).owner, 'Some.User_1-x');
});

test('the token is trimmed, and its value never appears in any error', () => {
  assert.equal(loadConfig({ ...valid(), PDLC_FORGE_TOKEN: `  ${CANARY}\n` }).token, CANARY);
  const e = refusal({ ...valid(), PDLC_CLONE_ROOT: 'relative/path', PDLC_FORGE_TOKEN: CANARY }, 'PDLC_CLONE_ROOT');
  assert.doesNotMatch(String(e.stack), /canary-/);
});

test('the clone root must be absolute and exist as a directory', () => {
  refusal({ ...valid(), PDLC_CLONE_ROOT: 'relative/path' }, 'PDLC_CLONE_ROOT', /absolute/);
  refusal({ ...valid(), PDLC_CLONE_ROOT: join(root, 'missing') }, 'PDLC_CLONE_ROOT', /does not exist/);
  const file = join(root, 'a-file');
  writeFileSync(file, 'x');
  refusal({ ...valid(), PDLC_CLONE_ROOT: file }, 'PDLC_CLONE_ROOT', /not a directory/);
});
