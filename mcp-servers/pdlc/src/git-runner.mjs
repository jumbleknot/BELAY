// Every git call the server makes goes through here (spec FR-017, FR-018; research R2).
//
// - A VERB ALLOWLIST, checked before anything runs: the server may clone, fetch, fast-forward and ask
//   read-only questions. It can never commit, branch, push, stash, reset or rebase.
// - AUTHENTICATION IN THE CHILD ENVIRONMENT ONLY: GIT_CONFIG_COUNT/KEY/VALUE set an http.extraHeader
//   and reset credential.helper for that one process. The token is never in argv, never in a remote
//   URL and never written to .git/config. GIT_CONFIG_COUNT needs git 2.31 or later.
// - execFile with an argument array and no shell, so no argument is ever interpreted.
import { execFile as realExecFile } from 'node:child_process';
import { createRedactor } from './redact.mjs';

export class GitVerbRefused extends Error {
  constructor(args) { super(`git ${args.slice(0, 2).join(' ')} is not on the allowlist`); this.name = 'GitVerbRefused'; }
}

export class GitError extends Error {
  constructor(message, { exitCode, stderr }) { super(message); this.name = 'GitError'; this.exitCode = exitCode; this.stderr = stderr; }
}

const READ_ONLY_VERBS = new Set(['clone', 'fetch', 'status', 'rev-parse', 'rev-list', 'symbolic-ref']);
// Options that would write configuration, run another program, or copy hooks in, on any verb.
const FORBIDDEN_OPTION = /^(-c|--config|-u|--upload-pack|--receive-pack|--template|--exec)(=|$)/;
// Inherited variables that would point git at another repository or another configuration.
const DROPPED_ENV = /^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_CONFIG.*|GIT_ASKPASS|SSH_ASKPASS|GIT_SSH.*|GIT_EXEC_PATH|GIT_TERMINAL_PROMPT)$/;

/** @param {string[]} args */
export function isAllowedGitCall(args) {
  const [verb, ...rest] = args;
  if (typeof verb !== 'string' || verb.startsWith('-')) return false;
  if (rest.some((a) => FORBIDDEN_OPTION.test(a))) return false;
  if (READ_ONLY_VERBS.has(verb)) return true;
  if (verb === 'merge') return rest[0] === '--ff-only' && rest.length === 2 && !rest[1].startsWith('-');
  if (verb === 'config') return rest[0] === '--get' && rest.length === 2;
  return false;
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
    run(args, { cwd }) {
      if (!Array.isArray(args) || !isAllowedGitCall(args)) return Promise.reject(new GitVerbRefused(Array.isArray(args) ? args : []));
      return new Promise((resolve, reject) => {
        execFile(gitPath, args, { cwd, env: childEnv(), windowsHide: true, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            const exitCode = typeof error.code === 'number' ? error.code : null;
            const cleanStderr = redact(String(stderr ?? '')).trim();
            reject(new GitError(`git ${args[0]} failed${exitCode === null ? '' : ` (exit ${exitCode})`}: ${cleanStderr.split('\n').at(-1) ?? ''}`, { exitCode, stderr: cleanStderr }));
          } else resolve({ stdout: String(stdout), stderr: String(stderr) });
        });
      });
    },
  };
}
