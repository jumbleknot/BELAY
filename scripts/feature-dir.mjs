#!/usr/bin/env node
// feature-dir.mjs: make /speckit-plan work on a fresh checkout of a feature branch (feature 016; research R5, as
// measured in T042). Run by the mandatory before_plan hook, .claude/skills/speckit-belay-feature-dir/.
//
// WHY. Spec Kit 1.4.2's setup-plan finds the feature folder ONLY from SPECIFY_FEATURE_DIRECTORY or .specify/feature.json
// (common.ps1 Get-FeaturePathsEnv; there is no branch fallback). feature.json is written by the specify step and is
// gitignored by Spec Kit itself, so a fresh clone or worktree of a published feature branch (an Architect picking up
// someone else's spec, from either route) fails with "Feature directory not found" (measured 2026-11-28).
//
// WHAT. In Spec Kit's own precedence: SPECIFY_FEATURE_DIRECTORY set, or a feature.json naming a folder whose spec.md
// exists, means nothing to do. Otherwise, on a branch whose specs/<branch>/spec.md exists, it writes the gitignored
// feature.json in Spec Kit's compact format. Anything else is refused (exit 2) with the reason, writing nothing. It
// never edits a tracked file and never runs Spec Kit's scripts.
//
// Usage: node scripts/feature-dir.mjs
// Exit codes: 0 resolved (and written when needed) · 2 cannot tell which spec to plan, or bad arguments
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './lib/is-main.mjs';

const SPEC_DIR = /^specs\/[A-Za-z0-9._-]+$/;

export class FeatureDirError extends Error {}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** { featureDir, source: 'env'|'feature.json'|'branch', wrote } or a FeatureDirError. */
export function resolveFeatureDir({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.SPECIFY_FEATURE_DIRECTORY) return { featureDir: env.SPECIFY_FEATURE_DIRECTORY, source: 'env', wrote: false };
  let root;
  try { root = git(cwd, ['rev-parse', '--show-toplevel']); } catch { throw new FeatureDirError('not inside a git repository'); }
  const fj = join(root, '.specify', 'feature.json');
  if (existsSync(fj)) {
    try {
      const dir = String(JSON.parse(readFileSync(fj, 'utf8')).feature_directory ?? '').replace(/\/$/, '');
      if (SPEC_DIR.test(dir) && existsSync(join(root, dir, 'spec.md'))) return { featureDir: dir, source: 'feature.json', wrote: false };
    } catch { /* unreadable: treated as stale, below */ }
  }
  let branch = '';
  try { branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']); } catch { /* no branch */ }
  const dir = `specs/${branch.split('/').pop()}`;
  if (!branch || branch === 'HEAD' || !SPEC_DIR.test(dir) || !existsSync(join(root, dir, 'spec.md'))) {
    throw new FeatureDirError(`cannot tell which spec to plan: no .specify/feature.json names an existing spec, and ${branch && branch !== 'HEAD' ? `${dir}/spec.md does not exist on branch ${branch}` : 'HEAD is not on a branch'}. Check out the feature branch, or set SPECIFY_FEATURE_DIRECTORY=specs/<NNN-slug>`);
  }
  if (!existsSync(join(root, '.specify'))) throw new FeatureDirError('this repository has no .specify folder');
  writeFileSync(fj, JSON.stringify({ feature_directory: dir }));
  return { featureDir: dir, source: 'branch', wrote: true };
}

export async function main(argv, { cwd = process.cwd(), env = process.env, log = console.log, error = console.error } = {}) {
  if (argv.length) {
    error('Usage: node scripts/feature-dir.mjs');
    return 2;
  }
  try {
    const r = resolveFeatureDir({ cwd, env });
    const from = r.source === 'branch'
      ? `from branch ${r.featureDir.slice('specs/'.length)}; wrote .specify/feature.json`
      : r.source === 'env' ? 'from SPECIFY_FEATURE_DIRECTORY' : 'from .specify/feature.json';
    log(`feature directory: ${r.featureDir} (${from})`);
    return 0;
  } catch (e) {
    if (!(e instanceof FeatureDirError)) throw e;
    error(`feature-dir: ${e.message}`);
    return 2;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
