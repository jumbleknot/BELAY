// The tool handlers. Each composes the modules below it and returns a plain result object, or throws a
// Refusal. Validation, the result convention and the audit line are the server's (server.mjs), so a
// handler never formats a result or writes an audit event itself.
//
// Writes are logged at INFO with the tool, repository and issue number, never a body (research R17).

/**
 * @param {{allowlist: object, proposals: object, localCopy: object, setupCheck: object, specs?: object, log?: {info: Function}}} deps
 * @returns {Record<string, (args: object, ctx: {correlation_id: unknown}) => Promise<object>>} one handler per contract tool
 */
export function createToolHandlers(deps = {}) {
  const { allowlist, proposals, localCopy, setupCheck, specs, log } = deps;
  const wrote = (tool, msg, fields, ctx) => log?.info(msg, { correlation_id: ctx?.correlation_id ?? null, tool, ...fields });

  return {
    list_repos: async () => allowlist.list(),
    repo_status: async ({ repo }) => localCopy.status(await allowlist.resolve(repo)),
    sync_repo: async ({ repo }, ctx) => {
      const result = await localCopy.sync(await allowlist.resolve(repo));
      if (result.action !== 'up_to_date') wrote('sync_repo', `local copy ${result.action}`, { repo: result.repo }, ctx);
      return result;
    },
    check_setup: async (args) => setupCheck.check(args),
    list_proposals: async (args) => proposals.list(args),
    get_proposal: async (args) => proposals.get(args),
    create_proposal: async (args, ctx) => {
      const result = await proposals.create(args);
      wrote('create_proposal', 'proposal created', { repo: args.repo, number: result.number }, ctx);
      return result;
    },
    update_proposal: async (args, ctx) => {
      const result = await proposals.update(args);
      if (result.changed.length) wrote('update_proposal', `proposal updated: ${result.changed.join(', ')}`, { repo: args.repo, number: result.number }, ctx);
      return result;
    },
    add_comment: async (args, ctx) => {
      const result = await proposals.comment(args);
      wrote('add_comment', 'comment added', { repo: args.repo, number: result.number }, ctx);
      return result;
    },
    // Feature 016: the spec lifecycle (spec-lifecycle.mjs).
    check_spec_kit: async (args) => specs.checkSpecKit(args),
    start_spec: async (args, ctx) => {
      const result = await specs.start(args);
      wrote('start_spec', 'spec started', { repo: result.repo, number: result.number, branch: result.branch }, ctx);
      return result;
    },
    get_spec: async (args) => specs.get(args),
    approve_spec: async (args, ctx) => {
      const result = await specs.approve(args);
      wrote('approve_spec', `spec approved and published: ${result.commit}`, { repo: result.repo, number: result.number, branch: result.branch }, ctx);
      return result;
    },
    take_latest_spec: async (args, ctx) => {
      const result = await specs.takeLatest(args);
      wrote('take_latest_spec', `took the latest: ${result.merged.length} merged, ${result.conflicts.length} conflict(s)`, { repo: result.repo, number: result.number, branch: result.branch }, ctx);
      return result;
    },
    write_spec_file: async (args, ctx) => {
      const result = await specs.writeFile(args);
      wrote('write_spec_file', `spec file written: ${result.path}`, { repo: result.repo, number: result.number, branch: result.branch }, ctx);
      return result;
    },
  };
}
