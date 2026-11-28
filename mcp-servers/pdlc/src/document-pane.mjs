// The right-hand pane (feature 016, US9; research R9 as measured in T003; FR-035 to FR-037; decision M7).
//
// Claude Desktop shows ui://pdlc/document-pane.html (an MCP App page) when show_document is called, and moves it beside
// the chat when the page asks for the fullscreen display mode. The page reads with read_pane_document (it polls every
// 2 s) and writes with save_pane_edit; both are app-only. The model's calls and the page's calls are served by
// DIFFERENT server processes (measured), so nothing lives in memory: a spec's revision is the hash of its folder
// (spec-files.mjs), and a proposal's pane draft is a JSON file under <clone_root>/.pdlc-drafts/<Repo>/ (R5's draft store).
//
// No pane edit is lost (FR-036): every write carries the revision it was based on, and is refused pane_edit_pending when
// the document moved past it. A draft also keeps the sections as the model last read or wrote them, so
// get_proposal_draft can say what the author changed in the pane (pane_changes).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Refusal } from './refusal.mjs';
import { SECTION_IDS } from './tool-contract.mjs';
import { stageFromLabels } from './stages.mjs';

const LOCKED = new Set(['in-engineering', 'merged']);
const REF = /^[A-Za-z0-9_-]{1,64}$/;
const names = (issue) => (issue.labels ?? []).map((l) => l.name);
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const pick = (sections) => Object.fromEntries(SECTION_IDS.map((id) => [id, String(sections?.[id] ?? '')]));

/**
 * @param {{allowlist: object, proposals: object, localCopy: object, worktree: object, files: object, cloneRoot: string, randomId?: () => string}} deps
 */
