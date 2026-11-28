// A whole spec lifecycle for the unit tier (feature 016): the real modules over a temporary clone root, the fake forge,
// a fake git that behaves enough like git for the copy, the scratch clone and the worktree, and an execFile that stands
// in for the Spec Kit scripts. Wired as server.mjs does in production.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createForgeClient } from '../../../src/forge-client.mjs';
import { createRepoAllowlist } from '../../../src/repo-allowlist.mjs';
import { createProposals } from '../../../src/proposals.mjs';
import { createLocalCopy } from '../../../src/local-copy.mjs';
import { createSpecKitRunner } from '../../../src/spec-kit-runner.mjs';
import { createSpecWorktree, parseWorktreeList } from '../../../src/spec-worktree.mjs';
import { createSpecFiles } from '../../../src/spec-files.mjs';
import { createSpecLifecycle } from '../../../src/spec-lifecycle.mjs';
import { createSpecApproval } from '../../../src/spec-approval.mjs';
import { fakeForge } from './fake-forge.mjs';
import { connect } from './mcp-client.mjs';
import { CANARY } from './fixtures.mjs';

const CONTRACT_LABELS = JSON.parse(readFileSync(new URL('../../../contract/proposal-labels.json', import.meta.url), 'utf8')).map((l) => l.name);
const SPEC_KIT_FIXTURE = new URL('../../fixtures/spec-kit/belay-like/', import.meta.url).pathname;
const TEMPLATE = readFileSync(new URL('../../../../../.specify/templates/spec-template.md', import.meta.url), 'utf8');

export const ISO_DAY = '2026-11-27';

