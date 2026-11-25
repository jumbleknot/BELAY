// The stdio entry point (US5-AC2, FR-004, FR-018): a missing setting stops the server at startup with a
// message naming that setting, and the token is never printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANARY } from './helpers/fixtures.mjs';

const ENTRY = fileURLToPath(new URL('../../src/server.mjs', import.meta.url));
const cloneRoot = mkdtempSync(join(tmpdir(), 'pdlc-startup-'));
test.after(() => rmSync(cloneRoot, { recursive: true, force: true }));

const settings = () => ({
  PDLC_FORGE_URL: 'https://forge.example',
  PDLC_FORGE_OWNER: 'operator',
  PDLC_FORGE_TOKEN: CANARY,
  PDLC_CLONE_ROOT: cloneRoot,
});

function start(env) {
  return new Promise((resolve) => {
    const base = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT };
    const child = spawn(process.execPath, [ENTRY], { env: { ...base, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); resolve({ code: null, timedOut: true, stdout, stderr }); }, 5000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, timedOut: false, stdout, stderr }); });
  });
}

for (const variable of ['PDLC_FORGE_URL', 'PDLC_FORGE_OWNER', 'PDLC_FORGE_TOKEN', 'PDLC_CLONE_ROOT']) {
  test(`without ${variable} the server exits non-zero within 5 s, naming it, and never prints the token`, async () => {
    const env = settings();
    delete env[variable];
    const r = await start(env);
    assert.equal(r.timedOut, false, `still running after 5 s; stderr: ${r.stderr}`);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, new RegExp(variable));
    assert.doesNotMatch(r.stdout + r.stderr, /canary-/);
    assert.equal(r.stdout, '', 'stdout is the protocol stream: nothing is written there on a startup failure');
    for (const line of r.stderr.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line), `a JSON log line: ${line}`);
  });
}
