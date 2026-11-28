// A refusal is the one way a tool says no (contracts/tools.md "Refusal codes"). It carries a code from
// the contract and one sentence a person can act on, and it is returned as an isError tool result.
// A refusal always means nothing was changed (spec FR-019).

/** The contract's refusal codes. External contract: the skill branches on these strings. */
export const REFUSAL_CODES = Object.freeze([
  'unknown_repo', 'not_a_proposal', 'bot_managed', 'unknown_label', 'stale', 'duplicate_title',
  'copy_dirty', 'copy_off_branch', 'copy_diverged', 'copy_foreign',
  'invalid_input', 'forge_auth', 'forge_unreachable', 'not_found',
  // Feature 016 (contracts/tools.md "New refusal codes"), added as each is implemented.
  'stage_transition_refused', 'stage_ambiguous', 'push_target_refused', 'spec_kit_unavailable', 'path_outside_feature',
]);

export class Refusal extends Error {
  /**
   * @param {string} code one of REFUSAL_CODES
   * @param {string} reason
   * @param {Record<string, unknown>} [details] extra result fields, e.g. the current updated_at for `stale`
   */
  constructor(code, reason, details = {}) {
    super(`${code}: ${reason}`);
    if (!REFUSAL_CODES.includes(code)) throw new TypeError(`unknown refusal code ${code}`);
    this.name = 'Refusal';
    this.code = code;
    this.reason = reason;
    this.details = details;
  }

  toJSON() {
    return { refused: true, code: this.code, reason: this.reason, ...this.details };
  }
}
