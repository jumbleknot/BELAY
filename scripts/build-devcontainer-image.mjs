#!/usr/bin/env node
// build-devcontainer-image.mjs — feature 004
//
// Builds .devcontainer/toolchain.Dockerfile locally, tagged `belay-devcontainer` (the colon-free
// default the thin .devcontainer/Dockerfile falls back to when no pin is set). The normal path is
// the devcontainer-image workflow, which publishes a digest-pinned image; this is the path that
// needs neither the registry nor CI.
//
// ⚠️ IT NEEDS AN ENGINE WITH OPEN EGRESS: CI, or a host engine such as Docker Desktop. Never run it
// inside the sandbox: the build fetches rustup from hosts the egress allowlist deliberately does
// not carry (research R5), and fails there.
//
// Also available as `pnpm nx run scripts:build-devcontainer-image`.
// Exit codes: 0 built · 1 the build failed · 2 usage error, missing Dockerfile, or no docker.
// Contract: specs/004-devcontainer-sandbox/contracts/cli.md.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = resolve(REPO_ROOT, '.devcontainer/toolchain.Dockerfile');
const DEFAULT_TAG = 'belay-devcontainer'; // colon-free: ${localEnv:VAR:default} truncates at a colon

const USAGE = `Usage: node scripts/build-devcontainer-image.mjs [--tag <ref>]

Builds .devcontainer/toolchain.Dockerfile from the repository root, tagged ${DEFAULT_TAG}.
Needs an engine with open egress (CI, or a host engine such as Docker Desktop): never run it inside
the sandbox. The normal path is the devcontainer-image workflow (docs/runbooks/devcontainer.md).`;

function fail(code, msg) {
  console.error(`build-devcontainer-image: ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  let tag = DEFAULT_TAG;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tag') {
      tag = argv[++i];
      if (!tag) fail(2, '--tag requires a value');
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      fail(2, `unknown argument: ${argv[i]}`);
    }
  }
  return { tag };
}

function main() {
  const { tag } = parseArgs(process.argv.slice(2));
  if (!existsSync(DOCKERFILE)) fail(2, `missing ${DOCKERFILE}`);

  // shell: true on Windows so a docker.cmd / docker.exe on PATH both resolve.
  const shell = process.platform === 'win32';
  const dv = spawnSync('docker', ['--version'], { encoding: 'utf8', shell });
  if (dv.status !== 0) fail(2, 'docker not found on PATH, or not answering: install or start a container engine');

  console.log(`build-devcontainer-image: building ${tag} from .devcontainer/toolchain.Dockerfile`);
  const build = spawnSync('docker', ['build', '-f', DOCKERFILE, '-t', tag, REPO_ROOT], { stdio: 'inherit', shell });
  if (build.status !== 0) fail(1, `docker build failed (exit ${build.status ?? 'signal'})`);

  console.log(`build-devcontainer-image: done — ${tag} ready.`);
  console.log('build-devcontainer-image: with no BELAY_DEVCONTAINER_IMAGE pin, `devcontainer up` uses this local image (check-image-pin.sh will say so).');
}

main();
