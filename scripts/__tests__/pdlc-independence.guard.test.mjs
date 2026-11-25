// FR-035 / SC-010: nothing BELAY runs may depend on the pdlc server. The backlog tooling, Spec Kit and
// the skills must work identically whether or not the server is installed, so none of them may import
// or run its code, call one of its tools, or check whether it is present. The SHARED CONTRACT
// (mcp-servers/pdlc/contract/) is not the server: backlog.mjs's labels are guarded against it by a test.
//
// Scanned: scripts/*.mjs, scripts/lib/, .specify/, .claude/skills/, .forgejo/issue_template/.
// Not scanned: scripts/__tests__/ (tests may read the contract) and mcp-servers/ (the server itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEXT = /\.(mjs|cjs|js|md|ya?ml|json|ps1|sh|toml|txt)$/;

/** What counts as depending on the server. Each pattern says why, for the failure message. */
const DEPENDENCIES = [
  { re: /mcp-servers[\\/]+pdlc[\\/]+src\b/, why: 'imports or runs the server\'s code' },
  { re: /mcp__pdlc__/, why: 'calls one of the server\'s tools' },
  { re: /mcp-servers[\\/]+pdlc(?![\\/]+contract\b)(?:[\\/'"`\s)]|$)/m, why: 'refers to the server\'s folder (a presence check, or a path into it), not to its shared contract' },
  { re: /claude\s+mcp\s+(?:list|get)\b[^\n]*\bpdlc\b/i, why: 'checks whether the server is installed' },
];

/** The files the guard scans, relative to `root`. */
export function scannedFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(rel); }
      else if (TEXT.test(e.name)) out.push(rel.replace(/\\/g, '/'));
    }
  };
  try {
    for (const f of readdirSync(join(root, 'scripts'))) if (f.endsWith('.mjs') && statSync(join(root, 'scripts', f)).isFile()) out.push(`scripts/${f}`);
  } catch { /* no scripts/ */ }
  for (const dir of ['scripts/lib', '.specify', '.claude/skills', '.forgejo/issue_template']) walk(dir);
  return out.sort();
}

/** @returns {{file: string, line: number, why: string}[]} every dependency on the server under `root` */
export function findPdlcDependencies(root) {
  const hits = [];
  for (const file of scannedFiles(root)) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    lines.forEach((text, i) => {
      for (const { re, why } of DEPENDENCIES) if (re.test(text)) hits.push({ file, line: i + 1, why });
    });
  }
  return hits;
}

const describe = (hits) => hits.map((h) => `${h.file}:${h.line} ${h.why}`).join('\n');

test('nothing BELAY runs depends on the pdlc server', () => {
  const files = scannedFiles(ROOT);
  assert.ok(files.includes('scripts/backlog.mjs') && files.some((f) => f.startsWith('.claude/skills/')), 'the guard is scanning the real tree');
  assert.deepEqual(findPdlcDependencies(ROOT), [], describe(findPdlcDependencies(ROOT)));
});

test('the matcher catches a planted import, tool call and presence check, naming the file', () => {
  const root = mkdtempSync(join(tmpdir(), 'pdlc-independence-'));
  try {
    const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
    put('scripts/backlog.mjs', `${readFileSync(join(ROOT, 'scripts', 'backlog.mjs'), 'utf8')}\nimport '../mcp-servers/pdlc/src/tools.mjs';\n`);
    put('.claude/skills/x/SKILL.md', 'Then call `mcp__pdlc__create_proposal`.\n');
    put('.specify/scripts/check.sh', 'test -d mcp-servers/pdlc || exit 1\n');
    put('scripts/lib/probe.mjs', "execFileSync('claude', ['mcp', 'list']); // claude mcp list | grep pdlc\n");
    put('scripts/__tests__/reads-contract.test.mjs', "readFileSync('mcp-servers/pdlc/src/x.mjs')\n");
    put('.forgejo/issue_template/ok.yaml', '# copied from mcp-servers/pdlc/contract/proposal.yaml\n');
    const hits = findPdlcDependencies(root);
    assert.deepEqual([...new Set(hits.map((h) => h.file))].sort(), ['.claude/skills/x/SKILL.md', '.specify/scripts/check.sh', 'scripts/backlog.mjs', 'scripts/lib/probe.mjs']);
    assert.ok(hits.some((h) => h.file === 'scripts/backlog.mjs' && /code/.test(h.why)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
