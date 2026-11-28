// Where a spec in progress lives: one git worktree per spec, plus a state file (feature 016; research R2, R8;
// data-model.md "Spec in progress").
//
// The worktree is <clone_root>/.pdlc-specs/<Repo>/<NNN-slug>/, created with `worktree add -b <branch> <path>
// origin/<default>`. The local copy at <clone_root>/<Repo> stays on its default branch, fast-forward only, exactly as
// feature 014 left it, so sync_repo, repo_status and grounding are unchanged. A folder whose name starts with `.` cannot
// be a repository name, so list_repos's "local copy exists" check is not confused.
//
// The author's edits are uncommitted files in the worktree between sessions; resume is reading the worktree. The state
// file holds only what git cannot answer, and is read from disk on every call: the server keeps no state in memory
// (two server processes serve one Claude Desktop session; research R9, measured).
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Refusal } from './refusal.mjs';

export const STATE_VERSION = 1;

const norm = (p) => {
  const r = resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/** `git worktree list --porcelain` → [{ path, branch }] (branch without refs/heads/, or null when detached). */
export function parseWorktreeList(stdout) {
  return String(stdout).split(/\r?\n\r?\n/).map((block) => {
    const lines = block.split(/\r?\n/);
    const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
    const ref = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length);
    return path ? { path, branch: ref?.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null } : null;
  }).filter(Boolean);
}

const day = (d) => d.toISOString().slice(0, 10);

/**
 * @param {{cloneRoot: string, git: {run(args: string[], opts: object): Promise<{stdout: string}>}, now?: () => Date}} deps
 */
