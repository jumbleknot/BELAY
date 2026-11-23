// Guard for .devcontainer/devcontainer.json (feature 004, T003).
//
// Each assertion pins a measured reason from MovieCollectionManager's sandbox dev container
// (specs/004-devcontainer-sandbox/research.md R3). A failure here means a load-bearing setting
// changed: update the guard at the cause only if the premise changed, never to make it pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonc } from './jsonc.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DC_DIR = join(ROOT, '.devcontainer');
const CONFIG = join(DC_DIR, 'devcontainer.json');

const load = () => readJsonc(CONFIG);

test('builds from the thin Dockerfile with the pin passed as a build arg', () => {
  const c = load();
  assert.equal(c.build?.dockerfile, 'Dockerfile');
  // ${localEnv:VAR:default} truncates a default at its first colon, so the default is colon-free.
  assert.equal(c.build?.args?.BASE_IMAGE, '${localEnv:BELAY_DEVCONTAINER_IMAGE:belay-devcontainer}');
});

test('uses the VM engine through docker-outside-of-docker, without the standalone compose download', () => {
  const c = load();
  const key = Object.keys(c.features ?? {}).find((k) => k.includes('/docker-outside-of-docker:'));
  assert.ok(key, 'docker-outside-of-docker feature missing');
  assert.match(key, /^ghcr\.io\/devcontainers\/features\/docker-outside-of-docker:1$/);
  assert.equal(c.features[key].moby, true);
  assert.equal(c.features[key].dockerDashComposeVersion, 'none');
  const others = Object.keys(c.features).filter((k) => k !== key);
  assert.deepEqual(others, [], 'no other features (docker-in-docker in particular is the retired path)');
});

test('runArgs: host network, restart always, a 5 GiB memory cap, and the secrets env-file', () => {
  const args = load().runArgs ?? [];
  for (const a of ['--network=host', '--restart=always', '--memory=5g', '--memory-swap=5g']) {
    assert.ok(args.includes(a), `runArgs lacks ${a}`);
  }
  const i = args.indexOf('--env-file');
  assert.ok(i >= 0, 'runArgs lacks --env-file');
  assert.equal(args[i + 1], '${localEnv:HOME}/.belay-devcontainer-secrets.env');
});

test('runs as coder, renumbered to the workspace owner, with no hard-coded workspace and no capabilities', () => {
  const c = load();
  assert.equal(c.remoteUser, 'coder');
  assert.equal(c.updateRemoteUserUID, true);
  for (const k of ['workspaceMount', 'workspaceFolder', 'capAdd', 'privileged', 'forwardPorts']) {
    assert.equal(k in c, false, `${k} must be omitted (research R3)`);
  }
});

test('mounts exactly the three persistent volumes from the data model', () => {
  const mounts = (load().mounts ?? []).map((m) => (typeof m === 'string' ? m : JSON.stringify(m)));
  assert.deepEqual(mounts.sort(), [
    'source=belay-claude,target=/home/coder/.claude,type=volume',
    'source=belay-commandhistory,target=/commandhistory,type=volume',
    'source=belay-pnpm-store,target=/home/coder/.local/share/pnpm/store,type=volume',
  ]);
});

test('containerEnv holds exactly the non-secret keys: no credential, no ANTHROPIC_API_KEY', () => {
  const env = load().containerEnv ?? {};
  assert.deepEqual(Object.keys(env).sort(), [
    'BELAY_DEVCONTAINER',
    'BELAY_DEVCONTAINER_PLATFORM',
    'CLAUDE_CONFIG_DIR',
    'DEVCONTAINER_PERSONAL_LAYER',
    'DOCKER_CONFIG',
    'DOCKER_HOST',
    'FORGE_REGISTRY_HOST',
    'GH_CONFIG_DIR',
  ]);
  // gh keeps its login in ~/.config/gh, on the ephemeral overlay: measured 2026-11-23, a recreate
  // logged gh out while Claude Code stayed logged in. Put it on the belay-claude volume.
  assert.equal(env.GH_CONFIG_DIR, '/home/coder/.claude/gh');
  assert.equal(env.DOCKER_HOST, 'unix:///var/run/docker-host.sock');
  assert.equal(env.DOCKER_CONFIG, '/home/coder/.docker-sandbox');
  assert.equal(env.CLAUDE_CONFIG_DIR, '/home/coder/.claude');
  assert.equal(env.BELAY_DEVCONTAINER, '1');
  assert.equal(env.BELAY_DEVCONTAINER_PLATFORM, 'sandbox');
  assert.equal(env.DEVCONTAINER_PERSONAL_LAYER, '1');
  assert.equal(env.FORGE_REGISTRY_HOST, '${localEnv:FORGE_REGISTRY_HOST}');
});

test('lifecycle commands run the committed scripts in the designed order', () => {
  const c = load();
  const scripts = (cmd) => [...String(cmd ?? '').matchAll(/\.devcontainer\/([\w-]+\.sh)/g)].map((m) => m[1]);
  assert.deepEqual(scripts(c.initializeCommand), ['check-image-pin.sh', 'gen-container-secrets-env.sh'],
    'the pin check must run before the secrets file is written (research R7)');
  assert.deepEqual(scripts(c.onCreateCommand), ['fix-workspace-ownership.sh', 'persist-claude-config.sh']);
  assert.deepEqual(scripts(c.postCreateCommand), ['ensure-rtk-hook.sh']);
  assert.match(String(c.postCreateCommand), /pnpm install --config\.confirmModulesPurge=false/);
  assert.deepEqual(scripts(c.postStartCommand), ['fix-workspace-ownership.sh', 'assert-egress-governed.sh']);
  for (const s of new Set([c.initializeCommand, c.onCreateCommand, c.postCreateCommand, c.postStartCommand].flatMap(scripts))) {
    assert.ok(existsSync(join(DC_DIR, s)), `.devcontainer/${s} does not exist`);
  }
});

test('the config never names MovieCollectionManager', () => {
  assert.doesNotMatch(readFileSync(CONFIG, 'utf8'), /mcm/i);
});

test('the thin Dockerfile only parametrizes the base image', () => {
  const lines = readFileSync(join(DC_DIR, 'Dockerfile'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, ['ARG BASE_IMAGE=belay-devcontainer', 'FROM ${BASE_IMAGE}']);
});
