// scripts/install-pnpm.sh (item #79): on the shared host runner, pnpm goes into a JOB-PRIVATE prefix,
// never the shared tool cache. On 2026-11-25 a global install from BELAY's host job changed pnpm for
// every other project on that host (MovieCollectionManager's jobs failed their pnpm version check).
// npm and pnpm are faked: the test asserts WHERE the install goes and WHICH pnpm is verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'install-pnpm.sh');
const NODE_DIR = dirname(process.execPath);

// A fake npm that logs its argv and "installs" a pnpm printing the requested version, into
// <--prefix>/bin when given, else into the fake global bin (standing in for the shared tool cache).
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'install-pnpm-'));
  const fakebin = join(dir, 'fakebin');
  const globalBin = join(dir, 'shared-global-bin');
  mkdirSync(fakebin); mkdirSync(globalBin);
  writeFileSync(join(fakebin, 'npm'), `#!/bin/sh
echo "$*" >> "${dir}/npm.log"
prefix=''; spec=''
while [ $# -gt 0 ]; do case "$1" in --prefix) prefix="$2"; shift 2;; pnpm@*) spec="$1"; shift;; *) shift;; esac; done
bin="${globalBin}"; [ -n "$prefix" ] && bin="$prefix/bin"
mkdir -p "$bin"
printf '#!/bin/sh\\necho %s\\n' "\${spec#pnpm@}" > "$bin/pnpm"; chmod +x "$bin/pnpm"
`);
  chmodSync(join(fakebin, 'npm'), 0o755);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.22.0' }));
  return { dir, globalBin, PATH: `${fakebin}:${globalBin}:${NODE_DIR}:/usr/bin:/bin` };
}
const run = (sb, env = {}) => spawnSync('sh', [SCRIPT, join(sb.dir, 'package.json')], { encoding: 'utf8', env: { PATH: sb.PATH, HOME: sb.dir, ...env } });

test('install-pnpm: with PNPM_PREFIX, installs under it and never into the shared global bin', () => {
  const sb = sandbox();
  const prefix = join(sb.dir, 'job-private');
  const r = run(sb, { PNPM_PREFIX: prefix });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(sb.dir, 'npm.log'), 'utf8'), new RegExp(`--prefix ${prefix} `));
  assert.ok(existsSync(join(prefix, 'bin', 'pnpm')));
  assert.equal(existsSync(join(sb.globalBin, 'pnpm')), false, 'the shared global bin was written');
  assert.match(r.stdout, new RegExp(`${prefix}/bin/pnpm \\(12\\.22\\.0\\)`), 'the verified pnpm is not the private one');
});

test('install-pnpm: with PNPM_PREFIX, later steps get the private bin through GITHUB_PATH', () => {
  const sb = sandbox();
  const prefix = join(sb.dir, 'job-private');
  const ghPath = join(sb.dir, 'github_path');
  writeFileSync(ghPath, '');
  assert.equal(run(sb, { PNPM_PREFIX: prefix, GITHUB_PATH: ghPath }).status, 0);
  assert.equal(readFileSync(ghPath, 'utf8'), `${prefix}/bin\n`);
});

test('install-pnpm: the private pnpm wins over a different pnpm already in the shared global bin', () => {
  const sb = sandbox();
  writeFileSync(join(sb.globalBin, 'pnpm'), '#!/bin/sh\necho 12.21.0\n'); chmodSync(join(sb.globalBin, 'pnpm'), 0o755);
  const r = run(sb, { PNPM_PREFIX: join(sb.dir, 'job-private') });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(sb.globalBin, 'pnpm'), 'utf8'), '#!/bin/sh\necho 12.21.0\n', 'the shared pnpm was changed');
});

test('install-pnpm: a relative PNPM_PREFIX is refused (exit 2) before anything is installed', () => {
  const sb = sandbox();
  const r = run(sb, { PNPM_PREFIX: 'relative/dir' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PNPM_PREFIX must be an absolute path/);
  assert.equal(existsSync(join(sb.dir, 'npm.log')), false);
});

test('install-pnpm: without PNPM_PREFIX (throwaway containers), the global install is unchanged', () => {
  const sb = sandbox();
  const r = run(sb);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(readFileSync(join(sb.dir, 'npm.log'), 'utf8'), /--prefix/);
  assert.ok(existsSync(join(sb.globalBin, 'pnpm')));
});