export function createSpecWorktree({ cloneRoot, git, now = () => new Date() }) {
  const repoDir = (repoName) => join(cloneRoot, '.pdlc-specs', repoName);
  const pathsFor = (repoName, specDir) => {
    const slug = basename(String(specDir).replace(/\/$/, ''));
    return { worktree: join(repoDir(repoName), slug), stateFile: join(repoDir(repoName), `${slug}.state.json`) };
  };
  const specCtx = (repo, copyPath, branch, specDir) => ({
    cloneRoot, repo: repo.name, copyPath, defaultBranch: repo.default_branch, featureBranch: branch, specDir: String(specDir).replace(/\/$/, ''),
  });
  const writeState = (file, state) => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  };
  const exists = async (args, cwd) => {
    try { await git.run(args, { cwd }); return true; } catch { return false; }
  };
  const inconsistent = (why) => new Refusal('spec_state_inconsistent', `${why}; nothing was changed. Look at the folder under .pdlc-specs/ before trying again`);

  const readStates = (repoName) => {
    const dir = repoDir(repoName);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => n.endsWith('.state.json')).map((n) => {
      let s;
      try { s = JSON.parse(readFileSync(join(dir, n), 'utf8')); } catch { throw inconsistent(`the spec state file ${n} cannot be read`); }
      if (s?.state_version !== STATE_VERSION || typeof s.branch !== 'string' || !Number.isInteger(s.number)) throw inconsistent(`the spec state file ${n} is not one this server wrote`);
      return { ...s, file: join(dir, n) };
    });
  };

  /**
   * R8: has the feature branch moved on the forge since the server last saw it? { changed: false } or
   * { changed: true, remote_tip, commits: [{ sha, author, subject }], diffstat }.
   */
  const remoteCheck = async ({ repo, copyPath, state }) => {
    const out = async (args, cwd) => (await git.run(args, { cwd })).stdout;
    try {
      await git.run(['fetch', 'origin', `+refs/heads/${state.branch}:refs/remotes/origin/${state.branch}`], { cwd: copyPath });
    } catch (e) {
      // Measured (T068): fetching a branch the forge does not have (never published, or deleted there) exits 128
      // "couldn't find remote ref". There is nothing to take; any other failure is real and propagates.
      if (/couldn't find remote ref/.test(String(e?.stderr ?? e?.message ?? ''))) return { changed: false };
      throw e;
    }
    let remote = null;
    try { remote = (await out(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${state.branch}`], copyPath)).trim() || null; } catch { remote = null; }
    const recorded = state.recorded_remote_tip ?? null;
    if (remote === recorded) return { changed: false };
    if (!remote) return { changed: false }; // nothing published, or it was deleted on the forge: nothing to take
    const from = recorded ?? (await out(['rev-parse', `origin/${repo.default_branch}`], copyPath)).trim();
    const specDir = state.spec_dir.replace(/\/$/, '');
    // log and diff are 016 shapes: they name the spec they read about (git allowlist, R4)
    const spec = specCtx(repo, copyPath, state.branch, state.spec_dir);
    const commits = (await git.run(['log', '--format=%H%x09%an%x09%s', `${from}..${remote}`], { cwd: copyPath, spec })).stdout.split('\n').filter(Boolean)
      .map((l) => { const [sha, author, ...subject] = l.split('\t'); return { sha, author, subject: subject.join('\t') }; });
    const diffstat = (await git.run(['diff', '--stat', from, remote, '--', specDir], { cwd: copyPath, spec })).stdout.replace(/\s+$/, '');
    return { changed: true, remote_tip: remote, commits, diffstat };
  };

  /** The spec folder's editable files (spec.md, checklists/*.md), as relative paths. */
  const editableFiles = (folder) => {
    const out = [];
    if (existsSync(join(folder, 'spec.md'))) out.push('spec.md');
    if (existsSync(join(folder, 'checklists'))) for (const n of readdirSync(join(folder, 'checklists')).sort()) if (/\.md$/.test(n)) out.push(`checklists/${n}`);
    return out;
  };

  return {
    pathsFor,

    /**
     * Create the feature branch in a new worktree and record its state. Refuses branch_exists, before any write, for
     * a withdrawn branch (never reused, FR-019), a branch already on the forge or in the copy, or an occupied path.
     */
    async create({ repo, copyPath, number, branch, specDir, withdrawn = [], proposalUpdatedAt, sessionsAtStart = 0 }) {
      if (withdrawn.includes(branch)) {
        throw new Refusal('branch_exists', `branch ${branch} belonged to a withdrawn spec of this proposal and is never reused; start again for a new number`);
      }
      const { worktree, stateFile } = pathsFor(repo.name, specDir);
      await git.run(['fetch', 'origin', '+refs/heads/*:refs/remotes/origin/*'], { cwd: copyPath });
      if (await exists(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], copyPath)) {
        throw new Refusal('branch_exists', `branch ${branch} already exists on the forge; someone else took that number, so start again`);
      }
      if (await exists(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], copyPath)) {
        throw new Refusal('branch_exists', `branch ${branch} already exists in the local copy; start again for a new number`);
      }
      if (existsSync(worktree) || existsSync(stateFile)) {
        throw new Refusal('branch_exists', `${worktree} is already in use; nothing was reused`);
      }
      await git.run(['worktree', 'add', '-b', branch, worktree, `origin/${repo.default_branch}`], { cwd: copyPath, spec: specCtx(repo, copyPath, branch, specDir) });
      const state = {
        repo: repo.name, number, branch, spec_dir: `${String(specDir).replace(/\/$/, '')}/`, recorded_remote_tip: null,
        last_start_or_reopen: day(now()), sessions_at_start_or_reopen: sessionsAtStart, proposal_updated_at_start: proposalUpdatedAt,
        withdrawn: false, state_version: STATE_VERSION,
      };
      writeState(stateFile, state);
      return { ...state, worktree_path: worktree };
    },

    /**
     * The proposal's spec in progress, checked against `git worktree list`, or null when it has none. Refuses
     * spec_state_inconsistent when the state file and git disagree, or two in-progress specs claim one proposal.
     */
    async resume({ repo, copyPath, number }) {
      const mine = readStates(repo.name).filter((s) => s.number === number && !s.withdrawn);
      if (mine.length === 0) return null;
      if (mine.length > 1) throw inconsistent(`proposal #${number} has ${mine.length} specs in progress (${mine.map((s) => s.branch).join(', ')})`);
      const { file, ...state } = mine[0];
      const { worktree } = pathsFor(repo.name, state.spec_dir);
      const listed = parseWorktreeList((await git.run(['worktree', 'list', '--porcelain'], {
        cwd: copyPath, spec: specCtx(repo, copyPath, state.branch, state.spec_dir),
      })).stdout);
      const entry = listed.find((w) => norm(w.path) === norm(worktree));
      if (!entry) throw inconsistent(`git does not list the worktree ${worktree} for branch ${state.branch}`);
      if (entry.branch !== state.branch) throw inconsistent(`the worktree ${worktree} is on ${entry.branch ?? 'a detached HEAD'}, not ${state.branch}`);
      if (!existsSync(worktree) || !lstatSync(worktree).isDirectory()) throw inconsistent(`the worktree folder ${worktree} is missing`);
      return { ...state, worktree_path: worktree };
    },

    remoteCheck: (args) => remoteCheck(args),

    /**
     * take_latest_spec (R8; FR-022): bring the published branch into the author's worktree and keep their edits.
     *   1. back up every working file of the spec folder;
     *   2. an unpublished commit (a publish that lost a race) is soft-reset onto the RECORDED tip, so its content
     *      becomes working changes. Only that commit moves; no published commit is ever rewritten;
     *   3. each file the author changed is merged three ways (base = recorded tip, ours = the working file,
     *      theirs = the published branch) with `git merge-file -p`, on temporary files kept with the backup;
     *   4. the folder is unstaged and put back to the recorded tip's content, so the worktree is clean;
     *   5. `merge --ff-only origin/<branch>` brings the published commits;
     *   6. the merged results are written back, conflict markers and all, and the new tip is recorded.
     * Nothing is published and no stage changes: the author approves again to publish.
     */
    async takeLatest({ repo, copyPath, state }) {
      const check = await remoteCheck({ repo, copyPath, state });
      if (!check.changed) throw new Refusal('nothing_to_take', `the published branch ${state.branch} has not changed since you last published or took it; there is nothing to bring in`);
      const specDir = state.spec_dir.replace(/\/$/, '');
      const cwd = state.worktree_path;
      const folder = join(cwd, ...specDir.split('/'));
      const slug = basename(specDir);
      const backup = join(cloneRoot, '.pdlc-backups', repo.name, slug, now().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'));
      const mergeDir = join(backup, 'merge');
      const out = async (args, opts) => (await git.run(args, opts)).stdout;
      const show = async (rev, file) => { try { return await out(['show', `${rev}:${specDir}/${file}`], { cwd, spec: ctx }); } catch { return null; } };

      // 1. back up
      const working = editableFiles(folder);
      mkdirSync(backup, { recursive: true });
      for (const f of working) cpSync(join(folder, ...f.split('/')), join(backup, ...f.split('/')));

      // 2. an unpublished commit becomes working changes, onto the recorded (or, before any publish, the starting) tip
      const base = state.recorded_remote_tip ?? (await out(['rev-parse', `origin/${repo.default_branch}`], { cwd })).trim();
      const ctx = { ...specCtx(repo, copyPath, state.branch, state.spec_dir), recordedRemoteTip: base };
      if (Number.parseInt(await out(['rev-list', '--count', `${base}..HEAD`], { cwd }), 10) > 0) {
        await git.run(['reset', '--soft', base], { cwd, spec: ctx });
      }

      // 3. three-way merge of each file the author changed
      const plan = [];
      for (const [i, f] of working.entries()) {
        const ours = readFileSync(join(folder, ...f.split('/')), 'utf8');
        const baseText = await show(base, f);
        if (ours === baseText) continue; // unchanged by the author: the fast-forward brings theirs
        const theirs = await show(check.remote_tip, f);
        if (theirs === baseText) { plan.push({ f, baseText, merged: ours, conflict: false }); continue; }
        mkdirSync(mergeDir, { recursive: true });
        const [o, b, t] = ['ours', 'base', 'theirs'].map((k) => join(mergeDir, `${i}-${k}`));
        writeFileSync(o, ours); writeFileSync(b, baseText ?? ''); writeFileSync(t, theirs ?? '');
        try {
          plan.push({ f, baseText, merged: await out(['merge-file', '-p', o, b, t], { cwd, spec: ctx }), conflict: false });
        } catch (e) {
          if (!(e?.exitCode > 0) || typeof e.stdout !== 'string') throw e;
          plan.push({ f, baseText, merged: e.stdout, conflict: true });
        }
      }

      // 4. a clean worktree at the base, 5. fast-forward, 6. write the merges back
      await git.run(['reset', '--', specDir], { cwd, spec: ctx });
      for (const { f, baseText } of plan) {
        const p = join(folder, ...f.split('/'));
        if (baseText === null) rmSync(p, { force: true }); else writeFileSync(p, baseText);
      }
      await git.run(['merge', '--ff-only', `origin/${state.branch}`], { cwd });
      for (const { f, merged } of plan) {
        mkdirSync(join(folder, ...f.split('/'), '..'), { recursive: true });
        writeFileSync(join(folder, ...f.split('/')), merged);
      }
      const { stateFile } = pathsFor(repo.name, state.spec_dir);
      if (existsSync(stateFile)) writeState(stateFile, { ...JSON.parse(readFileSync(stateFile, 'utf8')), recorded_remote_tip: check.remote_tip });
      return {
        merged: plan.filter((x) => !x.conflict).map((x) => x.f),
        conflicts: plan.filter((x) => x.conflict).map((x) => x.f),
        backup_path: backup, remote_tip: check.remote_tip,
      };
    },

    /** Merge `changes` into the proposal's state file (reopen, publish, withdraw). The file must exist. */
    async update({ repo, specDir }, changes) {
      const { stateFile } = pathsFor(repo.name, specDir);
      let current;
      try { current = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { throw inconsistent(`the spec state file for ${specDir} cannot be read`); }
      const next = { ...current, ...changes, state_version: STATE_VERSION };
      writeState(stateFile, next);
      return next;
    },
  };
}
