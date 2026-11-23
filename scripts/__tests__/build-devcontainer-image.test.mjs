// Tests for scripts/build-devcontainer-image.mjs (feature 004, T015).
// A stub `docker` on PATH records its arguments, so the command is checked without building.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'build-devcontainer-image.mjs');

// A node-based docker stub works on every platform: a `.cmd` shim on Windows, a shell shim elsewhere.
function stubDocker({ fail = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docker-stub-'));
  const log = join(dir, 'calls.log');
  const impl = join(dir, 'docker-impl.mjs');
  writeFileSync(impl, `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(${fail ? 1 : 0});\n`);
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'docker.cmd'), `@"${process.execPath}" "${impl}" %*\r\n`);
  } else {
    writeFileSync(join(dir, 'docker'), `#!/bin/sh\nexec "${process.execPath}" "${impl}" "$@"\n`);
    chmodSync(join(dir, 'docker'), 0o755);
  }
  return { dir, calls: () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) };
}

const run = (args, path) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(path !== undefined ? { PATH: path, Path: path } : {}) },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('--help exits 0, prints usage, and says it needs open egress', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Usage: node scripts\/build-devcontainer-image\.mjs/);
  assert.match(r.out, /open egress/);
});

test('an unknown argument and a --tag with no value exit 2', () => {
  assert.equal(run(['--bogus']).code, 2);
  assert.equal(run(['--tag']).code, 2);
});

test('a docker that cannot answer exits 2 with "docker not found"', () => {
  const stub = stubDocker({ fail: true });
  const r = run([], stub.dir);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /docker not found/);
});

test('builds toolchain.Dockerfile from the repository root, tagged belay-devcontainer by default', () => {
  const stub = stubDocker();
  const r = run([], `${stub.dir}${delimiter}${process.env.PATH}`);
  assert.equal(r.code, 0, r.out);
  const build = stub.calls().find((a) => a[0] === 'build');
  assert.deepEqual(build, ['build', '-f', join(ROOT, '.devcontainer', 'toolchain.Dockerfile'), '-t', 'belay-devcontainer', ROOT]);
});

test('--tag overrides the tag', () => {
  const stub = stubDocker();
  run(['--tag', 'belay-devcontainer-test'], `${stub.dir}${delimiter}${process.env.PATH}`);
  const build = stub.calls().find((a) => a[0] === 'build');
  assert.equal(build[build.indexOf('-t') + 1], 'belay-devcontainer-test');
});
