// The spec lifecycle (feature 016; contracts/tools.md "Spec Kit check" and "Spec lifecycle"; research R1 to R7). It
// composes the modules below it: the proposal guards (proposals.mjs), the local copy (local-copy.mjs), the repository's
// own Spec Kit (spec-kit-runner.mjs), the spec's worktree and state (spec-worktree.mjs), the path-guarded files
// (spec-files.mjs) and the stage model (stages.mjs).
//
// Every operation refuses at the first failed guard, before anything is written (FR-025), and keeps NO state in memory:
// the model's calls and the pane's calls are served by different server processes (research R9, measured). Every
// stage change goes through the transition table (FR-023) and posts its comment, with the trailer, BEFORE the label
// swap, so a failure between the two leaves a record that says what was meant (contracts/backlog-stage-cli.md).
import { existsSync } from 'node:fs';
import { Refusal } from './refusal.mjs';
import { loadLabels } from './labels.mjs';
import { checkTransition, planStageSwap, readTrailers, renderTrailer, stageFromLabels } from './stages.mjs';
import { countClarifySessions, findMarkers } from './spec-approval.mjs';

/** Stages at which the spec is locked from Claude Desktop (FR-018). */
const LOCKED = new Set(['in-engineering', 'merged']);
const IN_PROGRESS = new Set(['spec-in-progress', 'ready-to-plan']);

const names = (issue) => (issue.labels ?? []).map((l) => l.name);
const day = (d) => d.toISOString().slice(0, 10);

/**
 * The repository's spec template with what the specify step would fill at once: the Input line (FR-003, the VS Code
 * route's pick-up convention), the branch and the date. Everything else is left for the session to write.
 */
export function fillTemplate(template, { number, title, body, branch, date }) {
  const input = `Proposal #${number}: ${title}\n\n${String(body ?? '').trim()}`;
  return String(template)
    .replace('$ARGUMENTS', () => input)
    .replace('`[###-feature-name]`', () => `\`${branch}\``)
    .replace('[DATE]', () => date);
}

/**
 * @param {{forge: object, allowlist: object, proposals: object, localCopy: object, specKit: object, worktree: object,
 *          files: object, config: {owner: string}, now?: () => Date}} deps
 */
