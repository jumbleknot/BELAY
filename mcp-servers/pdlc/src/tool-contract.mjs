// THE tool contract (contracts/tools.md; spec FR-001 to FR-003): names, descriptions and input schemas
// in one place. The server registers from it, validates every call against it, and the contract test
// reads it back over the protocol. A change to a name, parameter or enum value here is BREAKING: the
// skill (skill/proposal-intake/SKILL.md), manifest.json's `tools` and the major version move with it.
import * as z from 'zod';

/** Section ids, in body order (contracts/proposal-body.md). External contract shared with the skill. */
export const SECTION_IDS = Object.freeze(['feature_name', 'problem', 'proposed_value', 'personas', 'goals_success',
  'rough_scope', 'open_questions', 'out_of_scope', 'priority']);

/** The forge's title limit, and the body/comment limit (data-model.md, write guard 0). */
export const MAX_TITLE_CHARS = 255;
export const MAX_BODY_BYTES = 65_536;

const byteLength = (s) => Buffer.byteLength(s, 'utf8');
const text = () => z.string().refine((s) => byteLength(s) <= MAX_BODY_BYTES, { message: `at most ${MAX_BODY_BYTES} bytes` });

const repo = z.string().min(1).max(100).describe('Repository name from list_repos (matched case-insensitively)');
const number = z.int().min(1).describe('Issue number');
const priority = z.enum(['p1', 'p2', 'p3']);
const writeStatus = z.enum(['draft', 'ready']);
const title = z.string().min(1).max(MAX_TITLE_CHARS).describe('"Proposal: <feature name>"');

const sectionShape = (required) => Object.fromEntries(SECTION_IDS.map((id) => {
  if (id === 'feature_name' && required) return [id, text().refine((s) => s.trim() !== '', { message: 'feature_name must not be empty' })];
  return [id, text().optional()];
}));

const strict = (shape) => z.strictObject(shape);

// Feature 016 (specs/016-pdlc-spec-intake/contracts/tools.md). The spec's files are larger than an issue body.
export const MAX_SPEC_FILE_BYTES = 256 * 1024;
const shortName = z.string().max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+){1,3}$/)
  .describe('2 to 4 lowercase words joined by hyphens, at most 40 characters: the branch and folder name after the number');
const revision = z.string().regex(/^[0-9a-f]{64}$/).describe('The revision get_spec or the last write returned');
const specPath = z.string().min(1).max(200).describe('spec.md or checklists/<name>.md, relative to the spec folder');
const specContent = z.string().refine((s) => byteLength(s) <= MAX_SPEC_FILE_BYTES, { message: `at most ${MAX_SPEC_FILE_BYTES} bytes` });

export const TOOLS = Object.freeze({
  list_repos: {
    description: 'List the repositories under the configured owner, with description, default branch and whether a local proposal copy exists.',
    input: strict({}),
  },
  repo_status: {
    description: "Report a repository's local proposal copy: path, branch, clean or dirty, and commits behind or ahead of the default branch. Fetches; changes no files.",
    input: strict({ repo }),
  },
  sync_repo: {
    description: "Create the local proposal copy if absent (blobless clone of the default branch), otherwise fast-forward it. Refuses a dirty, off-branch, diverged or foreign copy and changes nothing.",
    input: strict({ repo }),
  },
  check_setup: {
    description: 'Check that the repository has the proposal labels and the proposal form on its default branch, in step with the master. Reports; creates nothing. ok:false is a result, not an error.',
    input: strict({ repo }),
  },
  list_proposals: {
    description: 'List proposals (issues labelled type/proposal) by status (draft, ready or all), optional search query, and issue state (default open).',
    input: strict({
      repo,
      status: z.enum(['draft', 'ready', 'all']),
      query: z.string().max(200).optional(),
      state: z.enum(['open', 'closed', 'all']).default('open'),
    }),
  },
  get_proposal: {
    description: 'Read one proposal: its sections, labels, status, priority, comments, url and updated_at. Refuses an issue that is not a proposal.',
    input: strict({ repo, number }),
  },
  create_proposal: {
    description: 'File a new proposal with the title "Proposal: <feature name>", the given sections, one priority label and the draft or ready status. Refuses when an open proposal has the same title.',
    input: strict({ repo, title, sections: strict(sectionShape(true)), priority, status: writeStatus }),
  },
  update_proposal: {
    description: 'Edit a proposal: replace only the given sections, and optionally the title, priority or status. Refuses as stale when the issue changed since expected_updated_at. Returns the new updated_at.',
    input: strict({
      repo, number,
      expected_updated_at: z.string().min(1),
      title: title.optional(),
      sections: strict(sectionShape(false)).optional(),
      priority: priority.optional(),
      status: writeStatus.optional(),
    }),
  },
  add_comment: {
    description: "Add a comment to a proposal. Returns the comment's url and the issue's new updated_at.",
    input: strict({ repo, number, body: text().refine((s) => s.length > 0, { message: 'body must not be empty' }) }),
  },
  check_spec_kit: {
    description: "Check the repository's Spec Kit in its local copy: initialised, version, supported, script flavour, numbering, and how each specify and clarify hook is handled. Reports; changes nothing. ok:false is a result, not an error.",
    input: strict({ repo }),
  },
  start_spec: {
    description: "Start the spec for a ready proposal: run the repository's own branch script as a dry run, create the feature branch in its own worktree, write spec.md from the repository's template with the Input line filled, and move the proposal to spec in progress.",
    input: strict({ repo, number, short_name: shortName }),
  },
  get_spec: {
    description: "Read a proposal's spec in progress: stage, lock, branch, folder, files, revision, open [NEEDS CLARIFICATION] markers, whether clarify has run since the start or reopen, and whether the proposal changed since the start.",
    input: strict({ repo, number }),
  },
  write_spec_file: {
    description: "Write one file of the spec in progress: spec.md or checklists/<name>.md, inside the spec folder only, against the revision last read. Refuses outside spec in progress and when the spec changed since that revision.",
    input: strict({ repo, number, path: specPath, content: specContent, base_revision: revision }),
  },
  approve_spec: {
    description: "Approve the spec in progress: refuse while [NEEDS CLARIFICATION] markers remain or clarification has not run, then commit the spec folder, publish the feature branch, and move the proposal to ready to plan with a comment linking the folder.",
    input: strict({ repo, number, base_revision: revision }),
  },
  reopen_spec: {
    description: 'Reopen an approved spec (ready to plan) for editing, until planning starts: the proposal moves back to spec in progress and leaves the ready list. Approving again needs a new clarification session and publishes on the same branch.',
    input: strict({ repo, number }),
  },
  withdraw_spec: {
    description: "Withdraw a spec in progress or ready to plan, until planning starts: the proposal goes back to the stage the author chooses (ready or draft), with a comment naming the branch, which is kept and never reused. Deletes nothing.",
    input: strict({ repo, number, to: writeStatus }),
  },
  take_latest_spec: {
    description: "When the feature branch changed on the forge, bring the published branch into the spec in progress: back up first, keep the author's edits by a three-way merge per file, and list any conflicts for the author to resolve. Publishes nothing and changes no stage.",
    input: strict({ repo, number }),
  },
});

export const TOOL_NAMES = Object.freeze(Object.keys(TOOLS));

/** The JSON Schema announced in tools/list, generated from the same zod schema that validates. */
export function inputJsonSchema(name) {
  const { $schema, ...schema } = z.toJSONSchema(TOOLS[name].input, { io: 'input' });
  return schema;
}
