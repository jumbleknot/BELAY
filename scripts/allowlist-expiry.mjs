// Allowlist expiry semantics — the single home, imported by the allowlist gate(s).
//
// Ported from MovieCollectionManager (MCM) at fc2b953 (its features 033 and 057), as part of
// BELAY feature 006. In BELAY its one consumer today is scripts/check-sast-findings.mjs; it stays
// shape-agnostic so a second allowlist gate can import it rather than re-derive it.
//
// WHY THIS EXISTS. Expiry used to be BINARY: full suppression until the date, hard fail the next
// morning, and nothing in between. So a time-boxed acceptance announced itself at the moment of
// maximum disruption — usually on somebody else's unrelated pull request — and the remediation that
// needed its own branch and a real build got no notice at all.
//
// Three behaviours are added here, and the window's length is defined ONCE: every gate imports
// `WARNING_WINDOW_DAYS` and none redeclares it.
//
// PURE, deliberately. `today` is always passed in and never read from the clock. That is what makes
// both inclusive boundaries testable without mocking time, and it is why classification is computed
// on UTC date boundaries — a runner's local timezone must not be able to shift an entry between
// `expiring` and `expired`.
//
// SHAPE-AGNOSTIC. Allowlists' native entry shapes can differ (`{scanner, id, locationPattern}` here,
// `{image, id}` for an image allowlist), so each gate keeps its own compilation and passes in a
// NORMALIZED view:
//
//     { key, id, addedBy, expiry, scanner }
//
// `key` is a caller-supplied unique identity, NOT the advisory id: an allowlist can reuse one id
// across targets (two locations of one advisory, or one advisory against two images). Keying
// unmatched-detection on the id alone would let one entry's match silently cover another entry's
// staleness.
//
// NOTE ON ONE SIGNATURE. `formatExpiring(entries, today)` takes `today` because it must print DAYS
// REMAINING and this module is forbidden from reading the clock — the alternative, making every
// caller precompute the count, duplicates the arithmetic at each call site and invites them to
// diverge.

/**
 * How many days before an expiry an entry starts being reported while still suppressing.
 *
 * THE ONLY DEFINITION IN THE REPOSITORY. Chosen over 21 and 28 deliberately: keeping entries OUT of
 * the window most of the time is what keeps a warning meaningful, and that is worth more than
 * maximum lead time. The accepted cost is that a remediation needing its own branch and build gets
 * two weeks' notice rather than three.
 */
