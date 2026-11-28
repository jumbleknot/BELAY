// Every git call the server makes goes through here (spec FR-017, FR-018; research R2).
//
// - A VERB ALLOWLIST, checked before anything runs: the server may clone, fetch, fast-forward and ask
//   read-only questions. It can never stash or rebase, and never touches the default branch's history.
// - FEATURE 016, EXACT SHAPES FOR ONE SPEC (research R4): a call that names the spec in progress it belongs to
//   (`spec`: its clone root, repository, copy, default branch, feature branch and folder) may also create that
//   feature's worktree and branch, stage exactly its folder, commit with a fixed message, and publish exactly that
//   branch onto itself. Every argument must match the shape exactly. A valid shape aimed at the default branch, or
//   at any branch but the spec's own, is refused `push_target_refused` (FR-021). Without `spec`, none of it runs.
// - AUTHENTICATION IN THE CHILD ENVIRONMENT ONLY: GIT_CONFIG_COUNT/KEY/VALUE set an http.extraHeader
//   and reset credential.helper for that one process. The token is never in argv, never in a remote
//   URL and never written to .git/config. GIT_CONFIG_COUNT needs git 2.31 or later.
// - execFile with an argument array and no shell, so no argument is ever interpreted.
import { execFile as realExecFile } from 'node:child_process';
import { basename, join, resolve, sep } from 'node:path';
import { createRedactor } from './redact.mjs';
import { Refusal } from './refusal.mjs';

export class GitVerbRefused extends Error {
  constructor(args) { super(`git ${args.slice(0, 2).join(' ')} is not on the allowlist`); this.name = 'GitVerbRefused'; }
}

export class GitError extends Error {
  constructor(message, { exitCode, stderr, stdout = '' }) { super(message); this.name = 'GitError'; this.exitCode = exitCode; this.stderr = stderr; this.stdout = stdout; }
}

const READ_ONLY_VERBS = new Set(['clone', 'fetch', 'status', 'rev-parse', 'rev-list', 'symbolic-ref']);
// Options that would write configuration, run another program, or copy hooks in, on any verb.
const FORBIDDEN_OPTION = /^(-c|--config|-u|--upload-pack|--receive-pack|--template|--exec)(=|$)/;
// Inherited variables that would point git at another repository or another configuration.
const DROPPED_ENV = /^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_CONFIG.*|GIT_ASKPASS|SSH_ASKPASS|GIT_SSH.*|GIT_EXEC_PATH|GIT_TERMINAL_PROMPT)$/;

const HEX = /^[0-9a-f]{7,40}$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const isBranch = (b) => typeof b === 'string' && BRANCH.test(b) && !b.startsWith('-') && !b.includes('..');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && resolve(a) === resolve(b);
const under = (p, root) => typeof p === 'string' && typeof root === 'string' && resolve(p).startsWith(resolve(root) + sep);
// The one commit message shape (research R4 "Commit identity").
const APPROVAL_MESSAGE = /^docs\(\d{3,}\): approve spec for proposal item #\d+\n\nApproved in Claude Desktop by the spec's author\.$/;

/** The folders a spec's calls are confined to (research R2, R5), derived from the spec, never from the call. */
function specPaths(spec) {
  // Before the branch exists (the Spec Kit scratch steps) a spec has no folder yet: only the scratch shapes can match.
  const slug = typeof spec.specDir === 'string' ? basename(spec.specDir) : null;
  return {
    worktree: slug ? join(spec.cloneRoot, '.pdlc-specs', spec.repo, slug) : null,
    scratchRoot: join(spec.cloneRoot, '.pdlc-scratch'),
    backups: slug ? join(spec.cloneRoot, '.pdlc-backups', spec.repo, slug) : null,
  };
}

/**
 * Feature 016 shapes. Returns 'refused' (not on the allowlist), 'target' (a valid shape whose branch is the default
 * branch or not this spec's: push_target_refused) or 'ok'.
 */
