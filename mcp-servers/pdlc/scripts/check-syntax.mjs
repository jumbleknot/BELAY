#!/usr/bin/env node
// The pdlc:lint syntax step: `node --check` on every module under src/ and scripts/. The server has
// no build step, so a syntax error would otherwise first surface when Claude Desktop starts it.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['src', 'scripts'].flatMap((dir) =>
  readdirSync(join(root, dir)).filter((f) => f.endsWith('.mjs')).map((f) => join(root, dir, f)));
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
if (failed) {
  console.error(`✗ pdlc syntax check: ${failed} of ${files.length} module(s) failed node --check`);
  process.exit(1);
}
console.log(`✓ pdlc syntax check: ${files.length} module(s) pass node --check`);
