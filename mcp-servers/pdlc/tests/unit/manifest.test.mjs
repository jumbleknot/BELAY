// The Claude Desktop Extension manifest (research R12; US5-AC1, FR-001, FR-004). Its `tools` array is
// declarative, so it is held to the same contract as tools/list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOL_NAMES } from '../../src/tool-contract.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('manifest_version is "0.3" and every required field is present', () => {
  assert.equal(manifest.manifest_version, '0.3');
  for (const k of ['name', 'version', 'description', 'author', 'server']) assert.ok(manifest[k], k);
  assert.equal(manifest.name, 'pdlc');
  assert.ok(manifest.author.name);
});

test('the server is node, with entry_point src/server.mjs, launched from the unpacked bundle', () => {
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'src/server.mjs');
  assert.equal(manifest.server.mcp_config.command, 'node');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/src/server.mjs']);
});

test('four required user_config entries: forge_token sensitive, clone_root a directory', () => {
  const uc = manifest.user_config;
  assert.deepEqual(Object.keys(uc).sort(), ['clone_root', 'forge_owner', 'forge_token', 'forge_url']);
  for (const [k, v] of Object.entries(uc)) {
    assert.equal(v.required, true, k);
    assert.ok(v.title && v.description, k);
  }
  assert.equal(uc.forge_token.type, 'string');
  assert.equal(uc.forge_token.sensitive, true);
  assert.equal(uc.clone_root.type, 'directory');
  assert.equal(uc.forge_url.type, 'string');
  assert.equal(uc.forge_owner.type, 'string');
  for (const k of ['forge_url', 'forge_owner', 'clone_root']) assert.notEqual(uc[k].sensitive, true, k);
});

test('mcp_config.env maps each entry to its PDLC_* variable, and nothing else', () => {
  assert.deepEqual(manifest.server.mcp_config.env, {
    PDLC_FORGE_URL: '${user_config.forge_url}',
    PDLC_FORGE_OWNER: '${user_config.forge_owner}',
    PDLC_FORGE_TOKEN: '${user_config.forge_token}',
    PDLC_CLONE_ROOT: '${user_config.clone_root}',
  });
});

test('the tools array names exactly the contract\'s tools', () => {
  assert.deepEqual(manifest.tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
  for (const t of manifest.tools) assert.ok(t.description, t.name);
});

test('compatibility is win32 only', () => {
  assert.deepEqual(manifest.compatibility.platforms, ['win32']);
});

test('runtimes.node is the server\'s engines floor, and the Node Claude Desktop bundles satisfies it', () => {
  // T006, measured on the Windows host 2026-11-25 (research R12): the extension ran on Claude Desktop's
  // own runtime (process.execPath was Claude.exe in its MSIX package), at Node v24.22.3.
  const MEASURED_BUNDLED_NODE = 'v24.22.3';
  const range = manifest.compatibility.runtimes?.node;
  assert.equal(range, `${pkg.engines.node}.0.0`);
  const floor = Number(/^>=(\d+)\.0\.0$/.exec(range)?.[1]);
  assert.ok(Number.isInteger(floor), `a plain ">=N.0.0" floor, got ${range}`);
  assert.ok(Number(MEASURED_BUNDLED_NODE.slice(1).split('.')[0]) >= floor, `${MEASURED_BUNDLED_NODE} meets ${range}`);
});

test('the manifest version equals package.json\'s', () => {
  assert.equal(manifest.version, pkg.version);
});
