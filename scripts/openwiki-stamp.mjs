// The concept provenance stamp: which front-matter date says "this page was last brought up to date
// against its source". ONE definition, imported by every reader (the OKF gate's V5 and
// wiki-refresh's `--diff` base), so they cannot disagree.
//
// The stamp is the NEWEST of two fields:
//
//   generated.at  OKF v0.2. A generator run writes it (and strips `timestamp`) on a page whose body it
//                 rewrote. BELAY has no generator today; the field is still read, so a page written
//                 by one is judged by the same rule.
//   timestamp     OKF v0.1, and what `wiki-refresh.mjs --record` writes when a session refreshes a
//                 page.
//
// `verified.at` is NOT a candidate. `verified` is a retired openwiki Claims field and a forbidden
// field on a derived page (V17), so a stray one can never make a page look fresher than it is.
//
// Newest rather than first-present, because each field is an event and the latest event is the last
// time anything brought the page up to date.
//
// Ported from MovieCollectionManager; only references to that repository's specs were removed.

const EVENT_FIELDS = ['generated'];

const trimmed = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** A `{by, at}` event field may be one mapping or a list of them; yield each `at`. */
function eventAts(value) {
  const events = Array.isArray(value) ? value : [value];
  return events
    .filter((e) => e !== null && typeof e === 'object' && !Array.isArray(e))
    .map((e) => trimmed(e.at))
    .filter((at) => at !== null);
}

/**
 * Every stamp value present, in a fixed order (generated.at…, timestamp), each with the
 * field it came from. V5 validates all of them; `conceptStamp` picks among them.
 */
export function stampValues(fields) {
  if (fields === null || typeof fields !== 'object') return [];
  const out = [];
  for (const key of EVENT_FIELDS) {
    for (const value of eventAts(fields[key])) out.push({ value, field: `${key}.at` });
  }
  const ts = trimmed(fields.timestamp);
  if (ts !== null) out.push({ value: ts, field: 'timestamp' });
  return out;
}

/**
 * The newest parseable stamp, as `{value, field}` so a message can name the shape it read. When
 * values are present but none parses, the first comes back unchanged: the caller's `Date.parse`
 * then yields NaN and counts the page unstampable, rather than this function hiding it as "no stamp".
 * No value at all is `null`.
 */
export function conceptStamp(fields) {
  const values = stampValues(fields);
  if (values.length === 0) return null;
  let newest = null;
  for (const v of values) {
    const ms = Date.parse(v.value);
    if (Number.isNaN(ms)) continue;
    if (newest === null || ms > newest.ms) newest = { ...v, ms };
  }
  if (newest === null) return values[0];
  return { value: newest.value, field: newest.field };
}
