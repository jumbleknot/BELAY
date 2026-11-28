#!/usr/bin/env node
// feature-merged.mjs: close a proposal when its feature branch merges, and report the merged commit's test outcomes
// (feature 016; contracts/feature-merged.md; research R10 to R12, decision M10).
//
//   node scripts/feature-merged.mjs [--sha <commit>] [--dry-run]
//       The CLOSE, from .forgejo/workflows/feature-merged.yml on a push to main: the tests the feature created (test
//       declarations at the merge minus its first parent, counted by count-repo-metrics.mjs from git objects), the
//       closing comment with the stage trailer, the swap to status/merged, the close. Comment first, so a re-run that
//       finds it only completes the swap and the close. Exits 1 only when a write it attempted failed.
//   node scripts/feature-merged.mjs --outcomes <reports dir> --job-status <status> [--sha <commit>] [--dry-run]
//       The OUTCOMES, from the last step of guardrails' own run on main: the whole suite's passed, failed, skipped and
//       todo per test target, from the collector's reports. Never changes a label or closes. ALWAYS exits 0.
//
// NO TEST RUNS HERE (M10): the created count reads git objects and the outcomes read guardrails' own reports. A merge is
// never blocked or turned red by counting. A count that cannot be read is written `unknown` with its reason, never 0
// (FR-039). Every case where the merge itself is fine (not a proposal's merge, an ambiguous marker, an issue that is
// not an open proposal) is one log line and exit 0.
//
// The proposal is the one `Proposal #<n>` on the **Input** line of specs/<branch>/spec.md at the merge commit, where
// <branch> is the merged pull request's head branch: both routes name the spec folder after it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgeEndpoint } from './ci-status.mjs';
import { measureCommit } from './count-repo-metrics.mjs';
import { summarise } from './lib/collect-test-results.mjs';
import { isMain } from './lib/is-main.mjs';
import { findProposalNumbers } from './lib/proposal-marker.mjs';
import { STAGE_LABELS, renderTrailer, stageFromLabels } from './lib/stage-trailer.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(REPO_ROOT, 'scripts', 'feature-merged.config.json');
const MERGED = STAGE_LABELS.merged;

// The marker parser is shared with backlog.mjs record-tests (scripts/lib/proposal-marker.mjs).
export { findProposalNumbers };

const names = (issue) => (issue.labels ?? []).map((l) => l.name);
const short = (sha) => String(sha).slice(0, 7);

/**
 * @param {{request: (path: string, opts?: {method?: string, body?: object, token: string}) => Promise<any>,
 *          git: (args: string[]) => string, measure: (rev: string) => number, log: (line: string) => void,
 *          tokens: {GITHUB_TOKEN?: string, CI_DIGEST_TOKEN?: string}, defaultBranch: string, repoPath: string}} deps
 */
