// The spec's files, and the path guard on every write (feature 016; research R5; FR-020, US8-AC1).
//
// The server writes ONLY specs/<NNN-slug>/spec.md and specs/<NNN-slug>/checklists/<name>.md, inside the spec's own
// worktree. Every request is checked BEFORE anything is written, and refused path_outside_feature otherwise:
//   - the path must match one of the two shapes exactly: no `..`, no absolute or drive path, no backslash, no `:`
//     (a Windows alternate data stream), no other file and no deeper folder;
//   - no component on the way (specs/, the feature folder, checklists/, the file) may be a symlink, and the folder's
//     real path must stay inside the worktree, so a link can never carry a write somewhere else.
// Other files the specify or clarify prompts mention are not written: .specify/feature.json is gitignored, and
// setup-plan resolves the feature from the branch name when it is missing (R5). Adding a file is a change to this list
// and its test, as FR-020 requires.
//
// THE REVISION is a sha256 over the folder's working files, recomputed from disk on every call. The server keeps no
// state in memory: the model's calls and the pane's calls are served by different server processes (research R9,
// measured on the host 2026-11-27), and both must see each other's writes.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Refusal } from './refusal.mjs';

const SPEC_DIR = /^specs\/(?!\.+$)[A-Za-z0-9._-]+$/;
const FILE = /^(?:spec\.md|checklists\/[A-Za-z0-9][A-Za-z0-9._-]*\.md)$/;

const outside = (what) => new Refusal('path_outside_feature', `${what}; the server writes only spec.md and checklists/*.md in the spec's own folder, and nothing was changed`);
function lstatExists(p) { try { lstatSync(p); return true; } catch { return false; } }
const isLink = (p) => lstatExists(p) && lstatSync(p).isSymbolicLink();

function folderOf(worktree, specDir) {
  const dir = String(specDir ?? '').replace(/\/$/, '');
  if (!SPEC_DIR.test(dir)) throw outside(`"${specDir}" is not one folder under specs/`);
  const specs = join(worktree, 'specs');
  const folder = join(worktree, ...dir.split('/'));
  for (const p of [specs, folder]) if (lstatExists(p) && lstatSync(p).isSymbolicLink()) throw outside(`${dir} is reached through a symbolic link`);
  if (lstatExists(folder)) {
    const real = realpathSync(folder);
    if (!real.startsWith(realpathSync(worktree) + sep)) throw outside(`${dir} resolves outside the spec's worktree`);
  }
  return { dir, folder };
}

/** The absolute path for a write, or a path_outside_feature refusal. Nothing is created. */
function target(worktree, specDir, path) {
  const { folder } = folderOf(worktree, specDir);
  if (typeof path !== 'string' || !FILE.test(path)) throw outside(`"${path}" is not spec.md or checklists/<name>.md`);
  const abs = join(folder, ...path.split('/'));
  if (!resolve(abs).startsWith(resolve(folder) + sep)) throw outside(`"${path}" leaves the spec folder`);
  if (path.startsWith('checklists/') && isLink(join(folder, 'checklists'))) throw outside('checklists/ is a symbolic link');
  if (isLink(abs)) throw outside(`${path} is a symbolic link`);
  return { folder, abs };
}

function walk(folder, rel = '') {
  const out = [];
  if (!lstatExists(folder)) return out;
  for (const name of readdirSync(folder).sort()) {
    const abs = join(folder, name);
    const r = rel ? `${rel}/${name}` : name;
    const st = lstatSync(abs);
    if (st.isDirectory()) out.push(...walk(abs, r));
    else if (st.isFile()) out.push({ path: r, abs });
    else out.push({ path: r, abs: null }); // a link or special file still counts as a change
  }
  return out;
}

function revisionOf(folder) {
  const h = createHash('sha256');
  for (const f of walk(folder).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    h.update(f.path).update('\0').update(f.abs ? readFileSync(f.abs) : Buffer.from('<not a file>')).update('\0');
  }
  return h.digest('hex');
}

export function createSpecFiles() {
  return {
    /** Write one file after the path guard. Returns the folder's new revision. */
    async write({ worktree, specDir, path, content }) {
      const { folder, abs } = target(worktree, specDir, path);
      if (!lstatExists(folder)) throw outside(`${specDir} does not exist in the spec's worktree`);
      if (path.startsWith('checklists/')) mkdirSync(join(folder, 'checklists'), { recursive: true });
      writeFileSync(abs, String(content), 'utf8');
      return { revision: revisionOf(folder) };
    },

    /** spec.md and every checklists/*.md, in path order, with the revision. */
    async read({ worktree, specDir }) {
      const { folder } = folderOf(worktree, specDir);
      const files = walk(folder)
        .filter((f) => f.abs && FILE.test(f.path))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((f) => ({ path: f.path, content: readFileSync(f.abs, 'utf8') }));
      return { files, revision: revisionOf(folder) };
    },

    /** The folder's current revision, from disk. */
    async revision({ worktree, specDir }) {
      return revisionOf(folderOf(worktree, specDir).folder);
    },
  };
}
