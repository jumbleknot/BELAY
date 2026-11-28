#!/usr/bin/env node
// pdlc:integration-forge (research R16): the real forge and the real `ci-smoke` repository (M3), never
// mocked, operator-run in the dev container and never in CI.
//
// The credential is mapped at the POINT OF USE: the dev container's FORGE_ISSUE_TOKEN has feature 014's
// pdlc scope (write:issue + read:repository; 016 widened the pdlc token to write:repository), so it becomes
// PDLC_FORGE_TOKEN for this child only. When
// it is unset the run FAILS, naming it: a live tier that skips reads as a pass.
//
// The forge URL and owner come from this working copy's origin remote, so no host is written down here.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgeEndpoint } from '../../../../scripts/ci-status.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const token = process.env.FORGE_ISSUE_TOKEN;
if (typeof token !== 'string' || token.trim() === '') {
  console.error('✗ pdlc:integration-forge: FORGE_ISSUE_TOKEN is not set. This tier runs against the real forge and fails rather than skips without it; see docs/runbooks/pdlc.md.');
  process.exit(1);
}

const { base, owner } = forgeEndpoint();
const forgeUrl = base.replace(/\/api\/v1$/, '');
const files = readdirSync(here).filter((f) => f.endsWith('.forge.test.mjs')).map((f) => join(here, f));
const env = { ...process.env, PDLC_FORGE_URL: forgeUrl, PDLC_FORGE_OWNER: owner, PDLC_FORGE_TOKEN: token.trim(), PDLC_IT_RUN_ID: Date.now().toString(36) };
for (const k of ['NODE_TEST_CONTEXT', 'NODE_TEST_WORKER_ID']) delete env[k];
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