export const WARNING_WINDOW_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/** Parse an ISO `YYYY-MM-DD` to a UTC-midnight epoch. Returns NaN for anything else. */
function utcMidnight(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Whole days from `today` to `expiry`; negative once past. Both arguments ISO `YYYY-MM-DD`.
 *
 * Computed on UTC date boundaries rather than by local-time arithmetic, so neither a runner's
 * timezone nor a daylight-saving transition can move a classification by a day.
 */
export function daysUntil(expiry, today) {
  return Math.round((utcMidnight(expiry) - utcMidnight(today)) / MS_PER_DAY);
}

/**
 * `'active' | 'expiring' | 'expired'` — derived, never stored.
 *
 * BOTH BOUNDARIES ARE INCLUSIVE, which is what removes the ambiguity in "14 days":
 *   - `daysUntil === WARNING_WINDOW_DAYS` → `expiring` (the far edge is inside the window)
 *   - `expiry === today`                  → `expiring` (an entry suppresses through the whole of
 *                                            its final day), NOT `expired`
 *
 * Only `'expired'` stops suppression.
 */
export function classifyExpiry(expiry, today) {
  if (expiry === undefined || expiry === null || expiry === '') return 'active';
  const days = daysUntil(expiry, today);
  if (Number.isNaN(days)) return 'active';
  if (days < 0) return 'expired';
  return days <= WARNING_WINDOW_DAYS ? 'expiring' : 'active';
}

/**
 * Entries that suppressed nothing this run, whose scanner produced at least one finding, AND whose
 * target this run actually looked at.
 *
 * THE SCANNER CONDITION. Without it, a scanner that was skipped, not enabled, failed, or came back
 * genuinely clean would flag every one of its entries, and the check would go red claiming stale
 * allowlist hygiene when the real fault is a scan that never ran — misattributing a failure that
 * belongs to the scanning job.
 *
 * THE SCOPE CONDITION. Scanner identity stops being sufficient the moment a SECOND job consults the
 * same allowlist over a narrower set of targets: each run then reports the OTHER's live entries as
 * suppressing nothing (measured in MCM: a single-image run produced 16 such lines). That is not
 * merely noise, it is the wrong instruction — UNMATCHED exists to say "this entry is stale, delete
 * it", and acting on those lines would delete entries actively suppressing findings elsewhere.
 *
 * An entry whose target was not in this run's scanned set is therefore neither matched nor
 * unmatched — it is OUT OF SCOPE, and must be silent.
 *
 * THE MODULE STAYS SHAPE-AGNOSTIC. `inScope` is the caller's answer to "was this entry's target
 * looked at this run". ABSENT MEANS IN SCOPE, so a gate with a single consumer
 * (check-sast-findings.mjs) supplies nothing; only an explicit `false` silences. The default is
 * deliberately the safe direction — an unset flag over-reports, which is visible, rather than
 * under-reporting, which is not.
 *
 * @param {Array<{key: string, scanner: string, inScope?: boolean}>} entries normalized entries
 * @param {Set<string>} matchedKeys identities of entries that suppressed >= 1 finding
 * @param {Set<string>} scannersWithFindings scanners that produced >= 1 finding in this run
 */
export function selectUnmatched(entries, matchedKeys, scannersWithFindings) {
  return entries.filter(
    (e) => !matchedKeys.has(e.key) && scannersWithFindings.has(e.scanner) && e.inScope !== false,
  );
}

const label = (e) => e.id;

/** `EXPIRING SOON` body — id, expiry date, days remaining, addedBy. */
export function formatExpiring(entries, today) {
  return entries
    .map((e) => {
      const days = daysUntil(e.expiry, today);
      const plural = days === 1 ? 'day' : 'days';
      return `  ${label(e)}   expires ${e.expiry}   ${days} ${plural}   addedBy: ${e.addedBy}`;
    })
    .join('\n');
}

/**
 * The single `EXPIRED` line — the more valuable half of the change.
 *
 * It converts a confusing NEW blocking finding into a legible one: this used to be covered, until
 * this date, by an entry this person added. Without it the failure requires opening the allowlist
 * file to understand, on a branch that did not cause it.
 */
export function formatExpired(entry) {
  return `  ${label(entry)}  this finding was suppressed until ${entry.expiry} by an entry added by ${entry.addedBy}`;
}

/**
 * `UNMATCHED ENTRIES` body — id, addedBy, and that it suppressed nothing this run.
 *
 * THE WORDING NAMES THREE CAUSES, NOT TWO. It used to offer exactly two — remediated, or the scanner
 * changed identifier namespace — and a rule that had gone BLIND read as the first of them. Measured
 * in MCM: the community rule `gha-curl-pipe-shell` re-parses a step's `run:` block as Bash, could not
 * read the ci-log-step heredoc that wraps nearly every run-step, and so produced 36 errors and 0
 * findings while the `curl … | sh` lines it was written to find sat in the workflows unexamined.
 * BELAY wraps its run-steps in the same ci-log-step heredoc.
 *
 * `annotate` is optional and this module stays SHAPE-AGNOSTIC: it knows nothing about any scanner.
 * A gate that holds the scan report (the SAST one does) can pass a function returning a per-entry
 * detail line — which rule could not run, and how badly — and gets it appended to that entry alone.
 * Returning null, or passing nothing, leaves the line as it was.
 *
 * @param {Array<{id: string, addedBy: string}>} entries normalized entries
 * @param {(entry: object) => (string|null|undefined)} [annotate] optional per-entry detail
 */
export function formatUnmatched(entries, annotate) {
  return entries
    .map((e) => {
      const base = `  ${label(e)}  addedBy: ${e.addedBy} — matched nothing this run (remediated already, the scanner changed identifier namespace, or the rule could not run and so found nothing)`;
      const extra = annotate ? annotate(e) : null;
      return extra ? `${base}\n      ${extra}` : base;
    })
    .join('\n');
}
