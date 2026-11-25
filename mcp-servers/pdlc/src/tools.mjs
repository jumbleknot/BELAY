// The tool handlers. Each composes the modules below it and returns a plain result object, or throws a
// Refusal. Validation, the result convention and the audit line are the server's (server.mjs), so a
// handler never formats a result or logs an audit event itself.
import { Refusal } from './refusal.mjs';
import { TOOL_NAMES } from './tool-contract.mjs';

const notImplemented = (name) => async () => { throw new Refusal('invalid_input', `${name} is not implemented yet`); };

/** @param {object} _deps the composed modules (forge client, allowlist, labels, proposals, local copy, setup check) */
export function createToolHandlers(_deps = {}) {
  return Object.fromEntries(TOOL_NAMES.map((name) => [name, notImplemented(name)]));
}