export function createSpecLifecycle({ forge, allowlist, proposals, localCopy, specKit, worktree, files, approval, config, now = () => new Date() }) {
  const comments = async (path, number) => (await forge.getAll(`${path}/issues/${number}/comments`, { capability: 'read comments', maxPages: 20 })).items;

  /** The proposal, for a spec operation: not_ready_proposal when the issue is not a proposal at all (US1-AC4). */
  const load = async (repo, number) => {
    try {
      return await proposals.loadProposal(repo, number, { write: true });
    } catch (e) {
      if (e instanceof Refusal && e.code === 'not_a_proposal') throw new Refusal('not_ready_proposal', `${e.reason}, so no spec can be started from it`);
      throw e;
    }
  };

  /** Comment (with its trailer) first, then swap the one stage label (contracts/stages.md). */
  const moveStage = async ({ path, issue, to, by, text, trailer }) => {
    const from = stageFromLabels(names(issue));
    checkTransition(from, to, by);
    const labels = await loadLabels(forge, path);
    const swap = planStageSwap(names(issue), to, labels);
    await forge.post(`${path}/issues/${issue.number}/comments`, { body: `${text}\n\n${renderTrailer(trailer)}` }, { capability: 'comment on issues' });
    for (const id of swap.remove) await forge.delete(`${path}/issues/${issue.number}/labels/${id}`, { capability: 'edit issue labels' });
    if (swap.add.length) await forge.post(`${path}/issues/${issue.number}/labels`, { labels: swap.add }, { capability: 'edit issue labels' });
    return forge.get(`${path}/issues/${issue.number}`, { capability: 'read issues' });
  };

  /** The spec in progress for a proposal, from disk, or no_spec_for_proposal. */
  const specOf = async (repo, number) => {
    const state = await worktree.resume({ repo, copyPath: localCopy.pathOf(repo.name), number });
    if (!state) throw new Refusal('no_spec_for_proposal', `proposal #${number} in ${repo.name} has no spec in progress; start one with start_spec`);
    return { state, specDir: state.spec_dir.replace(/\/$/, '') };
  };

  const startedText = (branch, specDir) => `Spec started on branch \`${branch}\` in \`${specDir}/\` (Claude Desktop).`;
  /** The forge page for the spec folder on its branch (contracts/stages.md "→ ready-to-plan"). */
  const specUrl = (repo, branch, specDir) => `${config.forgeUrl}/${encodeURIComponent(config.owner)}/${encodeURIComponent(repo.name)}/src/branch/${branch}/${specDir}`;
  const gitCtx = (repo, state) => ({ cloneRoot: config.cloneRoot, repo: repo.name, copyPath: localCopy.pathOf(repo.name), defaultBranch: repo.default_branch,
    featureBranch: state.branch, specDir: state.spec_dir.replace(/\/$/, ''), recordedRemoteTip: state.recorded_remote_tip });

  /** The stage, and the guards every spec write shares: locked from in-engineering on, editable only in spec-in-progress. */
  const editableStage = (issue, number, what) => {
    const stage = stageFromLabels(names(issue));
    if (LOCKED.has(stage)) throw new Refusal('document_locked', `planning has started for proposal #${number} (stage "${stage}"), so the spec is locked from Claude Desktop`);
    if (stage !== 'spec-in-progress') throw new Refusal('stage_transition_refused', `the spec for proposal #${number} is at stage "${stage}"; reopen it with reopen_spec before ${what}`);
    return stage;
  };

  return {
    /** check_spec_kit: reports only, changes nothing (R3, R14; FR-005). */
    async checkSpecKit({ repo: repoArg }) {
      const repo = await allowlist.resolve(repoArg);
      const copyPath = localCopy.pathOf(repo.name);
      if (!existsSync(copyPath)) {
        return { repo: repo.name, initialised: false, version: null, supported: false, script: null, feature_numbering: null, hooks: [], ok: false,
          reason: `there is no local copy of ${repo.name} yet; run sync_repo first, then check again` };
      }
      return { repo: repo.name, ...(await specKit.inspect({ copyPath })) };
    },

    /** start_spec (US1; FR-001 to FR-005). */
    async start({ repo: repoArg, number, short_name: shortName }) {
      const { repo, path, issue } = await load(repoArg, number);
      const copyPath = localCopy.pathOf(repo.name);
      if (issue.state !== 'open') throw new Refusal('not_ready_proposal', `proposal #${number} is closed; only an open, ready proposal can start a spec`);
      const stage = stageFromLabels(names(issue));
      const existing = existsSync(copyPath) ? await worktree.resume({ repo, copyPath, number }) : null;
      if (existing && stage === 'ready') {
        // A start that created the worktree but stopped before the stage moved: finish it, never start a second spec.
        const specDir = existing.spec_dir.replace(/\/$/, '');
        const after = await moveStage({ path, issue, to: 'spec-in-progress', by: 'start_spec', text: startedText(existing.branch, specDir),
          trailer: { stage: 'spec-in-progress', branch: existing.branch, spec: existing.spec_dir } });
        await worktree.update({ repo, specDir }, { proposal_updated_at_start: after.updated_at });
        throw new Refusal('spec_already_in_progress', `proposal #${number} already has a spec in progress on branch ${existing.branch}; resume it with get_spec`, { branch: existing.branch, spec_dir: existing.spec_dir });
      }
      if (existing || IN_PROGRESS.has(stage)) {
        const branch = existing?.branch ?? readTrailers(await comments(path, number)).latest?.branch ?? null;
        throw new Refusal('spec_already_in_progress', `proposal #${number} already has a spec in progress${branch ? ` on branch ${branch}` : ''}; resume it instead of starting another`, { branch, spec_dir: existing?.spec_dir ?? null });
      }
      if (stage !== 'ready') {
        throw new Refusal('not_ready_proposal', `proposal #${number} is at stage "${stage}", not a ready proposal; only a ready proposal can start a spec`);
      }

      await localCopy.sync(repo);
      const kit = await specKit.inspect({ copyPath });
      const unsupported = kit.hooks.filter((h) => h.handling === 'unsupported');
      if (kit.initialised && kit.supported && unsupported.length) throw new Refusal('spec_hook_unsupported', kit.reason);
      if (!kit.ok) throw new Refusal('spec_kit_unavailable', kit.reason);

      const { withdrawn } = readTrailers(await comments(path, number));
      const prep = await specKit.prepare({ repo, copyPath, shortName, script: kit.script });
      const specDir = `specs/${prep.branch.split('/').pop()}`;
      const state = await worktree.create({ repo, copyPath, number, branch: prep.branch, specDir, withdrawn, proposalUpdatedAt: issue.updated_at, sessionsAtStart: 0 });
      const content = fillTemplate(prep.template, { number, title: issue.title, body: issue.body, branch: prep.branch, date: day(now()) });
      const { revision } = await files.write({ worktree: state.worktree_path, specDir, path: 'spec.md', content });
      const after = await moveStage({ path, issue, to: 'spec-in-progress', by: 'start_spec', text: startedText(prep.branch, specDir),
        trailer: { stage: 'spec-in-progress', branch: prep.branch, spec: `${specDir}/` } });
      // Recorded after the server's own comment and label change, so only a later edit counts as "the proposal changed".
      await worktree.update({ repo, specDir }, { proposal_updated_at_start: after.updated_at });
      return { repo: repo.name, number, branch: prep.branch, feature_num: prep.feature_num, spec_dir: `${specDir}/`,
        worktree_path: state.worktree_path, template_resolved: true, revision, hooks: kit.hooks };
    },

    /** get_spec: the spec in progress, read from disk (FR-007). */
    async get({ repo: repoArg, number }) {
      const { repo, issue } = await proposals.loadProposal(repoArg, number, { write: false });
      const { state, specDir } = await specOf(repo, number);
      const stage = stageFromLabels(names(issue));
      const { files: list, revision } = await files.read({ worktree: state.worktree_path, specDir });
      const spec = list.find((f) => f.path === 'spec.md')?.content ?? '';
      return {
        repo: repo.name, number, stage, locked: LOCKED.has(stage), branch: state.branch, spec_dir: state.spec_dir,
        worktree_path: state.worktree_path, files: list, revision,
        // The forge-side check (R8) lands with take_latest_spec (User Story 8); until a first publish there is nothing to compare.
        remote: { changed: false },
        markers: findMarkers(spec),
        clarified: countClarifySessions(spec) > state.sessions_at_start_or_reopen,
        proposal_updated_since_start: issue.updated_at !== state.proposal_updated_at_start,
      };
    },

    /**
     * approve_spec (US2; FR-008, FR-009; R15): the checks, then commit and publish the feature branch, then, only after
     * the push succeeded, move the stage to ready-to-plan with its linked comment.
     */
    async approve({ repo: repoArg, number, base_revision: base }) {
      const { repo, path, issue } = await proposals.loadProposal(repoArg, number, { write: true });
      const { state, specDir } = await specOf(repo, number);
      editableStage(issue, number, 'approving');
      const { files: list, revision } = await files.read({ worktree: state.worktree_path, specDir });
      if (revision !== base) {
        throw new Refusal('pane_edit_pending', 'the spec changed since you last read it (an edit in the pane, or another session); read it again with get_spec, show the author, then approve', { revision });
      }
      approval.check({ spec: list.find((f) => f.path === 'spec.md')?.content ?? '', state });
      const { commit } = await approval.publish({ state, ctx: gitCtx(repo, state) });
      await worktree.update({ repo, specDir }, { recorded_remote_tip: commit, approvals: (state.approvals ?? 0) + 1 });
      const url = specUrl(repo, state.branch, specDir);
      const verb = (state.approvals ?? 0) > 0 ? 're-approved' : 'approved';
      const after = await moveStage({ path, issue, to: 'ready-to-plan', by: 'approve_spec',
        text: `Spec ${verb} by its author and published on branch \`${state.branch}\`: [${state.spec_dir}](${url}). Ready to plan.`,
        trailer: { stage: 'ready-to-plan', branch: state.branch, spec: state.spec_dir } });
      await worktree.update({ repo, specDir }, { proposal_updated_at_start: after.updated_at });
      return { repo: repo.name, number, commit, branch: state.branch, spec_url: url, stage: 'ready-to-plan' };
    },

    /** write_spec_file: one path-guarded write, against the revision the caller last read (FR-007, FR-020, FR-036). */
    async writeFile({ repo: repoArg, number, path: file, content, base_revision: base }) {
      const { repo, issue } = await proposals.loadProposal(repoArg, number, { write: true });
      const { state, specDir } = await specOf(repo, number);
      editableStage(issue, number, 'editing');
      const current = await files.revision({ worktree: state.worktree_path, specDir });
      if (current !== base) {
        throw new Refusal('pane_edit_pending', 'the spec changed since you last read it (an edit in the pane, or another session); read it again with get_spec, take the change in, then write', { revision: current });
      }
      const { revision } = await files.write({ worktree: state.worktree_path, specDir, path: file, content });
      return { repo: repo.name, number, branch: state.branch, path: file, revision };
    },
  };
}
