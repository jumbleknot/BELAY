#!/usr/bin/env node
// Override-floor consistency gate — both halves of every security override must move together.
//
// WHY THIS EXISTS. BELAY's constitution puts dependency-security overrides in pnpm-workspace.yaml's
// `overrides:` map. Every entry there is a security control, and each keyed one is stored as a RANGE
// KEYED ON A RANGE:
//
//     fast-uri@<3.1.4: '>=3.1.4 <4'
//               ^^^^^     ^^^^^
//               the vulnerable span excluded, and the patched floor forced
//
// Raise the value to `>=3.1.5 <4` and leave the key at `<3.1.4` and you get an override that reads
// as remediated but no longer excludes the version its own key names. Ported from
// MovieCollectionManager (MCM), which paid for this failure once in its other instance: a raised
// package.json nx version with nx.json left behind, where the stale half won at runtime and the
// security update would not have taken effect. check-toolchain-consistency.mjs guards that pair;
// this is the same guard for the other lockstep pair.
//
// AND IT IS NOT A HYPOTHETICAL. Renovate's built-in npm manager extracts this file (measured in MCM:
// 12 deps) — but it reads `fast-uri@<3.1.4` as an opaque DEPNAME and `>=3.1.4 <4` as the version.
// The key half is invisible to it. So every floor RAISE the bot proposes is a half-bump by
// construction, and this gate is what stops one being reviewable as correct.
//
// BELAY has no override yet. The gate is in place before the first one lands, so that first one is
// gated; until then each scan prints that it examined 0 keyed overrides, so a pass over nothing is
// visible as nothing.
//
// THE RULE — for every override whose KEY carries an `@<range>` suffix:
//
//     the key's EXCLUSIVE UPPER bound (the version after `<`)
//       must equal
//     the value's INCLUSIVE LOWER bound (the version after `>=`)
//
// SCOPE, and the single most likely way to get this wrong: a legitimate PLAIN PIN (`react-dom`,
// `postcss`, `@scope/plain-pin`) has no key half at all. It is out of the rule's scope, not a
// violation — a gate that fails on correct input is worse than no gate. The package-name split
// therefore uses the LAST `@`, so a scoped name (`@scope/name@<1.2.3`) parses and a bare scoped pin
// (`@scope/plain-pin`) does not look like a keyed floor.
//
// A half that cannot be parsed is refused OUT LOUD (exit 2), never skipped. Silently passing over
// the entry it cannot read is how a gate comes to protect nothing.
//
// THE CAP RULE — the OTHER half of the value. Renovate's npm manager reads a keyed override's value
// as a plain version range and "widens" its upper bound to admit the newest major:
// `undici@<6.27.0: '>=6.27.0 <7'` arrives as `'>=6.27.0 <9'`. The floor is untouched, so the rule
// above stays green, and no advisory is any closer to closed. What the widening DOES is hand a
// dependent that resolved into the vulnerable span a different MAJOR than it declared — a silent
// cross-major substitution of a transitive (measured in MCM: js-yaml 5 arrived exactly this way, and
// six such proposals were pending at once). So, for every keyed floor:
//
//     the value's exclusive upper bound (its cap)   must be   <=  (the key's major) + 1
//
// where the key's major is the major of the key's own `<` bound (equal to the floor, by the rule
// above). A cap TIGHTER than the next major is fine. A value with NO cap admits every major already;
// it is out of scope but NAMED on every run rather than passed in silence. A value not written as
// `>=A` or `>=A <B` (a `<=` cap, a `||` union, a caret) is refused with exit 2: the gate cannot say
// what such a cap admits, and guessing is how a widening gets through.
//
// Usage:
//   node scripts/check-override-consistency.mjs              # scan; exit 0 clean / 1 mismatch
//   node scripts/check-override-consistency.mjs --selftest   # prove detection; exit 0/1
//   node scripts/check-override-consistency.mjs --dir <root> # scan a different repo root (tests)
//   node scripts/check-override-consistency.mjs --help
//
// Exit codes: 0 clean · 1 mismatch found / selftest broken · 2 bad args, unreadable or unparseable.

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, LineCounter, isMap, isScalar } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const USAGE = 'Usage: check-override-consistency.mjs [--selftest | --dir <root> | --help]';