export function createFeatureMerged({ request, git, measure, log, tokens, defaultBranch, repoPath }) {
  const order = [tokens.GITHUB_TOKEN, tokens.CI_DIGEST_TOKEN].filter((t) => typeof t === 'string' && t.trim() !== '');

  /** The run token first, CI_DIGEST_TOKEN only when the run token is refused (R11, measured: it is not). */
  const call = async (path, opts = {}) => {
    let last;
    for (const token of order) {
      try { return await request(path, { ...opts, token }); } catch (e) {
        last = e;
        if (e?.status !== 401 && e?.status !== 403) throw e;
      }
    }
    throw last ?? new Error('no token: neither GITHUB_TOKEN nor CI_DIGEST_TOKEN is set');
  };

  /** The merged pull request: from the forge (measured to exist, T006), else from the merge commit's title. */
  const pullOf = async (sha) => {
    try {
      const pr = await call(`${repoPath}/commits/${sha}/pull`);
      if (pr?.number && pr?.head?.ref) return { number: pr.number, branch: pr.head.ref };
    } catch (e) { if (e?.status !== 404) throw e; }
    let subject = '';
    try { subject = git(['log', '-1', '--format=%s', sha]).trim(); } catch { /* no history */ }
    const m = /\(#(\d+)\) from (\S+) into /.exec(subject);
    return m ? { number: Number(m[1]), branch: m[2] } : null;
  };

  /** { pr, specFolder, number } for a proposal's merge, or null after logging why there is nothing to do. */
  const locate = async (sha) => {
    const pr = await pullOf(sha);
    if (!pr) { log(`feature-merged: ${short(sha)} is not a pull request merge; nothing to do`); return null; }
    const specFolder = `specs/${pr.branch.split('/').pop()}/`;
    let text = null;
    try { text = git(['show', `${sha}:${specFolder}spec.md`]); } catch { /* no spec for this branch */ }
    const nums = text === null ? [] : findProposalNumbers(text);
    if (nums.length === 0) { log(`feature-merged: pull request #${pr.number} (${pr.branch}) is not from a proposal (${text === null ? `no ${specFolder}spec.md` : 'no Proposal #<n> on its Input line'}); nothing to do`); return null; }
    if (nums.length > 1) { log(`feature-merged: warning: ${specFolder}spec.md names more than one proposal (${nums.map((n) => `#${n}`).join(', ')}); nothing written`); return null; }
    return { pr, specFolder, number: nums[0] };
  };

  const createdLine = (sha) => {
    let parent = null;
    try { parent = git(['rev-parse', `${sha}^1`]).trim(); } catch { /* shallow or a root commit */ }
    let at;
    try { at = measure(sha); } catch (e) { return `Tests created by this feature: unknown (the merge commit ${short(sha)} could not be counted: ${String(e.message).slice(0, 160)}).`; }
    if (!parent) return `Tests created by this feature: unknown (the merge commit's parent is not available in this checkout).`;
    let before;
    try { before = measure(parent); } catch (e) { return `Tests created by this feature: unknown (the parent commit ${short(parent)} could not be counted: ${String(e.message).slice(0, 160)}).`; }
    return `Tests created by this feature: ${at - before} test declarations (${before} at ${short(parent)} → ${at} at ${short(sha)}; counted by \`scripts/count-repo-metrics.mjs\`).`;
  };

  return {
    /** The close (exit 0 or 1). */
    async close({ sha, dryRun = false }) {
      try {
        const loc = await locate(sha);
        if (!loc) return 0;
        const { pr, specFolder, number } = loc;
        const issue = await call(`${repoPath}/issues/${number}`);
        const labels = names(issue);
        if (issue.pull_request || !labels.includes('type/proposal')) {
          log(`feature-merged: #${number} is not a proposal; nothing to do`); return 0;
        }
        if (labels.includes('status/bot-managed')) { log(`feature-merged: #${number} is bot-managed; nothing to do`); return 0; }
        if (issue.state !== 'open') { log(`feature-merged: proposal #${number} is already closed; nothing to do`); return 0; }
        let from;
        try { from = stageFromLabels(labels); } catch (e) { log(`feature-merged: warning: proposal #${number}: ${e.message}; nothing written`); return 0; }
        const body = [
          `Merged into \`${defaultBranch}\` in ${short(sha)} by pull request #${pr.number} from branch \`${pr.branch}\`.`,
          '',
          createdLine(sha),
          '',
          'Suite outcomes follow from this commit\'s `guardrails` run. If none follows, that run was cancelled or did not report.',
          '',
          renderTrailer({ stage: 'merged', branch: pr.branch, spec: specFolder }),
        ].join('\n');
        if (dryRun) {
          log(body);
          log(`label: ${STAGE_LABELS[from]} → ${MERGED}; then close #${number} (dry run: nothing written)`);
          return 0;
        }
        const comments = await call(`${repoPath}/issues/${number}/comments?limit=50`) ?? [];
        const already = comments.some((c) => String(c.body ?? '').includes(`stage=merged branch=${pr.branch} `) && String(c.body).includes(` in ${short(sha)} by`));
        if (!already) await call(`${repoPath}/issues/${number}/comments`, { method: 'POST', body: { body } });
        if (from !== 'merged') {
          const all = await call(`${repoPath}/labels?limit=50`);
          const idOf = (n) => all.find((l) => l.name === n)?.id;
          if (idOf(MERGED) === undefined) throw new Error(`the repository has no ${MERGED} label`);
          await call(`${repoPath}/issues/${number}/labels/${idOf(STAGE_LABELS[from])}`, { method: 'DELETE' });
          await call(`${repoPath}/issues/${number}/labels`, { method: 'POST', body: { labels: [idOf(MERGED)] } });
        }
        await call(`${repoPath}/issues/${number}`, { method: 'PATCH', body: { state: 'closed' } });
        log(`feature-merged: proposal #${number} merged by pull request #${pr.number} and closed`);
        return 0;
      } catch (e) {
        log(`feature-merged: a write failed: ${String(e?.message ?? e).slice(0, 300)}; a re-run is safe`);
        return 1;
      }
    },

    /** The outcomes comment (always exit 0). */
    async outcomes({ sha, dir, jobStatus, targets, dryRun = false }) {
      try {
        const loc = await locate(sha);
        if (!loc) return 0;
        const trailer = `<!-- pdlc-outcomes: sha=${sha} -->`;
        const rows = [];
        const reasons = [];
        for (const { target, report } of targets) {
          const file = join(dir, report);
          if (!existsSync(file)) { rows.push([target, null]); reasons.push(`${target}: unknown (no report: the step did not run)`); continue; }
          try { rows.push([target, summarise(readFileSync(file, 'utf8'))]); } catch (e) {
            rows.push([target, null]); reasons.push(`${target}: unknown (the report is unparsable: ${e.message})`);
          }
        }
        const cell = (c, k) => (c ? String(c[k]) : 'unknown');
        const body = [
          `Suite outcomes for \`${defaultBranch}\` at ${short(sha)} (whole suite, executed test cases, from this commit's \`guardrails\` run):`,
          '',
          '| Target | Passed | Failed | Skipped | Todo |',
          '| --- | ---: | ---: | ---: | ---: |',
          ...rows.map(([t, c]) => `| ${t} | ${cell(c, 'passed')} | ${cell(c, 'failed')} | ${cell(c, 'skipped')} | ${cell(c, 'todo')} |`),
          ...(reasons.length || jobStatus === 'cancelled' ? [''] : []),
          ...reasons,
          ...(jobStatus === 'cancelled' ? ['Run cancelled by a later push; counts may be partial.'] : []),
          '',
          trailer,
        ].join('\n');
        if (dryRun) { log(body); return 0; }
        const comments = await call(`${repoPath}/issues/${loc.number}/comments?limit=50`) ?? [];
        if (comments.some((c) => String(c.body ?? '').includes(trailer))) { log(`feature-merged: outcomes for ${short(sha)} already posted`); return 0; }
        await call(`${repoPath}/issues/${loc.number}/comments`, { method: 'POST', body: { body } });
        log(`feature-merged: outcomes for ${short(sha)} posted on proposal #${loc.number}`);
      } catch (e) {
        log(`feature-merged: warning: the outcomes comment was not posted: ${String(e?.message ?? e).slice(0, 300)}`);
      }
      return 0;
    },
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--sha') out.sha = val();
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--outcomes') out.outcomes = val();
    else if (a === '--job-status') out.jobStatus = val();
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

export async function main(argv, { env = process.env, log = (l) => process.stdout.write(`${l}\n`) } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (e) { log(`feature-merged: ${e.message}`); return 2; }
  const { base, owner, repo } = forgeEndpoint();
  const git = (a) => execFileSync('git', a, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const secrets = [env.GITHUB_TOKEN, env.CI_DIGEST_TOKEN].filter(Boolean);
  const scrub = (s) => secrets.reduce((t, x) => t.split(x).join('***'), String(s));
  const request = async (path, { method = 'GET', body, token }) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `token ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) { const e = new Error(scrub(`${method} ${path}: HTTP ${res.status}`)); e.status = res.status; throw e; }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  const fm = createFeatureMerged({
    request, git, log: (l) => log(scrub(l)),
    measure: (rev) => measureCommit({ cwd: REPO_ROOT, rev }).metrics.testDeclarations,
    tokens: { GITHUB_TOKEN: env.GITHUB_TOKEN, CI_DIGEST_TOKEN: env.CI_DIGEST_TOKEN },
    defaultBranch: env.GITHUB_REF_NAME || 'main',
    repoPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  });
  const sha = args.sha ?? env.GITHUB_SHA ?? git(['rev-parse', 'HEAD']).trim();
  if (args.outcomes) {
    const { targets } = JSON.parse(readFileSync(CONFIG, 'utf8'));
    return fm.outcomes({ sha, dir: resolve(args.outcomes), jobStatus: args.jobStatus ?? 'success', targets, dryRun: args.dryRun });
  }
  return fm.close({ sha, dryRun: args.dryRun });
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