export function createDocumentPane({ allowlist, proposals, localCopy, worktree, files, cloneRoot, randomId = () => randomBytes(6).toString('hex') }) {
  // ── proposal drafts ────────────────────────────────────────────────────────────────────────────────────────────
  const draftFile = (repo, ref) => {
    if (!REF.test(String(ref))) throw new Refusal('invalid_input', 'a pane reference is a proposal number or a draft id');
    return join(cloneRoot, '.pdlc-drafts', repo.name, `${ref}.json`);
  };
  const readDraft = (repo, ref) => {
    const f = draftFile(repo, ref);
    if (!existsSync(f)) return null;
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch { throw new Refusal('spec_state_inconsistent', `the pane draft ${ref} cannot be read; nothing was changed`); }
  };
  const writeDraft = (repo, ref, draft) => {
    const f = draftFile(repo, ref);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(`${f}.tmp`, JSON.stringify(draft));
    renameSync(`${f}.tmp`, f);
  };
  const draftRevision = (d) => hash({ sections: d.sections, priority: d.priority ?? null });
  const draftDoc = (d) => ({ sections: d.sections, priority: d.priority ?? null });
  // A new proposal's draft, once create_proposal saved it, leaves a pointer to the issue number, so the pane that is still
  // open on the draft id follows it (measured, T082: without it the page's next poll was refused not_found).
  const savedFile = (repo, ref) => join(cloneRoot, '.pdlc-drafts', repo.name, `${ref}.saved.json`);
  const savedAs = (repo, ref) => {
    try { const n = JSON.parse(readFileSync(savedFile(repo, ref), 'utf8')).number; return Number.isInteger(n) ? String(n) : null; } catch { return null; }
  };
  /** The proposal ref the pane should use now: the draft id, or the issue number it was saved as. */
  const follow = (repo, ref) => (readDraft(repo, ref) || /^\d+$/.test(String(ref)) ? String(ref) : (savedAs(repo, ref) ?? String(ref)));
  /** A saved proposal with no pane draft: the document is the issue on the forge (nothing written). */
  const issueDoc = async (repo, ref) => {
    const issue = await proposalIssue(repo, Number(ref));
    return { sections: pick(issue.sections), priority: issue.priority === 'unknown' ? null : issue.priority };
  };

  const proposalIssue = (repo, number) => proposals.get({ repo: repo.name, number });
  /** The repository and, for a proposal number, whether it is closed: drafts are keyed by the CANONICAL name. */
  const proposalRepo = async (repoArg, ref) => {
    if (/^\d+$/.test(String(ref ?? ''))) {
      const { repo, issue } = await proposals.loadProposal(repoArg, Number(ref), { write: false });
      return { repo, closed: issue.state !== 'open' };
    }
    return { repo: await allowlist.resolve(repoArg), closed: false };
  };

  // ── specs ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const specOf = async (repoArg, number) => {
    const { repo, issue } = await proposals.loadProposal(repoArg, number, { write: false });
    const state = await worktree.resume({ repo, copyPath: localCopy.pathOf(repo.name), number });
    if (!state) throw new Refusal('no_spec_for_proposal', `proposal #${number} in ${repo.name} has no spec in progress`);
    const stage = stageFromLabels(names(issue));
    return { repo, state, stage, specDir: state.spec_dir.replace(/\/$/, '') };
  };
  /** Whether a saved proposal has a spec (in progress or approved), so the page shows it as a tab beside the proposal. */
  const hasSpec = async (repo, ref) => {
    if (!/^\d+$/.test(String(ref))) return false;
    try { return Boolean(await worktree.resume({ repo, copyPath: localCopy.pathOf(repo.name), number: Number(ref) })); } catch { return false; }
  };

  return {
    /** show_document (model): open the pane on a document, creating or refreshing a proposal draft. */
    async show({ repo: repoArg, kind, number, draft_id: draftIdArg, sections, priority, base_revision: base }) {
      if (kind === 'spec') {
        if (!Number.isInteger(number)) throw new Refusal('invalid_input', 'show_document on a spec needs its proposal number');
        const { repo, state, stage, specDir } = await specOf(repoArg, number);
        const { files: list, revision } = await files.read({ worktree: state.worktree_path, specDir });
        return { repo: repo.name, kind, ref: number, branch: state.branch, revision, read_only: LOCKED.has(stage) || stage !== 'spec-in-progress', document: { files: list } };
      }
      const ref = Number.isInteger(number) ? String(number) : (draftIdArg ?? randomId());
      const { repo, closed: readOnly } = await proposalRepo(repoArg, ref);
      const fromIssue = Number.isInteger(number) && !readDraft(repo, ref) ? await proposalIssue(repo, number) : null;
      let draft = readDraft(repo, ref);
      if (!draft && fromIssue) {
        draft = { sections: pick(fromIssue.sections), priority: fromIssue.priority === 'unknown' ? null : fromIssue.priority };
        draft.model_read = { ...draftDoc(draft) };
        writeDraft(repo, ref, draft);
      }
      if (sections !== undefined || priority !== undefined) {
        if (readOnly) throw new Refusal('document_locked', `proposal #${number} is closed, so the pane shows it read-only`);
        if (draft && base !== draftRevision(draft)) {
          throw new Refusal('pane_edit_pending', 'the author changed the draft in the pane since you last read it; read it with get_proposal_draft, take the change in, then show it again', { revision: draftRevision(draft) });
        }
        const next = { sections: pick({ ...(draft?.sections ?? {}), ...sections }), priority: priority ?? draft?.priority ?? null };
        draft = { ...next, model_read: { ...next } };
        writeDraft(repo, ref, draft);
      }
      if (!draft) {
        draft = { sections: pick({}), priority: null };
        draft.model_read = { ...draftDoc(draft) };
        writeDraft(repo, ref, draft);
      }
      return { repo: repo.name, kind, ref: Number.isInteger(number) ? number : ref, ...(Number.isInteger(number) ? {} : { draft_id: ref }),
        revision: draftRevision(draft), read_only: readOnly, has_spec: await hasSpec(repo, ref), document: draftDoc(draft) };
    },

    /** get_proposal_draft (model): the draft, with what the pane changed since the model last read it. */
    async getDraft({ repo: repoArg, draft_id: draftIdArg, number }) {
      const ref = Number.isInteger(number) ? String(number) : draftIdArg;
      if (!ref) throw new Refusal('invalid_input', 'get_proposal_draft needs a draft_id or a proposal number');
      const { repo } = await proposalRepo(repoArg, ref);
      const draft = readDraft(repo, ref);
      if (!draft) throw new Refusal('not_found', `there is no pane draft ${ref} in ${repo.name}`);
      const before = draft.model_read?.sections ?? {};
      const paneChanges = SECTION_IDS.filter((id) => (before[id] ?? '') !== (draft.sections[id] ?? ''))
        .map((id) => ({ section: id, before: before[id] ?? '', after: draft.sections[id] ?? '' }));
      writeDraft(repo, ref, { ...draft, model_read: draftDoc(draft) });
      return { repo: repo.name, ref, ...draftDoc(draft), revision: draftRevision(draft), pane_changes: paneChanges };
    },

    /** save_pane_edit (app only): the author's typing, against the revision the page last read. */
    async save({ repo: repoArg, kind, ref, base_revision: base, path, content, sections, priority }) {
      if (kind === 'spec') {
        const number = Number(ref);
        if (!Number.isInteger(number)) throw new Refusal('invalid_input', 'a spec pane reference is its proposal number');
        const { repo, state, stage, specDir } = await specOf(repoArg, number);
        if (LOCKED.has(stage)) throw new Refusal('document_locked', `planning has started for proposal #${number}, so the spec is read-only in the pane`);
        if (stage !== 'spec-in-progress') throw new Refusal('document_locked', `the spec for proposal #${number} is at stage "${stage}"; reopen it before editing`);
        if (typeof path !== 'string' || typeof content !== 'string') throw new Refusal('invalid_input', 'a spec pane save names a path and its content');
        const current = await files.revision({ worktree: state.worktree_path, specDir });
        if (current !== base) throw new Refusal('pane_edit_pending', 'the spec changed since the pane read it; the pane reloads it', { revision: current });
        const { revision } = await files.write({ worktree: state.worktree_path, specDir, path, content });
        return { repo: repo.name, kind, ref: number, branch: state.branch, revision };
      }
      const at = follow(await allowlist.resolve(repoArg), ref);
      const { repo, closed } = await proposalRepo(repoArg, at);
      if (closed) throw new Refusal('document_locked', `proposal #${at} is closed, so the pane shows it read-only`);
      let draft = readDraft(repo, at);
      if (!draft && /^\d+$/.test(at)) {
        // the proposal is saved and has no draft: the pane edits the issue as it is on the forge
        const doc = await issueDoc(repo, at);
        draft = { ...doc, model_read: { ...doc } };
      }
      if (!draft) throw new Refusal('not_found', `there is no pane draft ${ref}; open it with show_document`);
      if (draftRevision(draft) !== base) throw new Refusal('pane_edit_pending', 'the draft changed since the pane read it; the pane reloads it', { revision: draftRevision(draft) });
      const next = { ...draft, sections: pick({ ...draft.sections, ...(sections ?? {}) }), priority: priority ?? draft.priority ?? null };
      writeDraft(repo, at, next);
      return { repo: repo.name, kind, ref: /^\d+$/.test(at) ? Number(at) : at, revision: draftRevision(next) };
    },

    /** read_pane_document (app only): what the page polls. */
    async read({ repo: repoArg, kind, ref }) {
      if (kind === 'spec') {
        const number = Number(ref);
        const { repo, state, stage, specDir } = await specOf(repoArg, number);
        const { files: list, revision } = await files.read({ worktree: state.worktree_path, specDir });
        return { repo: repo.name, kind, ref: number, revision, read_only: LOCKED.has(stage) || stage !== 'spec-in-progress', document: { files: list } };
      }
      const at = follow(await allowlist.resolve(repoArg), ref);
      const { repo, closed: readOnly } = await proposalRepo(repoArg, at);
      const draft = readDraft(repo, at) ?? (/^\d+$/.test(at) ? await issueDoc(repo, at) : null);
      if (!draft) throw new Refusal('not_found', `there is no pane draft ${ref}`);
      return { repo: repo.name, kind, ref: /^\d+$/.test(at) ? Number(at) : at, revision: draftRevision(draft), read_only: readOnly, has_spec: await hasSpec(repo, at), document: draftDoc(draft) };
    },

    /**
     * Before create_proposal (by draft_id) or update_proposal (by number): when the pane holds a draft, the caller's
     * draft_revision must be its current one (pane_edit_pending otherwise). Returns a function that deletes the draft,
     * for after the write succeeded (given the new issue number, it leaves a pointer so an open pane follows it), or
     * null when there is no draft.
     */
    async guardDraft({ repo: repoArg, ref, draft_revision: rev }) {
      if (ref === undefined || ref === null) return null;
      const repo = await allowlist.resolve(repoArg);
      let draft;
      try { draft = readDraft(repo, ref); } catch { draft = null; }
      if (!draft) return null;
      if (rev !== draftRevision(draft)) {
        throw new Refusal('pane_edit_pending', 'the author changed this proposal in the pane; read it with get_proposal_draft, take the change in, then save with its draft_revision', { revision: draftRevision(draft) });
      }
      return (number) => {
        rmSync(draftFile(repo, ref), { force: true });
        if (Number.isInteger(number) && !/^\d+$/.test(String(ref))) writeFileSync(savedFile(repo, ref), JSON.stringify({ number }));
      };
    },
  };
}