/**
 * Split an override key into its package name and its vulnerable-range suffix.
 *
 * Returns `null` for a PLAIN PIN — a key with no range half, which this gate does not govern.
 * The split is on the LAST `@` so that `@scope/name@<1.2.3` yields `@scope/name`, while a bare
 * `@scope/plain-pin` (whose only `@` is the scope marker at index 0) is correctly a plain pin.
 */
export function parseOverrideKey(key) {
  const at = key.lastIndexOf('@');
  if (at <= 0) return null;
  return { name: key.slice(0, at), vulnerableRange: key.slice(at + 1) };
}

/** The version after `<` in a range — the exclusive upper bound. `null` when absent. */
export function exclusiveUpperBound(range) {
  const m = String(range).match(/<\s*(\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}

/** The version after `>=` in a range — the inclusive lower bound. `null` when absent. */
export function inclusiveLowerBound(range) {
  const m = String(range).match(/>=\s*(\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}

/**
 * The ONLY value shapes the cap rule can read: `>=A` (uncapped) or `>=A <B`. Anything else — `<=`,
 * `||`, `^`, `~`, a hyphen range — admits versions this gate cannot bound, so it is refused.
 */
const VALUE_FORM = /^\s*>=\s*\d+(?:\.\d+)*\s*(?:<\s*\d+(?:\.\d+)*\s*)?$/;

/** The major of a dotted version string. */
export function majorOf(version) {
  return Number(String(version).split('.')[0]);
}

/** `3.1.4` → [3,1,4]; shorter forms pad with zeros so `4` and `4.0.0` compare equal. */
function parseVersion(v) {
  const [a = 0, b = 0, c = 0] = String(v).split('.').map(Number);
  return [a, b, c];
}

/**
 * Ordered comparison: negative when `x < y`, 0 when equal, positive when `x > y`.
 *
 * Exported so a tool that asks whether an override's permitted range already admits a published fix
 * reuses ONE definition of how a version is parsed and ordered; a second dialect elsewhere is
 * precisely how two halves of a pair drift apart, which is the class of fault this gate catches.
 */
export function compareVersions(x, y) {
  const a = parseVersion(x);
  const b = parseVersion(y);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function sameVersion(x, y) {
  return compareVersions(x, y) === 0;
}

/**
 * Compare both halves of every keyed floor in an `overrides` map.
 *
 * @returns {{mismatches: Array, unparseable: Array, capViolations: Array, uncapped: Array,
 *            checked: number, skipped: number}}
 */
export function findOverrideMismatches(overrides) {
  const mismatches = [];
  const unparseable = [];
  const capViolations = [];
  const uncapped = [];
  let checked = 0;
  let skipped = 0;

  for (const [key, value] of Object.entries(overrides ?? {})) {
    const parsed = parseOverrideKey(key);
    if (!parsed) {
      skipped += 1; // plain pin — no key half, out of scope by design
      continue;
    }

    const keyUpper = exclusiveUpperBound(parsed.vulnerableRange);
    const valueLower = inclusiveLowerBound(value);

    if (keyUpper === null) {
      unparseable.push({ key, value, problem: `the vulnerable-range key '${parsed.vulnerableRange}' carries no '<' upper bound, so its half cannot be compared` });
      continue;
    }
    if (valueLower === null) {
      unparseable.push({ key, value, problem: `the patched-floor value '${value}' carries no '>=' lower bound, so its half cannot be compared` });
      continue;
    }

    if (!VALUE_FORM.test(String(value))) {
      unparseable.push({ key, value, problem: `the value '${value}' is not of the form '>=A' or '>=A <B', so the cap rule cannot say which majors it admits` });
      continue;
    }

    checked += 1;
    if (!sameVersion(keyUpper, valueLower)) {
      mismatches.push({ name: parsed.name, key, value, keyUpper, valueLower });
    }

    const cap = exclusiveUpperBound(value);
    if (cap === null) {
      uncapped.push({ name: parsed.name, key, value });
      continue;
    }
    const keyMajor = majorOf(keyUpper);
    const maxCap = `${keyMajor + 1}`;
    if (compareVersions(cap, maxCap) > 0) {
      capViolations.push({ name: parsed.name, key, value, cap, keyMajor, maxCap });
    }
  }

  return { mismatches, unparseable, capViolations, uncapped, checked, skipped };
}

/**
 * Read and parse the `overrides` map from a repository root, with the 1-based line of each key.
 * Throws with a readable message when the file is missing or not valid YAML.
 *
 * @returns {{overrides: Record<string, string>, lines: Record<string, number>}}
 */
export function readOverrides(root) {
  const path = join(root, WORKSPACE_FILE);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`could not read ${path}: ${e.message}`);
  }
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  if (doc.errors.length) throw new Error(`could not parse ${path}: ${doc.errors[0].message}`);

  const node = isMap(doc.contents) ? doc.contents.get('overrides', true) : null;
  if (node == null) return { overrides: {}, lines: {} };
  if (!isMap(node)) throw new Error(`could not parse ${path}: \`overrides\` is not a map`);

  const overrides = {};
  const lines = {};
  for (const pair of node.items) {
    const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
    overrides[key] = isScalar(pair.value) ? String(pair.value.value ?? '') : String(pair.value ?? '');
    lines[key] = pair.key?.range ? lineCounter.linePos(pair.key.range[0]).line : 1;
  }
  return { overrides, lines };
}

const mismatchMessage = (m) =>
  `${m.key}: '${m.value}' — the key still names ${m.keyUpper} as the vulnerable boundary while the ` +
  `floor forces ${m.valueLower}. Raise both halves together: an override that excludes a range it no ` +
  'longer forces is a half-remediation.';

const capMessage = (c) =>
  `${c.key}: '${c.value}' — a major-${c.keyMajor} floor whose cap <${c.cap} admits majors above ` +
  `${c.keyMajor}; the cap may be at most <${c.maxCap}. A wider cap fixes no advisory (the floor is ` +
  'unchanged) and silently hands every dependent in the vulnerable span a major it never declared. ' +
  "If Renovate proposed this, reject it: its npm manager reads the value as a direct range. A genuine " +
  'floor raise moves both halves and keeps the cap.';

function runScan(root) {
  let overrides;
  let lines;
  try {
    ({ overrides, lines } = readOverrides(root));
  } catch (e) {
    console.error(`[override-consistency] could not run: ${e.message}`);
    process.exit(2);
  }

  const { mismatches, unparseable, capViolations, uncapped, checked, skipped } = findOverrideMismatches(overrides);
  const at = (key) => `${WORKSPACE_FILE}:${lines[key] ?? 1}`;

  if (unparseable.length) {
    for (const u of unparseable) console.error(`${at(u.key)}: override-unparseable: ${u.key}: ${JSON.stringify(u.value)} — ${u.problem}`);
    console.error(
      `[override-consistency] could not run: ${unparseable.length} keyed override(s) could not be read. A half ` +
        'this gate cannot parse is refused rather than skipped: silently passing over it would leave the control unguarded.',
    );
    process.exit(2);
  }

  if (mismatches.length || capViolations.length) {
    for (const m of mismatches) console.error(`${at(m.key)}: override-floor: ${mismatchMessage(m)}`);
    for (const c of capViolations) console.error(`${at(c.key)}: override-cap: ${capMessage(c)}`);
    console.error(
      `[override-consistency] ❌ examined ${checked} keyed override(s): ${mismatches.length} disagree on the ` +
        `patched floor, ${capViolations.length} cap past their major.`,
    );
    process.exit(1);
  }

  const uncappedNote = uncapped.length
    ? `; ${uncapped.length} uncapped floor(s) admit every major and are outside the cap rule: ${uncapped.map((u) => u.key).join(', ')}`
    : '';
  console.log(
    `[override-consistency] ✅ examined ${checked} keyed override(s) in ${WORKSPACE_FILE}: every key agrees ` +
      `with its floor and none caps past its major; ${skipped} plain pin(s) carry no key half and are out ` +
      `of scope${uncappedNote}.`,
  );
}

function selftest() {
  const fails = [];
  const t = (label, cond) => { if (!cond) fails.push(label); };
  const only = (overrides) => findOverrideMismatches(overrides);

  // (a) value raised, key left stale — the half-bump this gate exists for.
  const a = only({ 'fast-uri@<3.1.4': '>=3.1.5 <4' });
  t('(a) a raised value with a stale key is a mismatch', a.mismatches.length === 1 && a.mismatches[0].name === 'fast-uri');

  // (b) key raised, value left stale — the mismatch is symmetric.
  const b = only({ 'fast-uri@<3.1.5': '>=3.1.4 <4' });
  t('(b) a raised key with a stale value is a mismatch', b.mismatches.length === 1);

  // (c) both halves agreeing.
  t('(c) an agreeing pair is clean', only({ 'fast-uri@<3.1.4': '>=3.1.4 <4' }).mismatches.length === 0);

  // (c2) a compound vulnerable range — only the `<` bound is in scope.
  const c2 = only({ 'js-yaml@>=3.0.0 <3.15.1': '>=3.15.1 <4' });
  t('(c2) a compound key compares only its `<` bound', c2.mismatches.length === 0 && c2.checked === 1);

  // (d) legitimate plain pins — out of scope, NOT violations.
  const d = only({ 'react-dom': '19.2.3', postcss: '>=8.5.18', '@scope/plain-pin': '^56.0.5' });
  t('(d) plain pins are skipped, not flagged', d.mismatches.length === 0 && d.checked === 0 && d.skipped === 3);

  // (e) a scoped name splits on the LAST `@`.
  t('(e) a scoped keyed floor parses on the last @', parseOverrideKey('@scope/name@<1.2.3')?.name === '@scope/name');
  t('(e) a bare scoped pin is not mistaken for a keyed floor', parseOverrideKey('@scope/plain-pin') === null);
  t('(e) a scoped keyed floor is still checked', only({ '@scope/name@<1.2.3': '>=1.2.4 <2' }).mismatches.length === 1);

  // (f) a value with no `>=` bound is refused out loud, never silently skipped.
  const f = only({ 'fast-uri@<3.1.4': '^3.1.4' });
  t('(f) an unparseable value is reported, not skipped', f.unparseable.length === 1 && f.mismatches.length === 0 && f.checked === 0);

  // Bound extraction, pinned directly.
  t('exclusiveUpperBound reads the < bound', exclusiveUpperBound('>=3.0.0 <3.15.1') === '3.15.1');
  t('inclusiveLowerBound reads the >= bound', inclusiveLowerBound('>=3.15.1 <4') === '3.15.1');
  t('a version with fewer parts still compares equal', only({ 'x@<4': '>=4.0.0' }).mismatches.length === 0);

  // (cap) the value's cap may not admit a major above the key's.
  const capWiden = only({ 'undici@<6.27.0': '>=6.27.0 <9' });
  t('(cap) a cap widened past the key major is flagged', capWiden.capViolations.length === 1 && capWiden.capViolations[0].name === 'undici');
  t('(cap) the major-bounded value is clean', only({ 'undici@<6.27.0': '>=6.27.0 <7' }).capViolations.length === 0);
  t('(cap) a floor raise inside the major is clean', only({ 'undici@<6.28.0': '>=6.28.0 <7' }).capViolations.length === 0);
  t('(cap) a plain pin is out of scope', only({ 'react-dom': '19.2.3' }).capViolations.length === 0);
  const uncapped = only({ 'form-data@<4.0.6': '>=4.0.6' });
  t('(cap) an uncapped floor is named, not flagged', uncapped.capViolations.length === 0 && uncapped.uncapped.length === 1);
  t('(cap) a `<=` cap is refused as unparseable', only({ 'undici@<6.27.0': '>=6.27.0 <=8.0.0' }).unparseable.length === 1);
  t('(cap) a `||` value is refused as unparseable', only({ 'undici@<6.27.0': '>=6.27.0 <7 || >=8.0.0' }).unparseable.length === 1);

  // An empty map is a clean, countable nothing.
  const empty = only({});
  t('an empty overrides map examines 0 and finds nothing', empty.checked === 0 && empty.skipped === 0 && empty.mismatches.length === 0);

  if (fails.length) {
    console.error('[override-consistency --selftest] ❌ FAILED:\n  - ' + fails.join('\n  - '));
    process.exit(1);
  }
  console.log('[override-consistency --selftest] ✅ half-bump detection in both directions, plain-pin scoping, scoped names, unparseable halves, the major cap.');
}

function parseArgs(argv) {
  const opts = { selftest: false, help: false, dir: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') opts.selftest = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--dir') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: '--dir needs a directory' };
      opts.dir = resolve(v);
    } else return { error: `Unknown argument: ${a}` };
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`${opts.error}. ${USAGE}`);
    process.exit(2);
  }
  if (opts.help) console.log(USAGE);
  else if (opts.selftest) selftest();
  else runScan(opts.dir);
}

// RUN ONLY WHEN INVOKED DIRECTLY. In MCM this body was once top-level, so IMPORTING the file for its
// parsers ran the whole scan and could `process.exit` out of the importing process, reporting the exit
// as that caller's result. Importing must stay side-effect free.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
