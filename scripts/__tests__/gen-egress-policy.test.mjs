// Tests for scripts/gen-egress-policy.mjs and the real .devcontainer/egress-allowlist.json
// (feature 004, T007). Contract: specs/004-devcontainer-sandbox/contracts/cli.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'gen-egress-policy.mjs');
const REAL_LIST = join(ROOT, '.devcontainer', 'egress-allowlist.json');

const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FORGE_REGISTRY_HOST: '', ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const entry = (domain, group = 'packages', extra = {}) => ({ domain, group, reason: `why ${domain}`, ...extra });
const fixture = (destinations, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'egress-'));
  const file = join(dir, 'list.json');
  writeFileSync(file, JSON.stringify({ destinations, ...extra }, null, 2));
  return { dir, file };
};

test('--check accepts a valid list', () => {
  const { file } = fixture([entry('registry.npmjs.org'), entry('*.data.example.com', 'registry', { cdnRotating: true })]);
  const r = run(['--check', '--file', file]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /2 destinations valid/);
});

for (const [label, bad] of [
  ['an IPv4 literal', entry('10.1.2.3')],
  ['a host:port', entry('example.com:3000')],
  ['a URL', entry('https://example.com/')],
  ['a .ts.net host', entry('forge.tailnet-example.ts.net')],
  ['an unknown group', entry('example.org', 'nonsense')],
  ['an empty reason', { domain: 'example.net', group: 'agent', reason: '  ' }],
  ['a non-boolean cdnRotating', entry('example.io', 'packages', { cdnRotating: 'yes' })],
]) {
  test(`--check rejects ${label}, naming the entry`, () => {
    const { file } = fixture([entry('registry.npmjs.org'), bad]);
    const r = run(['--check', '--file', file]);
    assert.equal(r.code, 1, `expected exit 1 for ${label}`);
    assert.match(r.err, /entry 1\b/, 'must name the offending index');
    if (typeof bad.domain === 'string') assert.ok(r.err.includes(bad.domain.trim()), 'must name the domain');
  });
}

test('--check rejects a duplicate domain', () => {
  const { file } = fixture([entry('github.com', 'source'), entry('GitHub.com', 'source')]);
  const r = run(['--check', '--file', file]);
  assert.equal(r.code, 1);
  assert.match(r.err, /entry 1 .*duplicate of entry 0/);
});

test('--format sbx-policy orders by group, then domain', () => {
  const { file } = fixture([
    entry('zz.example.com', 'packages'),
    entry('b.example.com', 'agent'),
    entry('a.example.com', 'source'),
    entry('a.example.com.au', 'agent'),
  ]);
  const r = run(['--format', 'sbx-policy', '--file', file]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.trim().split('\n'), [
    'allow network a.example.com.au',
    'allow network b.example.com',
    'allow network a.example.com',
    'allow network zz.example.com',
  ]);
});

test('--forge-host appends one line last; absent means no extra line; a quoted host is refused', () => {
  const { file } = fixture([entry('registry.npmjs.org')]);
  assert.deepEqual(run(['--format', 'sbx-policy', '--file', file]).out.trim().split('\n'), ['allow network registry.npmjs.org']);
  const withHost = run(['--format', 'sbx-policy', '--file', file, '--forge-host', 'h.example.test']);
  assert.deepEqual(withHost.out.trim().split('\n'), ['allow network registry.npmjs.org', 'allow network h.example.test']);
  for (const badHost of ['"h.example.test"', 'http://h.example.test', 'h.example.test:3000']) {
    const r = run(['--format', 'sbx-policy', '--file', file, '--forge-host', badHost]);
    assert.equal(r.code, 2, `--forge-host ${badHost} must exit 2`);
  }
});

test('--format ipset-domains prints bare domains', () => {
  const { file } = fixture([entry('registry.npmjs.org')]);
  assert.equal(run(['--format', 'ipset-domains', '--file', file]).out.trim(), 'registry.npmjs.org');
});

test('the tool never writes a file', () => {
  const { dir, file } = fixture([entry('registry.npmjs.org')]);
  const before = readdirSync(dir).sort();
  run(['--check', '--file', file]);
  run(['--format', 'sbx-policy', '--file', file, '--forge-host', 'h.example.test']);
  assert.deepEqual(readdirSync(dir).sort(), before);
});

test('usage errors exit 2', () => {
  assert.equal(run([]).code, 2);
  assert.equal(run(['--check', '--format', 'sbx-policy']).code, 2);
  assert.equal(run(['--bogus']).code, 2);
});

// --- the real list ----------------------------------------------------------------------------

test('the committed allowlist passes --check with exactly 102 destinations', () => {
  const r = run(['--check']);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(readFileSync(REAL_LIST, 'utf8')).destinations.length, 102);
  assert.equal(run(['--format', 'sbx-policy']).out.trim().split('\n').length, 102);
});

test('the movie-metadata API is removed and the removal is recorded', () => {
  const list = JSON.parse(readFileSync(REAL_LIST, 'utf8'));
  assert.equal(list.destinations.some((d) => d.domain === 'api.themoviedb.org'), false);
  const removed = list.$removedFromMcmBaseline ?? {};
  assert.deepEqual(Object.keys(removed).filter((k) => !k.startsWith('$')), ['api.themoviedb.org']);
  assert.ok(String(removed['api.themoviedb.org']?.why ?? '').trim().length > 0, 'the removal needs a reason');
});

test('every string in the allowlist is worded neutrally (no upstream component names or numbers)', () => {
  const neutral = /\bmcm\b|mc-service|movie-mcp|web-api-mcp|spreadsheet-mcp|@mcm\/|\bBFF\b|movie[- ]assistant|\bfeature \d{3}\b|item #\d+|docs\/proposals\//i;
  const strings = [];
  const walk = (v, path) => {
    if (typeof v === 'string') strings.push([path, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { walk(k, `${path}.<key>`); walk(x, `${path}.${k}`); }
  };
  walk(JSON.parse(readFileSync(REAL_LIST, 'utf8')), '$');
  const offenders = strings.filter(([, s]) => neutral.test(s)).map(([p, s]) => `${p}: …${s.match(neutral)[0]}…`);
  assert.deepEqual(offenders, [], `non-neutral wording:\n${offenders.join('\n')}`);
});
