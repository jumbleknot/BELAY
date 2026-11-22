// One argument-rejection mechanism, shared by every script whose default action does something.
//
// THE DEFECT THIS EXISTS TO PREVENT. An argument a tool does not recognise and does not REJECT
// silently leaves the DEFAULT action running: `--dryrun` instead of `--dry-run` performs the real
// run, and `--help` on a script that ignores it does whatever the script does. The typo'd run's
// exit code is indistinguishable from the intended one's.
//
// THE RULE IS REJECT, NOT GUESS. An unknown argument raises. It is never silently ignored, and
// "did you mean" guessing is deliberately absent: a parser that repairs its input acts on
// something the caller did not type.
//
// SCOPE. Flags here are VALUELESS: `--foo bar` is a flag plus a positional, never a flag with a
// value. A value-taking flag needs an explicit extension, not a clever inference, because
// `--target --apply` would otherwise silently swallow the second flag.

/** Raised for any argument contract violation. Callers turn this into a usage error, never a default. */
export class ArgvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArgvError';
  }
}

/**
 * Does this argv ask what the script does? Checked BEFORE anything else.
 * Someone asking what a script does must never trigger what it does.
 */
export function wantsHelp(args) {
  return args.includes('--help') || args.includes('-h');
}

/**
 * Split argv into recognised flags and positionals, REJECTING anything unrecognised, before any
 * dispatch. A token is a flag if it starts with `-`, so near-miss spellings (`-dry-run`,
 * `--dry_run`, `--dryrun`) are all flags, all unrecognised, all refused.
 *
 * @param {string[]} argv
 * @param {{accepted: string[], maxPositionals?: number, usage?: string}} spec
 * @returns {{flags: Set<string>, positionals: string[]}}
 * @throws {ArgvError} on an unrecognised flag or a surplus positional
 */
export function partitionArgs(argv, { accepted, maxPositionals = 0, usage = '' }) {
  const args = (argv ?? []).filter((a) => a !== '');
  const flags = args.filter((a) => a.startsWith('-'));
  const positionals = args.filter((a) => !a.startsWith('-'));

  const unknown = flags.filter((f) => !accepted.includes(f));
  if (unknown.length) {
    throw new ArgvError(
      `unrecognised argument(s): ${unknown.join(', ')}\n` +
        `accepted: ${accepted.join(', ')}\n\n${usage}`,
    );
  }
  if (positionals.length > maxPositionals) {
    throw new ArgvError(
      `unexpected positional argument(s): ${positionals.slice(maxPositionals).join(', ')}\n` +
        `this script takes at most ${maxPositionals} positional argument(s)\n\n${usage}`,
    );
  }
  return { flags: new Set(flags), positionals };
}

/**
 * Print the message and exit 2 for an ArgvError; rethrow anything else.
 *
 * Exit 2, not 1: a mistyped flag is a different kind of error from the one the script exists to
 * report, and must not be mistaken for it.
 *
 * `hard: false` sets `process.exitCode` and RETURNS instead of calling `process.exit()`, so output
 * still queued on a pipe (a CI log capture) is not discarded. The caller must then not proceed to
 * its default action.
 */
export function dieOnArgvError(err, { log = console.error, hard = true } = {}) {
  if (!(err instanceof ArgvError)) throw err;
  log(err.message);
  if (hard) process.exit(2);
  process.exitCode = 2;
}
