// Approving a spec (feature 016; research R4, R15; FR-008, FR-009).
//
// check()   refuses before anything is written: spec_has_markers while any [NEEDS CLARIFICATION …] marker remains, and
//           spec_not_clarified unless spec.md's `## Clarifications` section has MORE `### Session` headings than it had
//           at the last start or reopen (a count, not a date, so a same-day reopen still needs a new session). The
//           clarify prompt writes exactly that section; when it finds nothing to ask, the skill still adds a session with
//           the line "- No questions: no critical ambiguity found."
// publish() commits and publishes in a fixed order, each step an exact git shape the allowlist checks (R4):
//           the workstation's own git identity (git_identity_missing otherwise, before anything is staged), then
//           `add -- specs/<NNN-slug>`, `commit --no-verify -m <fixed message>`, and
//           `push origin refs/heads/<branch>:refs/heads/<branch>`, all in the spec's worktree. A failed push is
//           publish_failed with the commit KEPT: the caller must not move the stage, and the next approval publishes it.
import { Refusal } from './refusal.mjs';

/** The [NEEDS CLARIFICATION …] markers in a spec, in order (R15). */
export function findMarkers(text) {
  return [...String(text).matchAll(/\[NEEDS CLARIFICATION[^\]]*\]/g)].map((m) => m[0]);
}

/** How many `### Session` headings the spec's `## Clarifications` section holds (R15). */
export function countClarifySessions(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => /^## Clarifications\s*$/.test(l));
  if (start < 0) return 0;
  let n = 0;
  for (const l of lines.slice(start + 1)) {
    if (/^## /.test(l)) break;
    if (/^### Session\b/.test(l)) n += 1;
  }
  return n;
}

/** R4's one commit message shape. The number is the feature number the branch starts with. */
export function approvalMessage({ branch, number }) {
  const feature = /(?:^|\/)(\d{3,})-/.exec(branch)?.[1] ?? '000';
  return `docs(${feature}): approve spec for proposal item #${number}\n\nApproved in Claude Desktop by the spec's author.`;
}

/** @param {{git: {run(args: string[], opts: object): Promise<{stdout: string}>}}} deps */
export function createSpecApproval({ git }) {
  const out = async (args, opts) => (await git.run(args, opts)).stdout.trim();
  const configValue = async (key, cwd) => {
    try { return await out(['config', '--get', key], { cwd }); } catch { return ''; }
  };

  return {
    /** R15: markers, then clarification. Throws a Refusal; returns nothing when the spec may be approved. */
    check({ spec, state }) {
      const markers = findMarkers(spec);
      if (markers.length) {
        throw new Refusal('spec_has_markers', `the spec still has ${markers.length} open [NEEDS CLARIFICATION] marker(s); answer them before approving`, { markers });
      }
      if (countClarifySessions(spec) <= state.sessions_at_start_or_reopen) {
        throw new Refusal('spec_not_clarified', 'clarification has not run on this spec since it was started or reopened; run it (or record that it found nothing to ask) before approving');
      }
    },

    /**
     * Commit the feature folder and publish the feature branch (R4). Returns { commit, committed }.
     * @param {{state: {branch: string, number: number, spec_dir: string, worktree_path: string}, ctx: object}} args
     */
    async publish({ state, ctx }) {
      const cwd = state.worktree_path;
      const specDir = state.spec_dir.replace(/\/$/, '');
      const run = (args) => git.run(args, { cwd, spec: ctx });
      if (!(await configValue('user.name', cwd)) || !(await configValue('user.email', cwd))) {
        throw new Refusal('git_identity_missing', 'git has no user.name or user.email on this computer, so the approval cannot be committed under your name; set them in Git for Windows, then approve again');
      }
      const dirty = await out(['status', '--porcelain=v1', '--untracked-files=all', '--', specDir], { cwd });
      if (dirty !== '') {
        await run(['add', '--', specDir]);
        await run(['commit', '--no-verify', '-m', approvalMessage({ branch: state.branch, number: state.number })]);
      }
      const commit = await out(['rev-parse', 'HEAD'], { cwd });
      try {
        await run(['push', 'origin', `refs/heads/${state.branch}:refs/heads/${state.branch}`]);
      } catch (e) {
        if (e instanceof Refusal) throw e;
        throw new Refusal('publish_failed', `publishing branch ${state.branch} failed (${String(e.message ?? e).slice(0, 200)}); the commit is kept on this computer, the stage did not move, and approving again retries`, { commit });
      }
      return { commit, committed: dirty !== '' };
    },
  };
}
