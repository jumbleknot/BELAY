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
});

export const TOOL_NAMES = Object.freeze(Object.keys(TOOLS));

/** The JSON Schema announced in tools/list, generated from the same zod schema that validates. */
export function inputJsonSchema(name) {
  const { $schema, ...schema } = z.toJSONSchema(TOOLS[name].input, { io: 'input' });
  return schema;
}
