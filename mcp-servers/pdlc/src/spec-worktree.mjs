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
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
