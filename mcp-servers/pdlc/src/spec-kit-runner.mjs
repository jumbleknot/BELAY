// The target repository's own Spec Kit, read and run by the server (feature 016; research R1, R3, R14; ADR-0006).
//
// FR-002 requires the repository's own numbering, branch naming and template, so the server runs two of the
// repository's own scripts rather than reimplementing them: the branch script as a DRY RUN (it computes BRANCH_NAME and
// FEATURE_NUM and creates nothing) and resolve-template (it only reads). The server then creates the branch itself,
// through its git allowlist.
//
// REPOSITORY CODE RUNS ONLY IN A DISPOSABLE SCRATCH CLONE (constitution, Operator-Tool MCP Servers: every write is
// checked before it is attempted; a dry run's promise not to write is not a check). For each prepare():
//   1. fetch every remote head into the copy's refs/remotes/origin/*, with the credential, through the git runner;
//   2. clone --shared --no-checkout <copy> <clone_root>/.pdlc-scratch/<Repo>-<random>: its origin is the LOCAL copy,
//      so nothing in it can reach the forge, and it holds no credential;
//   3. copy the copy's remote-tracking refs into it, so the script's `git branch -a` sees every forge branch;
//   4. check out the default branch, detached;
//   5. run the scripts there, with NO credential in their environment and no shell. Their `git ls-remote --heads
//      origin` reaches only the local copy, whose local branches include any unpublished spec branch, so a number is
//      never handed out twice on this workstation;
//   6. delete the scratch folder, on success and on failure. A folder left by a crash goes at the next prepare.
// The scratch folder is the one place repository code can write.
import { execFile as realExecFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, join, resolve, sep } from 'node:path';
import { Refusal } from './refusal.mjs';

/** The Spec Kit versions this server is tested against (R14). Widening it is a contract change with its own test. */
export const SUPPORTED_SPECKIT = /^1\.4\.\d+$/;

/** The hook points the Claude Desktop route passes through (R3). */
const ROUTE_POINTS = ['before_specify', 'after_specify', 'before_clarify', 'after_clarify'];
/** R3's table: what the server does with each known hook in the Claude Desktop route. */
const HANDLED = Object.freeze({
  'speckit.git.feature': 'server', // the server runs the dry run, then creates the branch itself
  'speckit.belay.spec-stage': 'server', // the server makes the stage change and comment natively
  'speckit.git.commit': 'not_run', // the server commits once, on approval
  'speckit.agent-context.update': 'not_run', // edits a Claude Code file outside the spec folder; runs at after_plan in VS Code
});

/** The files each script flavour needs, relative to the repository root (R1, R14). */
const FLAVOURS = Object.freeze({
  ps: {
    branch: ['.specify', 'extensions', 'git', 'scripts', 'powershell', 'create-new-feature-branch.ps1'],
    template: ['.specify', 'scripts', 'powershell', 'resolve-template.ps1'],
  },
  sh: {
    branch: ['.specify', 'extensions', 'git', 'scripts', 'bash', 'create-new-feature-branch.sh'],
    template: ['.specify', 'scripts', 'bash', 'resolve-template.sh'],
  },
});
const PROMPTS = [['.claude', 'skills', 'speckit-specify', 'SKILL.md'], ['.claude', 'skills', 'speckit-clarify', 'SKILL.md']];

/** contracts/tools.md `start_spec.short_name`: 2 to 4 kebab words of [a-z0-9], at most 40 characters. */
export const SHORT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+){1,3}$/;

// Variables a script must never see: anything git would read as configuration or a credential, and the server's own.
const SECRET_ENV = /^(GIT_CONFIG.*|GIT_ASKPASS|SSH_ASKPASS|GIT_SSH.*|PDLC_.*|.*TOKEN.*|.*SECRET.*|.*PASSWORD.*)$/i;

// ── a reader for the layout Spec Kit writes to .specify/extensions.yml (a copy of BELAY's scripts/lib/extensions-yml.mjs:
//    this bundle cannot import from there, and the server takes no YAML dependency) ─────────────────────────────────

