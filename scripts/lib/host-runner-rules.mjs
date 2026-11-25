// host-runner-rules.mjs: what a job on the shared host runner (`runs-on: kvm`) may not do (items #79, #84).
//
// The host runner runs as the same Unix user as MovieCollectionManager's runner, so the two share one
// home folder, one Actions tool cache and one Docker daemon. Anything a job writes to a fixed path
// there, or puts on PATH from there, is shared with the other project, and a version bump on either
// side changes it for both (measured 2026-11-25 with pnpm, item #79; Trivy, its cache and the Docker
// login, item #84). So every tool, cache and credential a host job creates lives under
// `${{ runner.temp }}`, and an `always()` step removes it.
//
// Pure: takes a parsed workflow, returns violations. Pinned by
// scripts/__tests__/host-runner-shared-state.guard.test.mjs, which proves each rule on a bad example.

const PRIVATE = /^(\$\{\{\s*runner\.temp\s*\}\}|\$\{?RUNNER_TEMP\}?)\//;
const isPrivate = (p) => PRIVATE.test(String(p ?? ''));

/** The `runs-on: kvm` jobs of one workflow. */
export function hostJobs(wf, file) {
  return Object.entries(wf?.jobs ?? {})
    .filter(([, j]) => [j?.['runs-on']].flat().includes('kvm'))
    .map(([name, job]) => ({ where: `${file} → ${name}`, job, wf }));
}

/** Substitute `$VAR` / `${VAR}` from `env`, leaving `${{ … }}` expressions and unknown names alone. */
function resolveVars(s, env) {
  return String(s).replace(/\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g, (m, a, b) => {
    const k = a ?? b;
    return Object.hasOwn(env, k) ? String(env[k]) : m;
  });
}

/** Lines of a `run:` that are commands, not comments or plain output. */
const commandLines = (run) => String(run ?? '').split('\n').map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#') && !/^(echo|printf)\b/.test(l));

const HOME_PATH = /\$\{?HOME\b|(^|[\s='"(:])~\/|\/home\//;
const GLOBAL_INSTALL = /\bnpm\s+(i|install|add)\b[^\n]*\s(-g|--global)\b|\bcorepack\s+enable\b/;
const TRIVY_RUN = /\bimage-scan\.mjs\b|(^|[\s;&|])trivy\s+(image|fs|repo|rootfs|sbom|config)\b/m;

export function hostRunnerViolations(wf, file) {
  const out = [];
  for (const { where, job } of hostJobs(wf, file)) {
    const steps = job.steps ?? [];
    const privatePaths = [];
    const add = (step, rule, message) => out.push({ where, step: step.name ?? step.uses ?? '?', rule, message });

    for (const step of steps) {
      const env = { ...(wf.env ?? {}), ...(job.env ?? {}), ...(step.env ?? {}) };
      const run = String(step.run ?? '');
      const uses = String(step.uses ?? '');
      for (const [k, v] of Object.entries(step.env ?? {})) if (isPrivate(v)) privatePaths.push({ key: k, path: String(v) });

      if (/install-pnpm\.sh/.test(run) && !isPrivate(env.PNPM_PREFIX)) {
        add(step, 'pnpm-prefix', 'install-pnpm.sh without a PNPM_PREFIX under runner.temp installs into the shared tool cache');
      }
      if (GLOBAL_INSTALL.test(run)) {
        add(step, 'global-install', 'a global install (npm -g / corepack enable) writes the shared tool cache');
      }
      for (const line of run.split('\n')) {
        if (!/>>\s*"?\$\{?GITHUB_PATH\}?"?/.test(line)) continue;
        const m = line.match(/^\s*echo\s+(["']?)([^"'>]+?)\1\s*>>/);
        if (!m || !isPrivate(resolveVars(m[2], env))) {
          add(step, 'path-outside-temp', `adds to PATH from outside runner.temp: ${line.trim()}`);
        }
      }
      for (const m of run.matchAll(/install-trivy\.mjs\s+(["']?)([^"'\s]+)\1/g)) {
        if (!isPrivate(resolveVars(m[2], env))) add(step, 'trivy-install-outside-temp', `installs Trivy into ${m[2]}, outside runner.temp`);
      }
      if (TRIVY_RUN.test(run)) {
        const flag = run.match(/--cache-dir[=\s]+(["']?)([^"'\s]+)\1/);
        if (!isPrivate(env.TRIVY_CACHE_DIR) && !(flag && isPrivate(resolveVars(flag[2], env)))) {
          add(step, 'trivy-cache-default', 'runs Trivy without TRIVY_CACHE_DIR under runner.temp, so its database goes to the shared ~/.cache/trivy');
        }
      }
      if (/\bdocker\s+login\b/.test(run) && !isPrivate(env.DOCKER_CONFIG)) {
        add(step, 'docker-config-default', 'docker login without DOCKER_CONFIG under runner.temp leaves the credential in the shared ~/.docker/config.json');
      }
      if (/^pnpm\/action-setup(@|$)/.test(uses)) {
        add(step, 'pnpm-action-setup', 'pnpm/action-setup installs into the shared home folder (~/setup-pnpm)');
      }
      if (/(^|\/)setup-node(@|$)/.test(uses) && step.with?.cache) {
        add(step, 'setup-node-cache', 'setup-node `cache:` reads and writes a package-manager store in the shared home folder');
      }
      for (const line of commandLines(run)) {
        if (HOME_PATH.test(line)) add(step, 'home-write', `a command names a home-folder path: ${line}`);
      }
    }

    // Every private path must be removed by an always() step that names it (or a folder holding it).
    const cleanups = steps.filter((s) => /always\(\)/.test(String(s.if ?? '')) && /\brm\s+-rf\b/.test(String(s.run ?? '')));
    for (const { key, path } of privatePaths) {
      const covered = cleanups.some((s) => Object.entries(s.env ?? {}).some(([k, v]) =>
        isPrivate(v) && (path === String(v) || path.startsWith(`${v}/`))
        && new RegExp(`\\$\\{?${k}\\}?(?!\\w)`).test(String(s.run))));
      if (!covered) {
        out.push({ where, step: key, rule: 'private-not-removed', message: `${key} (${path}) is not removed by an always() rm -rf step` });
      }
    }
  }
  return out;
}
