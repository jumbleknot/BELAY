// The tool handlers. Each composes the modules below it and returns a plain result object, or throws a
// Refusal. Validation, the result convention and the audit line are the server's (server.mjs), so a
// handler never formats a result or writes an audit event itself.
//
// Writes are logged at INFO with the tool, repository and issue number, never a body (research R17).
import { Refusal } from './refusal.mjs';
import { TOOL_NAMES } from './tool-contract.mjs';

const notImplemented = (name) => async () => { throw new Refusal('invalid_input', `${name} is not implemented yet`); };

/**
 * @param {{allowlist?: object, proposals?: object, localCopy?: object, setupCheck?: object,
 *          log?: {info: Function}}} deps the composed modules; a missing one leaves its tools unimplemented
 */
export function createToolHandlers(deps = {}) {
  const { allowlist, proposals, localCopy, log } = deps;
  const wrote = (tool, msg, fields, ctx) => log?.info(msg, { correlation_id: ctx?.correlation_id ?? null, tool, ...fields });
  const handlers = Object.fromEntries(TOOL_NAMES.map((name) => [name, notImplemented(name)]));

  if (allowlist) {
    handlers.list_repos = async () => allowlist.list();
  }

  if (allowlist && localCopy) {
    handlers.repo_status = async ({ repo }) => localCopy.status(await allowlist.resolve(repo));
    handlers.sync_repo = async ({ repo }, ctx) => {
      const result = await localCopy.sync(await allowlist.resolve(repo));
      if (result.action !== 'up_to_date') wrote('sync_repo', `local copy ${result.action}`, { repo: result.repo }, ctx);
      return result;
    };
  }

  if (proposals) {
    handlers.get_proposal = async (args) => proposals.get(args);
    handlers.create_proposal = async (args, ctx) => {
      const result = await proposals.create(args);
      wrote('create_proposal', 'proposal created', { repo: args.repo, number: result.number }, ctx);
      return result;
    };
    handlers.list_proposals = async (args) => proposals.list(args);
    handlers.update_proposal = async (args, ctx) => {
      const result = await proposals.update(args);
      if (result.changed.length) wrote('update_proposal', `proposal updated: ${result.changed.join(', ')}`, { repo: args.repo, number: result.number }, ctx);
      return result;
    };
    handlers.add_comment = async (args, ctx) => {
      const result = await proposals.comment(args);
      wrote('add_comment', 'comment added', { repo: args.repo, number: result.number }, ctx);
      return result;
    };
  }

  return handlers;
}