const scalar = (raw) => {
  const v = raw.trim();
  const q = v.match(/^(['"])(.*)\1$/);
  const s = q ? q[2] : v;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  return s;
};

/** { hooks: { <point>: [{ command, enabled, optional }] } }. Throws on any line outside Spec Kit's layout. */
export function parseExtensionsYml(text) {
  const hooks = {};
  let section = null;
  let point = null;
  let item = null;
  let lastField = null;
  const fail = (n, why) => { throw new Error(`extensions.yml:${n}: ${why}`); };
  const flush = () => {
    if (!item) return;
    const f = Object.fromEntries(Object.entries(item).map(([k, v]) => [k, scalar(v)]));
    hooks[point].push({ command: String(f.command ?? ''), enabled: f.enabled === undefined || f.enabled === null ? true : f.enabled === true, optional: f.optional === true });
    item = null;
  };
  String(text).split('\n').forEach((rawLine, i) => {
    const n = i + 1;
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (indent === 0 && !body.startsWith('- ')) {
      flush();
      const m = body.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!m) fail(n, `expected a top-level key, got "${body}"`);
      section = m[1];
      point = null;
      return;
    }
    if (section !== 'hooks') {
      if (section === 'installed' && /^-\s+\S/.test(body) && indent <= 2) return;
      if (body.startsWith('- ')) fail(n, `list item outside hooks/installed: "${body}"`);
      return;
    }
    const field = (s) => {
      const m = s.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!m) fail(n, `expected "key: value", got "${s}"`);
      item[m[1]] = m[2];
      lastField = m[1];
    };
    if (indent === 2 && !body.startsWith('-')) {
      flush();
      const m = body.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!m) fail(n, `expected a hook point, got "${body}"`);
      point = m[1];
      hooks[point] = [];
      return;
    }
    if (indent === 2 && body.startsWith('- ')) {
      if (!point) fail(n, 'hook item before any hook point');
      flush();
      item = {};
      field(body.slice(2).trim());
      return;
    }
    if (indent === 4 && item) { field(body); return; }
    if (indent > 4 && item && lastField) { item[lastField] = `${item[lastField]} ${body}`; return; }
    fail(n, `unexpected line in hooks: "${body}"`);
  });
  flush();
  return { hooks };
}

function classify(hooks) {
  const out = [];
  for (const point of ROUTE_POINTS) {
    for (const h of hooks[point] ?? []) {
      const handling = HANDLED[h.command] ?? (!h.enabled || h.optional ? 'not_run' : 'unsupported');
      out.push({ point, command: h.command, optional: h.optional, handling });
    }
  }
  return out;
}

function defaultFindExecutable(name, env = process.env, platform = process.platform) {
  const exts = platform === 'win32' && !/\.exe$/i.test(name) ? ['.exe', ''] : [''];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) if (existsSync(join(dir, name + ext))) return join(dir, name + ext);
  }
  return null;
}

/**
 * @param {{cloneRoot: string, git: {run(args: string[], opts: object): Promise<{stdout: string}>}, execFile?: Function,
 *          findExecutable?: (name: string) => string|null, baseEnv?: NodeJS.ProcessEnv, randomId?: () => string,
 *          platform?: string}} deps
 */
