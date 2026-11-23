// Guard for .devcontainer/toolchain.Dockerfile (feature 004, T005).
// Pins research R5 (slim contents, versions in step with the repo) and R6 (coder is uid 1000,
// created before any heavy layer).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const dockerfile = () => read('.devcontainer/toolchain.Dockerfile');
// Instruction lines only: comments explain why things are ABSENT, and must not trip the absence checks.
const instructions = () => dockerfile().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('base image is node:26-bookworm pinned by digest, in step with CI', () => {
  const from = instructions().match(/^FROM\s+(\S+)/m)?.[1] ?? '';
  const m = from.match(/^node:(\d+)-bookworm@sha256:[0-9a-f]{64}$/);
  assert.ok(m, `first FROM must be node:<major>-bookworm@sha256:<64 hex>, got ${from}`);
  const ci = read('.forgejo/workflows/guardrails.yml').match(/node-version:\s*['"]?(\d+)\./)?.[1];
  assert.equal(m[1], ci, 'image Node major must equal the guardrails setup-node major');
});

test('the Spec Kit CLI is pinned to the version the repo was initialised with', () => {
  const pinned = instructions().match(/^ARG SPECKIT_VERSION=(\S+)/m)?.[1];
  const repo = JSON.parse(read('.specify/init-options.json')).speckit_version;
  assert.equal(pinned, `v${repo}`);
});

test('coder is created at uid 1000, after node moves aside, before any rustup layer', () => {
  const text = instructions();
  const usermod = text.indexOf('usermod -u 1100 node');
  const useradd = text.search(/useradd[^\n]*-u "\$\{USER_UID\}"/);
  const rustup = text.indexOf('rustup');
  assert.ok(usermod >= 0 && useradd >= 0 && rustup >= 0, 'usermod, useradd and rustup must all be present');
  assert.match(text, /^ARG USER_UID=1000$/m);
  assert.ok(usermod < useradd && useradd < rustup, 'the renumber must precede the heavy layers (copy-up cost)');
});

test('rust is minimal, pwsh is pinned with its ICU dependency explicit', () => {
  const text = instructions();
  assert.match(text, /--profile minimal/);
  assert.match(text, /^ARG POWERSHELL_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(text, /libicu72/);
});

test('pnpm is installed from package.json at the tail', () => {
  const lines = instructions().split('\n');
  const copies = lines.map((l, i) => [l, i]).filter(([l]) => /^COPY\s/.test(l));
  assert.ok(copies.length > 0, 'no COPY');
  const [last, at] = copies[copies.length - 1];
  assert.match(last, /^COPY package\.json scripts\/install-pnpm\.sh /);
  const nextRun = lines.slice(at + 1).find((l) => /^RUN\s/.test(l)) ?? '';
  assert.match(nextRun, /install-pnpm\.sh/);
});

test('no app-stack, emulator or personal tools are baked in', () => {
  const text = instructions().toLowerCase();
  for (const word of ['android', 'gradle', 'openwiki', 'cargo install', 'iptables', 'docker-compose', 'rtk']) {
    assert.equal(text.includes(word), false, `toolchain.Dockerfile must not contain "${word}"`);
  }
});

test('no ENV or ARG carries a credential-shaped name', () => {
  const names = [...instructions().matchAll(/^(?:ENV|ARG)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map((m) => m[1]);
  const env = [...instructions().matchAll(/^ENV\s+(.+)$/gm)].flatMap((m) => [...m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)=/g)].map((x) => x[1]));
  for (const n of [...names, ...env]) assert.doesNotMatch(n, /TOKEN|SECRET|PASSWORD|API_KEY/, n);
});