export async function specWorld({ branch = '017-pane-probe', fixture = SPEC_KIT_FIXTURE } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pdlc-specworld-'));
  const cloneRoot = join(root, 'clones');
  const copyPath = join(cloneRoot, 'BELAY');
  mkdirSync(cloneRoot, { recursive: true });
  cpSync(fixture, copyPath, { recursive: true });

  const forge = fakeForge({ repos: ['BELAY'], labels: [...CONTRACT_LABELS, 'type/feature', 'type/bug'] });
  const config = { forgeUrl: 'https://forge.example', apiBase: 'https://forge.example/api/v1', owner: 'operator', token: CANARY, cloneRoot };
  const client = createForgeClient({ config, fetch: forge.fetch });
  const allowlist = createRepoAllowlist({ forge: client, config, existsSync: () => true });
  const proposals = createProposals({ forge: client, allowlist, config });

  // A git double: enough of git's behaviour for the copy (014's sync), the scratch clone and the worktree.
  const worktrees = [{ path: copyPath, branch: 'main' }];
  const localBranches = new Set(['main']);
  const remoteBranches = new Set(['main']);
  const calls = [];
  const identity = { name: 'Operator', email: 'op@example.invalid' };
  const dirty = new Set();          // worktrees with uncommitted changes (every spec write makes one dirty)
  const commits = [];
  const pushes = [];
  const pushFails = { on: false };
  const git = {
    async run(args, { cwd, spec } = {}) {
      calls.push({ args: [...args], cwd, ...(spec && { spec }) });
      const k = args.join(' ');
      if (k === 'rev-parse --show-toplevel') return { stdout: `${cwd}\n` };
      if (k === 'config --get remote.origin.url') return { stdout: 'https://forge.example/operator/BELAY.git\n' };
      if (k === 'symbolic-ref --short HEAD') return { stdout: 'main\n' };
      if (args[0] === 'status' && args.includes('--')) return { stdout: dirty.has(cwd) ? ' M spec.md\n' : '' };
      if (k.startsWith('status --porcelain')) return { stdout: '' };
      if (k.startsWith('rev-list --count')) return { stdout: '0\n' };
      if (k === 'rev-parse HEAD') return { stdout: `${'a'.repeat(40)}\n` };
      if (args[0] === 'fetch') return { stdout: '' };
      if (args[0] === 'clone') { cpSync(args[3], args[4], { recursive: true }); return { stdout: '' }; }
      if (args[0] === 'checkout') return { stdout: '' };
      if (k.startsWith('rev-parse --verify --quiet refs/remotes/origin/')) {
        if (remoteBranches.has(k.split('refs/remotes/origin/')[1])) return { stdout: 'b'.repeat(40) };
        throw new Error('no such ref');
      }
      if (k.startsWith('rev-parse --verify --quiet refs/heads/')) {
        if (localBranches.has(k.split('refs/heads/')[1])) return { stdout: 'b'.repeat(40) };
        throw new Error('no such ref');
      }
      if (args[0] === 'worktree' && args[1] === 'add') {
        cpSync(copyPath, args[4], { recursive: true, filter: (src) => !src.includes(`${join(cloneRoot, '.pdlc-')}`) });
        localBranches.add(args[3]);
        worktrees.push({ path: args[4], branch: args[3] });
        return { stdout: '' };
      }
      if (k === 'config --get user.name') return identity.name ? { stdout: `${identity.name}\n` } : Promise.reject(new Error('unset'));
      if (k === 'config --get user.email') return identity.email ? { stdout: `${identity.email}\n` } : Promise.reject(new Error('unset'));
      if (args[0] === 'status' && args.includes('--')) return { stdout: dirty.has(cwd) ? ' M spec.md\n' : '' };
      if (args[0] === 'add') return { stdout: '' };
      if (args[0] === 'commit') { dirty.delete(cwd); commits.push({ cwd, message: args[3] }); return { stdout: '' }; }
      if (args[0] === 'push') {
        if (pushFails.on) throw new Error('remote: unable to access');
        const b = /^refs\/heads\/([^:]+):/.exec(args[2])[1];
        remoteBranches.add(b); pushes.push(b); return { stdout: '' };
      }
      if (k === 'worktree list --porcelain') {
        return { stdout: worktrees.map((w) => `worktree ${w.path}\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/${w.branch}\n`).join('\n') };
      }
      throw new Error(`spec-world git has no answer for: git ${k}`);
    },
  };

  const scripts = { branch, fail: null };
  const execFile = (file, args, options, cb) => {
    if (scripts.fail) return cb(Object.assign(new Error('exit 1'), { code: 1 }), '', scripts.fail);
    const isTemplate = args.some((a) => a.endsWith('resolve-template.ps1'));
    cb(null, isTemplate ? JSON.stringify({ TEMPLATE_NAME: 'spec-template', TEMPLATE_CONTENT: TEMPLATE })
      : JSON.stringify({ BRANCH_NAME: scripts.branch, FEATURE_NUM: scripts.branch.slice(0, 3), DRY_RUN: true }), '');
  };

  const localCopy = createLocalCopy({ cloneRoot, originUrlFor: (n) => `https://forge.example/operator/${n}.git`, git });
  const specKit = createSpecKitRunner({ cloneRoot, git, execFile, findExecutable: (n) => (n === 'pwsh' ? '/usr/bin/pwsh' : null), baseEnv: { PATH: '/usr/bin' }, platform: 'linux' });
  const worktree = createSpecWorktree({ cloneRoot, git, now: () => new Date(`${ISO_DAY}T12:00:00Z`) });
  const realFiles = createSpecFiles();
  const files = { ...realFiles, write: async (a) => { dirty.add(a.worktree); return realFiles.write(a); } };
  const specs = createSpecLifecycle({ forge: client, allowlist, proposals, localCopy, specKit, worktree, files, approval: createSpecApproval({ git }), config, now: () => new Date(`${ISO_DAY}T12:00:00Z`) });
  const c = await connect({ allowlist, proposals, localCopy, specs });

  const ready = (over = {}) => forge.addIssue('BELAY', { title: 'Proposal: Pane probe', body: '### Feature name\n\nPane probe\n\n### Problem\n\nA problem.', labels: ['type/proposal', 'status/needs-spec', 'priority/p2'], ...over });
  const labelsOf = (n) => forge.issue('BELAY', n).labels.map((l) => l.name);
  const worktreePath = join(cloneRoot, '.pdlc-specs', 'BELAY', branch.split('/').pop());
  return {
    root, cloneRoot, copyPath, worktreePath, forge, git, calls, scripts, remoteBranches, localBranches, worktrees, c, ready, labelsOf,
    identity, commits, pushes, pushFails,
    parseWorktreeList,
    close: async () => { await c.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