export function createSpecKitRunner({ cloneRoot, git, execFile = realExecFile, findExecutable, baseEnv = process.env,
  randomId = () => randomBytes(6).toString('hex'), platform = process.platform }) {
  const find = findExecutable ?? ((name) => defaultFindExecutable(name, baseEnv, platform));
  const scratchRoot = join(cloneRoot, '.pdlc-scratch');

  const scriptEnv = () => {
    const env = {};
    for (const [k, v] of Object.entries(baseEnv)) {
      if (v === undefined || SECRET_ENV.test(k) || /authorization/i.test(String(v))) continue;
      env[k] = v;
    }
    // A value that carries a secret under an innocent name is dropped too: the token's own value is in baseEnv.
    const secrets = Object.entries(baseEnv).filter(([k]) => SECRET_ENV.test(k)).map(([, v]) => String(v ?? '')).filter((v) => v.length >= 8);
    for (const [k, v] of Object.entries(env)) if (secrets.some((s) => String(v).includes(s))) delete env[k];
    env.GIT_TERMINAL_PROMPT = '0';
    return env;
  };

  const interpreterFor = (script) => {
    if (script === 'ps') {
      const pwsh = find('pwsh');
      if (pwsh) return { file: pwsh, flags: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'] };
      const winps = platform === 'win32' ? find('powershell.exe') : null;
      if (winps) return { file: winps, flags: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'] };
      throw new Refusal('spec_kit_unavailable', 'this repository\'s Spec Kit scripts are PowerShell, and neither pwsh nor Windows PowerShell was found on this computer');
    }
    const bash = find(platform === 'win32' ? 'bash.exe' : 'bash');
    if (bash) return { file: bash, flags: [] };
    throw new Refusal('spec_kit_unavailable', 'this repository\'s Spec Kit scripts are bash, and bash (Git for Windows) was not found on this computer');
  };

  const run = (file, args, cwd) => new Promise((resolveRun, reject) => {
    execFile(file, args, { cwd, env: scriptEnv(), windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const why = String(stderr ?? '').trim().split('\n').filter(Boolean).at(-1) ?? `exit ${error.code ?? '?'}`;
        reject(new Refusal('spec_kit_unavailable', `the repository's Spec Kit script failed: ${why.slice(0, 300)}`));
      } else resolveRun(String(stdout));
    });
  });

  /** The last line of stdout that is a JSON object carrying `keys`, or a refusal: never a half-read answer. */
  const jsonOut = (stdout, keys, what) => {
    for (const line of stdout.split('\n').map((l) => l.trim()).reverse()) {
      if (!line.startsWith('{')) continue;
      try {
        const o = JSON.parse(line);
        if (keys.every((k) => typeof o[k] === 'string')) return o;
      } catch { /* not JSON */ }
    }
    throw new Refusal('spec_kit_unavailable', `the repository's ${what} script did not print the JSON Spec Kit documents (${keys.join(', ')})`);
  };

  const removeLeftovers = (repoName) => {
    if (!existsSync(scratchRoot)) return;
    for (const name of readdirSync(scratchRoot)) {
      if (name.startsWith(`${repoName}-`)) rmSync(join(scratchRoot, name), { recursive: true, force: true });
    }
  };

  return {
    /** The interpreter prepare() would run a flavour's scripts with, or null when there is none (research M9, R1). */
    interpreterPath(script) {
      try { return interpreterFor(script).file; } catch { return null; }
    },

    /** check_spec_kit's answer for a local copy (R3, R14; FR-005). Reads only. */
    async inspect({ copyPath }) {
      const at = (...parts) => join(copyPath, ...parts);
      const base = { initialised: false, version: null, supported: false, script: null, feature_numbering: null, hooks: [] };
      if (!existsSync(at('.specify', 'init-options.json'))) {
        return { ...base, ok: false, reason: 'this repository is not set up for Spec Kit (no .specify/init-options.json), so a spec cannot be started from Claude Desktop' };
      }
      let options;
      try { options = JSON.parse(readFileSync(at('.specify', 'init-options.json'), 'utf8')); } catch {
        return { ...base, ok: false, reason: '.specify/init-options.json is not valid JSON' };
      }
      const version = typeof options.speckit_version === 'string' ? options.speckit_version : null;
      const script = options.script === 'sh' ? 'sh' : options.script === 'ps' ? 'ps' : null;
      const result = { ...base, initialised: true, version, supported: Boolean(version && SUPPORTED_SPECKIT.test(version)),
        script, feature_numbering: options.feature_numbering ?? null };
      let hooks = {};
      if (existsSync(at('.specify', 'extensions.yml'))) {
        try { hooks = parseExtensionsYml(readFileSync(at('.specify', 'extensions.yml'), 'utf8')).hooks; } catch (e) {
          return { ...result, ok: false, reason: `.specify/extensions.yml could not be read: ${e.message}` };
        }
      }
      result.hooks = classify(hooks);
      const fail = (reason) => ({ ...result, ok: false, reason });
      if (!result.supported) return fail(`this repository runs Spec Kit ${version ?? '(no version recorded)'}, and the Claude Desktop route follows 1.4.x only`);
      if (!script) return fail(`.specify/init-options.json names script "${options.script}", which is neither ps nor sh`);
      for (const parts of [FLAVOURS[script].branch, FLAVOURS[script].template, ...PROMPTS]) {
        if (!existsSync(at(...parts))) return fail(`this repository's Spec Kit is missing ${parts.join('/')}`);
      }
      const unsupported = result.hooks.filter((h) => h.handling === 'unsupported');
      if (unsupported.length) {
        return fail(`this repository has mandatory Spec Kit hooks the Claude Desktop route cannot honour: ${unsupported.map((h) => `${h.command} (${h.point})`).join(', ')}`);
      }
      return { ...result, ok: true };
    },

    /**
     * Run the branch script's dry run and resolve-template in a scratch clone (R1). Returns
     * { branch, feature_num, template }.
     * @param {{repo: {name: string, default_branch: string}, copyPath: string, shortName: string, script?: 'ps'|'sh'}} args
     */
    async prepare({ repo, copyPath, shortName, script = 'ps' }) {
      if (typeof shortName !== 'string' || shortName.length > 40 || !SHORT_NAME.test(shortName)) {
        throw new Refusal('invalid_input', 'short_name must be 2 to 4 lowercase words joined by hyphens, at most 40 characters');
      }
      const scratch = join(scratchRoot, `${repo.name}-${randomId()}`);
      if (!resolve(scratch).startsWith(resolve(scratchRoot) + sep) || resolve(scratch, '..') !== resolve(scratchRoot)) {
        throw new Refusal('path_outside_feature', 'the scratch clone would land outside the clone root\'s .pdlc-scratch folder; nothing was run');
      }
      const interpreter = interpreterFor(script);
      const ctx = { cloneRoot, repo: repo.name, copyPath, defaultBranch: repo.default_branch };

      removeLeftovers(repo.name);
      await git.run(['fetch', 'origin', '+refs/heads/*:refs/remotes/origin/*'], { cwd: copyPath });
      mkdirSync(scratchRoot, { recursive: true });
      try {
        await git.run(['clone', '--shared', '--no-checkout', copyPath, scratch], { cwd: cloneRoot, spec: ctx });
        await git.run(['fetch', copyPath, '+refs/remotes/origin/*:refs/remotes/origin/*'], { cwd: scratch, spec: ctx });
        await git.run(['checkout', '--detach', `origin/${repo.default_branch}`], { cwd: scratch, spec: ctx });
        const flavour = FLAVOURS[script];
        // The description is required by the script but unused once -ShortName is given; it is derived from the short
        // name, so no proposal or spec text is ever a process argument (FR-024).
        const description = shortName.replace(/-/g, ' ');
        const branchArgs = script === 'ps'
          ? ['-Json', '-DryRun', '-ShortName', shortName, description]
          : ['--json', '--dry-run', '--short-name', shortName, description];
        const branchOut = jsonOut(await run(interpreter.file, [...interpreter.flags, join(scratch, ...flavour.branch), ...branchArgs], scratch),
          ['BRANCH_NAME', 'FEATURE_NUM'], 'branch');
        const templateArgs = script === 'ps' ? ['spec-template', '-Json'] : ['spec-template', '--json'];
        const templateOut = jsonOut(await run(interpreter.file, [...interpreter.flags, join(scratch, ...flavour.template), ...templateArgs], scratch),
          ['TEMPLATE_CONTENT'], 'resolve-template');
        return { branch: branchOut.BRANCH_NAME, feature_num: branchOut.FEATURE_NUM, template: templateOut.TEMPLATE_CONTENT };
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  };
}