function specShape(args, cwd, spec) {
  const [verb, ...rest] = args;
  const p = specPaths(spec);
  const featureIsDefault = spec.featureBranch === spec.defaultBranch;
  const inWorktree = same(cwd, p.worktree);
  const folder = (x) => x === spec.specDir || x === `${spec.specDir}/`;
  switch (verb) {
    case 'clone': // the scratch clone the Spec Kit scripts run in (R1)
      return rest.length === 4 && rest[0] === '--shared' && rest[1] === '--no-checkout' && same(rest[2], spec.copyPath)
        && under(rest[3], p.scratchRoot) && resolve(rest[3]).split(sep).length === resolve(p.scratchRoot).split(sep).length + 1 ? 'ok' : 'refused';
    case 'fetch': // copy the copy's remote-tracking refs into a scratch clone
      return rest.length === 2 && same(rest[0], spec.copyPath) && rest[1] === '+refs/remotes/origin/*:refs/remotes/origin/*'
        && under(cwd, p.scratchRoot) ? 'ok' : 'refused';
    case 'checkout':
      return rest.length === 2 && rest[0] === '--detach' && rest[1] === `origin/${spec.defaultBranch}` && under(cwd, p.scratchRoot) ? 'ok' : 'refused';
    case 'worktree':
      if (rest.length === 2 && rest[0] === 'list' && rest[1] === '--porcelain') return 'ok';
      if (!(rest.length === 5 && rest[0] === 'add' && rest[1] === '-b' && rest[2] === spec.featureBranch && isBranch(rest[2])
        && same(rest[3], p.worktree) && rest[4] === `origin/${spec.defaultBranch}` && same(cwd, spec.copyPath))) return 'refused';
      return featureIsDefault ? 'target' : 'ok';
    case 'show': {
      const m = rest.length === 1 ? /^([0-9a-f]{7,40}):(.+)$/.exec(rest[0]) : null;
      return m && m[2].startsWith(`${spec.specDir}/`) && !m[2].split('/').includes('..') ? 'ok' : 'refused';
    }
    case 'merge-file':
      return rest.length === 4 && rest[0] === '-p' && rest.slice(1).every((f) => under(f, p.backups)) ? 'ok' : 'refused';
    case 'add':
      if (!(rest.length === 2 && rest[0] === '--' && folder(rest[1]) && inWorktree)) return 'refused';
      return featureIsDefault ? 'target' : 'ok';
    case 'commit':
      if (!(rest.length === 3 && rest[0] === '--no-verify' && rest[1] === '-m' && APPROVAL_MESSAGE.test(rest[2]) && inWorktree)) return 'refused';
      return featureIsDefault ? 'target' : 'ok';
    case 'push': {
      const m = rest.length === 2 && rest[0] === 'origin' ? /^refs\/heads\/([^:]+):refs\/heads\/([^:]+)$/.exec(rest[1]) : null;
      if (!m || m[1] !== m[2] || !isBranch(m[1]) || !inWorktree) return 'refused';
      return m[1] === spec.defaultBranch || m[1] !== spec.featureBranch || featureIsDefault ? 'target' : 'ok';
    }
    case 'reset':
      // `reset -- specs/<slug>`: unstage the spec folder only (take-latest, R8); moves no branch, touches no working file.
      if (rest.length === 2 && rest[0] === '--' && folder(rest[1]) && inWorktree) return featureIsDefault ? 'target' : 'ok';
      if (!(rest.length === 2 && rest[0] === '--soft' && HEX.test(rest[1]) && rest[1] === spec.recordedRemoteTip && inWorktree)) return 'refused';
      return featureIsDefault ? 'target' : 'ok';
    case 'diff':
      return rest.length === 5 && rest[0] === '--stat' && HEX.test(rest[1]) && HEX.test(rest[2]) && rest[3] === '--' && folder(rest[4]) ? 'ok' : 'refused';
    case 'log': {
      const range = rest.length === 2 && rest[0] === '--format=%H%x09%an%x09%s' ? /^([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})$/.exec(rest[1]) : null;
      return range ? 'ok' : 'refused';
    }
    default:
      return 'refused';
  }
}

