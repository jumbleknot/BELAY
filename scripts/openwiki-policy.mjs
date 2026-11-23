// Shared reader for openwiki/policy.yaml: the declared regeneration policy of each documentation path.
//
// In MovieCollectionManager, where this was written, a paid generator rewrites the bundle, and the
// policy says which paths it (or an agent) may regenerate. The governance gate checks the
// DECLARATION (rules G1–G4, G12): every documentation path has a legal assignment, and the generator's
// write scope stays inside the bundle.
//
// BELAY has NO generator, so BELAY has no policy.yaml. A missing file therefore reads as "no generated
// paths" (`{absent: true, entries: []}`) and the gate skips the declaration rules, because there is
// nothing to declare. That is safe ONLY because nothing writes the bundle but a reviewed session: the
// day a generator is added, it needs a policy.yaml, and from then on every rule here applies to it,
// fail-closed. A policy file that is PRESENT but unparseable is still an error, never a skip.
//
// The generator-runtime helpers MCM keeps here (coverage targets, may-write checks) were not ported:
// they serve MCM's maintenance run, which BELAY does not have.
//
// `node:` built-ins + `yaml` only. No network, no credential.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const POLICY_FILE = 'openwiki/policy.yaml';

/** The five declared states. Anything else is a G2 violation. */
export const POLICY_STATES = Object.freeze([
  'regenerate',
  'event-driven',
  'excluded',
  'never-written',
  'analyzable-not-covered',
]);

export const ACTORS = Object.freeze(['agent', 'generator']);

/**
 * The members of an entry's `actor`, which may be one name or a list: a bundle can be written both by
 * coding sessions (`agent`) and by a manual rebuild (`generator`). Absent is `[]`. A non-string member
 * is returned as-is so G2 can name it.
 */
export function actorMembers(actor) {
  if (actor === undefined || actor === null) return [];
  return Array.isArray(actor) ? actor : [actor];
}

/** The one place `actor: generator` is permitted: the generator's write scope is the bundle. */
export const GENERATOR_SCOPE_PREFIX = 'openwiki/';

/**
 * Translate a policy glob to a RegExp.
 *
 * Supported, and deliberately no more: `**` crossing separators, `*` and `?` within one segment.
 * `**\/` matches ZERO OR MORE leading directories, which is why a single `**\/README.md` entry covers
 * both the root README and every nested one.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 2;
        } else if (glob[i - 1] === '/') {
          re = re.replace(/\/$/, '') + '(?:/.*)?';
          i += 1;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+()[]{}^$|\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Load and compile the policy.
 *
 * ABSENT is `{absent: true, entries: []}`: no generator, so no generated paths (see the header). It is
 * never "everything is permitted": with no entries, `resolvePolicy` classifies nothing.
 * PRESENT but unparseable or misshapen THROWS, so a broken declaration is a finding, never a skip.
 */
export function loadPolicy(root) {
  const path = join(root, POLICY_FILE);
  if (!existsSync(path)) return { absent: true, version: null, entries: [] };

  let parsed;
  try {
    parsed = parseYaml(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${POLICY_FILE} does not parse: ${err.message.split('\n')[0]}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.paths)) {
    throw new Error(`${POLICY_FILE} must be a mapping with a \`paths\` list`);
  }

  const entries = parsed.paths.map((raw, i) => {
    if (raw === null || typeof raw !== 'object' || typeof raw.glob !== 'string') {
      throw new Error(`${POLICY_FILE}: entry ${i} has no \`glob\``);
    }
    if ('coverage' in raw && typeof raw.coverage !== 'boolean') {
      throw new Error(`${POLICY_FILE}: entry \`${raw.glob}\` has a non-boolean \`coverage\``);
    }
    return {
      ...raw,
      matcher: globToRegExp(raw.glob),
      exceptionMatchers: (Array.isArray(raw.exceptions) ? raw.exceptions : []).map(globToRegExp),
    };
  });

  return { absent: false, version: parsed.version ?? null, entries };
}

/**
 * How specific a glob is, as a tuple compared left to right:
 *   1. how many leading path segments are literal — i.e. how deeply the glob is ANCHORED
 *   2. how many literal (non-wildcard) characters it contains
 *   3. raw length, as a last resort
 *
 * Anchoring has to dominate, and getting this wrong is not academic: ranking by raw length alone made
 * `**\/README.md` (12 chars) outrank `.specify/**` (11), so a Spec Kit README — inside a tree declared
 * `excluded` — resolved to `regenerate` and MCM's planner proposed writing a concept about it. "A rule
 * about THIS directory beats a rule about files anywhere" is the intuition; segment anchoring is its
 * mechanical form.
 */
function specificity(glob) {
  const segments = glob.split('/');
  let anchored = 0;
  for (const s of segments) {
    if (s.includes('*') || s.includes('?')) break;
    anchored++;
  }
  const literals = glob.replace(/[*?/]/g, '').length;
  return [anchored, literals, glob.length];
}

const moreSpecific = (a, b) => {
  const sa = specificity(a);
  const sb = specificity(b);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i];
  return false; // equal — keep the earlier declaration
};

/**
 * The entry governing `path`, or null when nothing classifies it (a G1 violation).
 *
 * Resolution is MOST-SPECIFIC-WINS, with ties broken in declaration order. That is what lets a broad
 * `openwiki/**` assignment coexist with the narrower per-concept overrides layered on top of it;
 * first-match-wins would make declaration order load-bearing and turn a reordering into a policy
 * change.
 */
export function resolvePolicy(policy, path) {
  let best = null;
  for (const entry of policy.entries) {
    if (!entry.matcher.test(path)) continue;
    if (entry.exceptionMatchers.some((re) => re.test(path))) continue;
    if (best === null || moreSpecific(entry.glob, best.glob)) best = entry;
  }
  return best;
}
