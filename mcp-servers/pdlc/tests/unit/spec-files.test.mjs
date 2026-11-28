// Spec files and the path guard (feature 016; research R5; FR-020, US8-AC1). The server writes only
// specs/<NNN-slug>/spec.md and specs/<NNN-slug>/checklists/*.md inside the spec's own worktree. Anything else is refused
// path_outside_feature BEFORE the write. The revision is a hash over the folder's working files, read from disk every
// time: the model's and the pane's calls are served by different server processes (research R9, measured).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpecFiles } from '../../src/spec-files.mjs';
import { Refusal } from '../../src/refusal.mjs';

const refusedWith = (code) => (e) => e instanceof Refusal && e.code === code;
const SPEC_DIR = 'specs/017-pane-probe';

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'pdlc-specfiles-'));
  const worktree = join(root, 'wt');
  mkdirSync(join(worktree, SPEC_DIR), { recursive: true });
  writeFileSync(join(worktree, SPEC_DIR, 'spec.md'), '# Spec\n');
  return { root, worktree, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const files = createSpecFiles();

test('spec.md and checklists/*.md are written inside the feature folder', async () => {
  const t = tree();
  try {
    await files.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'spec.md', content: '# Spec v2\n' });
    await files.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'checklists/requirements.md', content: '- [ ] one\n' });
    assert.equal(readFileSync(join(t.worktree, SPEC_DIR, 'spec.md'), 'utf8'), '# Spec v2\n');
    assert.equal(readFileSync(join(t.worktree, SPEC_DIR, 'checklists', 'requirements.md'), 'utf8'), '- [ ] one\n');
  } finally { t.cleanup(); }
});

const REFUSED = [
  '../spec.md', '../../.forgejo/workflows/x.yml', 'checklists/../../x.md', 'checklists/../spec.md',
  '/etc/passwd', 'C:\\Windows\\x.md', 'C:/x.md', '\\\\server\\share\\x.md',
  'spec.md:stream', 'checklists/a.md:$DATA', 'checklists\\a.md',
  'plan.md', 'tasks.md', 'README.md', 'contracts/tools.md', 'checklists/sub/a.md', 'checklists/a.txt', 'checklists/.md',
  'spec.md/x', '', '.', 'checklists', 'checklists/', './spec.md',
];
for (const path of REFUSED) {
  test(`refused path_outside_feature: ${JSON.stringify(path)}`, async () => {
    const t = tree();
    try {
      const before = await files.revision({ worktree: t.worktree, specDir: SPEC_DIR });
      await assert.rejects(files.write({ worktree: t.worktree, specDir: SPEC_DIR, path, content: 'x' }), refusedWith('path_outside_feature'));
      assert.equal(await files.revision({ worktree: t.worktree, specDir: SPEC_DIR }), before, 'nothing changed');
    } finally { t.cleanup(); }
  });
}

test('a symlinked spec.md, checklists folder or feature folder is refused, and its target is never written', async () => {
  const t = tree();
  try {
    const outside = join(t.root, 'outside.md');
    writeFileSync(outside, 'original');
    rmSync(join(t.worktree, SPEC_DIR, 'spec.md'));
    symlinkSync(outside, join(t.worktree, SPEC_DIR, 'spec.md'));
    await assert.rejects(files.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'spec.md', content: 'x' }), refusedWith('path_outside_feature'));
    assert.equal(readFileSync(outside, 'utf8'), 'original');

    const outsideDir = join(t.root, 'elsewhere');
    mkdirSync(outsideDir);
    symlinkSync(outsideDir, join(t.worktree, SPEC_DIR, 'checklists'));
    await assert.rejects(files.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'checklists/a.md', content: 'x' }), refusedWith('path_outside_feature'));
    assert.deepEqual(readdirSync(outsideDir), []);
  } finally { t.cleanup(); }

  const t2 = tree();
  try {
    const realFolder = join(t2.root, 'real-folder');
    mkdirSync(realFolder);
    rmSync(join(t2.worktree, SPEC_DIR), { recursive: true });
    symlinkSync(realFolder, join(t2.worktree, SPEC_DIR));
    await assert.rejects(files.write({ worktree: t2.worktree, specDir: SPEC_DIR, path: 'spec.md', content: 'x' }), refusedWith('path_outside_feature'));
    assert.ok(!existsSync(join(realFolder, 'spec.md')));
  } finally { t2.cleanup(); }
});

test('a spec folder that is not specs/<one folder> is refused, whatever the path', async () => {
  const t = tree();
  try {
    for (const specDir of ['specs', 'specs/', 'specs/../x', '.forgejo', 'specs/017-a/sub', '/abs/specs/017-a']) {
      await assert.rejects(files.write({ worktree: t.worktree, specDir, path: 'spec.md', content: 'x' }), refusedWith('path_outside_feature'), specDir);
    }
  } finally { t.cleanup(); }
});

test('the revision changes on every write that changes the folder, and only then', async () => {
  const t = tree();
  try {
    const r0 = await files.revision({ worktree: t.worktree, specDir: SPEC_DIR });
    assert.match(r0, /^[0-9a-f]{64}$/);
    assert.equal(await files.revision({ worktree: t.worktree, specDir: SPEC_DIR }), r0, 'reading changes nothing');
    const { revision: r1 } = await files.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'spec.md', content: '# Spec v2\n' });
    assert.notEqual(r1, r0);
    assert.equal(await files.revision({ worktree: t.worktree, specDir: SPEC_DIR }), r1);
    const { revision: r2 } = await files.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'checklists/requirements.md', content: 'x\n' });
    assert.notEqual(r2, r1, 'a new checklist changes the revision');
    const { revision: r3 } = await files.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'spec.md', content: '# Spec v2\n' });
    assert.equal(r3, r2, 'writing identical content is not a change');
    // a change made by someone else on disk (the pane's process, or the author's editor) moves it too
    writeFileSync(join(t.worktree, SPEC_DIR, 'spec.md'), '# edited outside\n');
    assert.notEqual(await files.revision({ worktree: t.worktree, specDir: SPEC_DIR }), r3);
  } finally { t.cleanup(); }
});

test('two module instances over one folder agree (no state kept between calls)', async () => {
  const t = tree();
  try {
    const a = createSpecFiles();
    const b = createSpecFiles();
    const { revision } = await a.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'spec.md', content: '# from a\n' });
    assert.equal(await b.revision({ worktree: t.worktree, specDir: SPEC_DIR }), revision);
    assert.deepEqual((await b.read({ worktree: t.worktree, specDir: SPEC_DIR })).files, [{ path: 'spec.md', content: '# from a\n' }]);
  } finally { t.cleanup(); }
});

test('read returns spec.md and every checklist, in path order, with the revision', async () => {
  const t = tree();
  try {
    await files.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'checklists/z.md', content: 'z' });
    await files.write({ worktree: t.worktree, specDir: SPEC_DIR, path: 'checklists/requirements.md', content: 'r' });
    const r = await files.read({ worktree: t.worktree, specDir: SPEC_DIR });
    assert.deepEqual(r.files.map((f) => f.path), ['checklists/requirements.md', 'checklists/z.md', 'spec.md']);
    assert.equal(r.revision, await files.revision({ worktree: t.worktree, specDir: SPEC_DIR }));
  } finally { t.cleanup(); }
});