/** Is this a 014 call: a source other than origin for fetch, or a --shared clone, must be a 016 shape instead. */
function is014Call(verb, rest) {
  if (READ_ONLY_VERBS.has(verb)) {
    if (verb === 'clone' && rest.includes('--shared')) return false;
    if (verb === 'fetch' && rest[0] !== 'origin') return false;
    return true;
  }
  if (verb === 'merge') return rest[0] === '--ff-only' && rest.length === 2 && !rest[1].startsWith('-');
  if (verb === 'config') return rest[0] === '--get' && rest.length === 2;
  return false;
}

/**
 * 'ok', 'refused' or 'target' for one call. `spec` (feature 016) names the spec in progress the call belongs to; without
 * it only feature 014's verbs are allowed.
 * @param {string[]} args
 * @param {{cwd?: string, spec?: {cloneRoot: string, repo: string, copyPath: string, defaultBranch: string, featureBranch: string, specDir: string, recordedRemoteTip?: string|null}}} [ctx]
 */
export function classifyGitCall(args, { cwd, spec } = {}) {
  const [verb, ...rest] = args;
  if (typeof verb !== 'string' || verb.startsWith('-')) return 'refused';
  if (rest.some((a) => typeof a !== 'string' || FORBIDDEN_OPTION.test(a))) return 'refused';
  if (is014Call(verb, rest)) return 'ok';
  if (!spec) return 'refused';
  return specShape(args, cwd, spec);
}

/** @param {string[]} args @param {Parameters<typeof classifyGitCall>[1]} [ctx] */
export function isAllowedGitCall(args, ctx) {
  return classifyGitCall(args, ctx) === 'ok';
}

/**
 * @param {{token: string, execFile?: typeof realExecFile, gitPath?: string, baseEnv?: NodeJS.ProcessEnv}} deps
 */
export function createGitRunner({ token, execFile = realExecFile, gitPath = 'git', baseEnv = process.env }) {
  const redact = createRedactor({ secrets: [token] });

  const childEnv = () => {
    const env = {};
    for (const [k, v] of Object.entries(baseEnv)) if (!DROPPED_ENV.test(k) && v !== undefined) env[k] = v;
    return {
      ...env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: token ${token}`,
      GIT_CONFIG_KEY_1: 'credential.helper',
      GIT_CONFIG_VALUE_1: '',
    };
  };

  return {
    /** @param {string[]} args @param {{cwd: string}} opts @returns {Promise<{stdout: string, stderr: string}>} */
    run(args, { cwd, spec } = {}) {
      const verdict = Array.isArray(args) ? classifyGitCall(args, { cwd, spec }) : 'refused';
      if (verdict === 'target') {
        return Promise.reject(new Refusal('push_target_refused', 'the server writes and publishes only the spec\'s own feature branch, never the default branch or another branch; nothing was changed'));
      }
      if (verdict !== 'ok') return Promise.reject(new GitVerbRefused(Array.isArray(args) ? args : []));
      return new Promise((resolve, reject) => {
        execFile(gitPath, args, { cwd, env: childEnv(), windowsHide: true, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            const exitCode = typeof error.code === 'number' ? error.code : null;
            const cleanStderr = redact(String(stderr ?? '')).trim();
            reject(new GitError(`git ${args[0]} failed${exitCode === null ? '' : ` (exit ${exitCode})`}: ${cleanStderr.split('\n').at(-1) ?? ''}`, { exitCode, stderr: cleanStderr, stdout: redact(String(stdout ?? '')) }));
          } else resolve({ stdout: String(stdout), stderr: String(stderr) });
        });
      });
    },
  };
}
