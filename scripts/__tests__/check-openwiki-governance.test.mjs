// Tests for the OpenWiki governance gate (scripts/check-openwiki-governance.mjs).
//
// Drives the REAL gate CLI as a subprocess against one mini-repository fixture per rule and asserts
// the gate contract's exit codes: 0 clean / selftest passed · 1 violation / selftest broken · 2 bad
// args. The rules (G0–G16) are listed in the gate's header.
//
// Deterministic, offline, token-free, `node:` built-ins + `yaml`; runs in CI under `scripts:test`.
//
// Ported from MovieCollectionManager. BELAY differences, each with a case here:
//   * BELAY has no wiki generator, so no openwiki/policy.yaml. An ABSENT policy means "no generated
//     paths" (the `valid` baseline has none); the policy rules G1–G4/G12 are exercised against the
//     `with-policy` baseline, so they still hold the day a generator arrives.
//   * The only machine-managed region in BELAY's AGENTS.md is Spec Kit's. MCM's Nx and generator
//     regions are NOT exempt here.
// The fixtures are BELAY-shaped; see fixtures/openwiki-governance/README.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = join(REPO_ROOT, 'scripts', 'check-openwiki-governance.mjs');
const FIXTURES = join(REPO_ROOT, 'scripts', '__tests__', 'fixtures', 'openwiki-governance');

function runGate(args) {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const onFixture = (name, ...extra) => runGate(['--root', join(FIXTURES, name), ...extra]);

/** A writable copy of a fixture, for the cases that need a mutation the fixture tree does not hold. */
function copyFixture(name) {
  const dir = mkdtempSync(join(tmpdir(), 'governance-'));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

// ── the baseline ────────────────────────────────────────────────────────────────

test('a fully governed mini-repository passes with no findings', () => {
  const { code, out } = onFixture('valid');
  assert.equal(code, 0, `expected exit 0, got ${code}\n${out}`);
});

test('the with-policy baseline (a policy file that declares every path legally) passes', () => {
  const { code, out } = onFixture('with-policy');
  assert.equal(code, 0, `expected exit 0, got ${code}\n${out}`);
});

// ── an ABSENT policy file: no generator, so no generated paths ──────────────────

test('an absent policy file means no generated paths: an unclassified doc path is not a finding', () => {
  // BELAY's shape. With no generator there is nothing to declare, so G1 has no question to ask. The
  // gate must not invent a requirement for a file whose only purpose is to constrain a generator.
  const dir = copyFixture('valid');
  try {
    writeFileSync(join(dir, 'docs', 'orphan-note.md'), '# A note no policy entry classifies\n');
    const { code, out } = runGate(['--root', dir]);
    assert.equal(code, 0, `an absent policy must not raise G1\n${out}`);
    assert.doesNotMatch(out, /\(G0\)|\(G1\)/);
    assert.match(out, /no generated paths/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadPolicy: an absent file is an empty, absent policy that classifies nothing', async () => {
  const { loadPolicy, resolvePolicy } = await import(new URL('../openwiki-policy.mjs', import.meta.url).href);
  const policy = loadPolicy(join(FIXTURES, 'valid'));
  assert.equal(policy.absent, true);
  assert.deepEqual(policy.entries, []);
  // Never "everything is permitted": with no entries, nothing resolves.
  assert.equal(resolvePolicy(policy, 'openwiki/runbooks/devcontainer.md'), null);
  assert.equal(loadPolicy(join(FIXTURES, 'with-policy')).absent, false);
});

test('--explain with no policy file says nothing is generated, and exits 0', () => {
  const { code, out } = onFixture('valid', '--explain', 'openwiki/runbooks/devcontainer.md');
  assert.equal(code, 0, out);
  assert.match(out, /no openwiki\/policy\.yaml/);
});

// ── G1–G4, G12: the policy declaration, when a policy file is present ───────────

test('G1 a documentation path no policy entry matches fails', () => {
  const { code, out } = onFixture('unclassified-path');
  assert.equal(code, 1, out);
  assert.match(out, /G1/);
  assert.match(out, /orphan-note\.md/, 'the finding must name the unclassified path');
});

test('G2 a policy value outside the five declared states fails', () => {
  const { code, out } = onFixture('invalid-policy-value');
  assert.equal(code, 1, out);
  assert.match(out, /G2/);
  assert.match(out, /sometimes/, 'and name the offending value');
});

test('G3 `actor: generator` outside openwiki/ fails', () => {
  // The generator's write scope is the bundle; every other `regenerate` assignment governs an agent
  // under human review, and widening that is a separate decision rather than a policy edit.
  const { code, out } = onFixture('generator-outside-bundle');
  assert.equal(code, 1, out);
  assert.match(out, /G3/);
  assert.match(out, /docs\/runbooks/);
  assert.match(out, /generator/);
});

test('G4 an event-driven entry with no events fails', () => {
  const { code, out } = onFixture('event-driven-without-events');
  assert.equal(code, 1, out);
  assert.match(out, /G4/);
  assert.match(out, /docs\/decisions/);
});

test('G12 an authoritative concept whose effective policy is `regenerate` fails', () => {
  // An authoritative concept has no upstream document, so a "refresh" has nothing to refresh FROM —
  // it could only paraphrase, which is exactly what the fingerprints exist to stop.
  const { code, out } = onFixture('authoritative-declared-regenerate');
  assert.equal(code, 1, out);
  assert.match(out, /G12/);
  assert.match(out, /instrument-traps\.md/);
});

test('policy precedence anchors on path segments, not glob length', () => {
  // Ranking by raw length made `**/README.md` outrank `.specify/**`, so a README inside an excluded
  // tree resolved to `regenerate`. "A rule about THIS directory beats a rule about files anywhere."
  const { code, out } = onFixture('with-policy', '--explain', 'openwiki/gotchas/instrument-traps.md');
  assert.equal(code, 0, out);
  assert.match(out, /openwiki\/gotchas\/instrument-traps\.md/);
  assert.match(out, /event-driven/, 'the specific per-concept entry must win over openwiki/**');
});

// ── G5–G7: protected passages ───────────────────────────────────────────────────

test('G5 a reworded protected passage fails and says what changed', () => {
  const { code, out } = onFixture('reworded-passage');
  assert.equal(code, 1, out);
  assert.match(out, /G5/);
  assert.match(out, /instrument-traps\.md/, 'name the concept');
  assert.match(out, /A skipped test reads as a pass/, 'name the anchor');
  // A reader may not know the passage was protected, so the failure has to explain itself.
  assert.match(out, /fingerprint|protected/i);
});

test('G6 a DELETED protected passage fails as a removal', () => {
  // The manifest is the authority. A fingerprint comparison against absent text must not pass for
  // lack of anything to compare — a protected passage can only be deliberately delisted, never
  // silently dropped.
  const { code, out } = onFixture('deleted-passage');
  assert.equal(code, 1, out);
  assert.match(out, /G6/);
  assert.match(out, /remov|missing|absent/i);
  assert.match(out, /A skipped test reads as a pass/);
});

test('G7 a protected passage on a concept that cites a resource fails', () => {
  // Freezing a derived summary against the document it summarizes would fail every legitimate
  // refresh, turning protection into a permanent blocker.
  const { code, out } = onFixture('protected-on-derived');
  assert.equal(code, 1, out);
  assert.match(out, /G7/);
  assert.match(out, /devcontainer\.md/);
  assert.match(out, /resource/);
});

test('the escape hatch: passage and fingerprint corrected together passes', () => {
  // Without this the gate is a permanent blocker on correcting the very content it protects, and a
  // gate people have to work around is worse than no gate.
  const { code, out } = onFixture('fingerprint-updated');
  assert.equal(code, 0, `the sanctioned correction must pass, got ${code}\n${out}`);
});

// ── fingerprint normalization ───────────────────────────────────────────────────

test('normalization ignores line endings and trailing whitespace', () => {
  const { code, out } = onFixture('whitespace-drift');
  assert.equal(code, 0, `CRLF and trailing spaces are not a content change, got ${code}\n${out}`);
});

test('normalization does NOT ignore a word change', () => {
  // Over-normalizing would let a meaning-changing edit pass, which is the failure this whole gate
  // exists to prevent. `reworded-passage` differs from `valid` by two words.
  assert.equal(onFixture('reworded-passage').code, 1);

  // ...and by one word, in case the difference above was doing the work.
  const dir = copyFixture('valid');
  try {
    const page = join(dir, 'openwiki', 'gotchas', 'instrument-traps.md');
    writeFileSync(page, readFileSync(page, 'utf8').replace('looks like a', 'is not a'));
    const { code, out } = runGate(['--root', dir]);
    assert.equal(code, 1, `a single-word inversion must fail\n${out}`);
    assert.match(out, /G5/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--fingerprint prints the value the manifest should carry', () => {
  const { code, out } = onFixture('valid', '--fingerprint', 'openwiki/gotchas/instrument-traps.md', 'A skipped test reads as a pass');
  assert.equal(code, 0, out);
  const printed = out.match(/sha256:[0-9a-f]{64}/)?.[0];
  assert.ok(printed, `expected a sha256 value, got: ${out}`);
  const manifest = readFileSync(join(FIXTURES, 'valid', 'openwiki', 'protected.yaml'), 'utf8');
  assert.ok(manifest.includes(printed), 'the computed value must match what the passing fixture declares');
});

// ── G8–G10: the index and the assistant surfaces ────────────────────────────────

test('G8 prose in AGENTS.md beyond the index and the managed regions fails', () => {
  // Without this the file silently re-grows and the trim is undone within weeks. AGENTS.md is the
  // instruction file; CLAUDE.md is a shim that imports it.
  const { code, out } = onFixture('index-stray-prose');
  assert.equal(code, 1, out);
  assert.match(out, /G8/);
  assert.match(out, /AGENTS\.md/);
});

test('G8 prose INSIDE the Spec Kit managed region is exempt', () => {
  // Spec Kit's agent-context step rewrites that region wholesale. A gate that fought it would fail on
  // content no human can fix, and would be switched off.
  assert.equal(onFixture('valid').code, 0);
  const dir = copyFixture('valid');
  try {
    const file = join(dir, 'AGENTS.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace(
      'Machine-managed by Spec Kit.',
      'Machine-managed by Spec Kit. A whole paragraph of prose, rewritten by the tool on every run, which no\nhuman edits and no gate may reject.',
    ));
    const { code, out } = runGate(['--root', dir]);
    assert.equal(code, 0, `managed-region prose must be exempt\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('G8 a managed region BELAY does not have is NOT exempt', () => {
  // MovieCollectionManager also exempts an Nx region and its generator's OPENWIKI region. BELAY has
  // neither tool writing AGENTS.md, so a block wearing either marker is hand-written prose in disguise.
  for (const [start, end] of [['<!-- nx configuration start-->', '<!-- nx configuration end-->'], ['<!-- OPENWIKI:START -->', '<!-- OPENWIKI:END -->']]) {
    const dir = copyFixture('valid');
    try {
      const file = join(dir, 'AGENTS.md');
      writeFileSync(file, `${readFileSync(file, 'utf8')}\n${start}\nA paragraph of prose hiding behind a marker no tool here writes.\n${end}\n`);
      const { code, out } = runGate(['--root', dir]);
      assert.equal(code, 1, `${start} must not exempt its contents\n${out}`);
      assert.match(out, /G8/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('G16 an AGENTS.md line over the size budget fails, even though it carries a link', () => {
  // G8 alone does not bound the file: a line passes G8 by carrying a link, however long its prose.
  const dir = copyFixture('valid');
  try {
    const file = join(dir, 'AGENTS.md');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n- **A gate** — ${'a story that belongs in the runbook '.repeat(20)}— [traps](openwiki/gotchas/instrument-traps.md)\n`);
    const { code, out } = runGate(['--root', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /G16/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('G9 an index entry pointing at a concept that does not exist fails', () => {
  const { code, out } = onFixture('dangling-index-entry');
  assert.equal(code, 1, out);
  assert.match(out, /G9/);
  assert.match(out, /gone\.md/);
});

test('G10 an assistant surface pointing at moved content fails', () => {
  const { code, out } = onFixture('stale-assistant-surface');
  assert.equal(code, 1, out);
  assert.match(out, /G10/);
  assert.match(out, /opencode\.json/);
  assert.match(out, /docs\/devcontainer\.md/);
});

// ── G15: CLAUDE.md is a shim that imports AGENTS.md ─────────────────────────────

test('G15 content added to the CLAUDE.md shim fails', () => {
  // Claude would see it and a tool that reads only AGENTS.md never would; a copy of AGENTS.md there
  // would make a tool that reads both load everything twice.
  const { code, out } = onFixture('claude-shim-content');
  assert.equal(code, 1, out);
  assert.match(out, /G15/);
  assert.match(out, /CLAUDE\.md/);
  assert.match(out, /A gate added in the wrong file/);
});

test('G15 a CLAUDE.md that no longer imports AGENTS.md fails', () => {
  const { code, out } = onFixture('claude-shim-no-import');
  assert.equal(code, 1, out);
  assert.match(out, /G15/);
  assert.match(out, /@AGENTS\.md/);
});

test('G15 a missing CLAUDE.md fails rather than passing for lack of a file', () => {
  const dir = copyFixture('valid');
  try {
    rmSync(join(dir, 'CLAUDE.md'));
    const { code, out } = runGate(['--root', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /G15/);
    assert.match(out, /missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── G11: every concept is exactly one of derived or authoritative ───────────────

test('G11 a concept that is neither derived nor authoritative fails', () => {
  // This is what turns the routing rule from a convention into something checkable: without a class,
  // "does a learning about this subject go upstream or into the concept?" has no mechanical answer.
  const { code, out } = onFixture('unclassified-concept');
  assert.equal(code, 1, out);
  assert.match(out, /G11/);
  assert.match(out, /nameless\.md/);
  assert.match(out, /neither/i);
});

test('G11 a concept that is BOTH derived and authoritative fails', () => {
  const { code, out } = onFixture('both-classifications');
  assert.equal(code, 1, out);
  assert.match(out, /G11/);
  assert.match(out, /devcontainer\.md/);
  assert.match(out, /both/i);
});

test('G11 a concept whose resource does not resolve is not silently derived', () => {
  const dir = copyFixture('valid');
  try {
    const page = join(dir, 'openwiki', 'runbooks', 'devcontainer.md');
    writeFileSync(page, readFileSync(page, 'utf8').replace('resource: docs/runbooks/devcontainer.md', 'resource: docs/runbooks/gone.md'));
    const { code, out } = runGate(['--root', dir]);
    assert.equal(code, 1, `a dangling citation makes the concept unclassifiable\n${out}`);
    assert.match(out, /G11/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── fail-closed, and the CLI contract ──────────────────────────────────────────

test('a missing protection manifest is a violation, never a skip', () => {
  const { code, out } = onFixture('missing-manifest');
  assert.equal(code, 1, out);
  assert.match(out, /protected\.yaml/);
});

test('a PRESENT but unparseable policy file is a violation, never a skip', () => {
  const { code, out } = onFixture('unparseable-policy');
  assert.equal(code, 1, out);
  assert.match(out, /policy\.yaml/);
});

test('there is no skip flag and no allowlist', () => {
  // Matching the OKF gate's V10 posture: a rejected page is fixed in the page or in INSTRUCTIONS.md,
  // never accepted in place. An allowlisted leak stays leaked.
  const source = readFileSync(GATE, 'utf8');
  const code = source.split('\n').filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
  for (const forbidden of ['--skip', '--allow', 'allowlist', 'ALLOWLIST']) {
    assert.ok(!code.some((l) => l.includes(forbidden)), `the gate must not offer \`${forbidden}\``);
  }
});

test('--selftest proves the rules still detect their cases', () => {
  const { code, out } = runGate(['--selftest']);
  assert.equal(code, 0, out);
  assert.match(out, /G1/);
  assert.match(out, /G12/);
  assert.match(out, /G14/); // G13 retired with openwiki Claims; G14 replaced it
});

test('--json emits machine-readable findings', () => {
  const r = spawnSync(process.execPath, [GATE, '--root', join(FIXTURES, 'reworded-passage'), '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.findings));
  assert.equal(parsed.findings[0].rule, 'G5');
  assert.ok(parsed.findings[0].message.length > 0);
});

test('--help prints the usage and exits 0 without validating', () => {
  const { code, out } = runGate(['--help']);
  assert.equal(code, 0, out);
  assert.match(out, /Usage: node scripts\/check-openwiki-governance\.mjs/);
  assert.doesNotMatch(out, /violation|classified/);
});

test('bad usage exits 2', () => {
  assert.equal(runGate(['--nope']).code, 2);
  assert.equal(runGate(['--root']).code, 2);
});

// ── the real repository ─────────────────────────────────────────────────────────

test('the real repository passes its own governance gate', () => {
  const { code, out } = runGate([]);
  assert.equal(code, 0, `the repository must satisfy the rules it enforces\n${out}`);
});

// ── list-valued actor ───────────────────────────────────────────────────────────
test('actorMembers and resolvePolicy: a list-valued actor, most-specific entry wins', async () => {
  const { actorMembers, resolvePolicy, globToRegExp } = await import(new URL('../openwiki-policy.mjs', import.meta.url).href);
  const entry = (glob, policy, actor) => ({ glob, policy, actor, matcher: globToRegExp(glob), exceptionMatchers: [] });
  const policy = { entries: [entry('openwiki/**', 'regenerate', ['agent', 'generator']), entry('openwiki/gotchas/x.md', 'event-driven', 'agent')] };
  assert.deepEqual(actorMembers(['agent', 'generator']), ['agent', 'generator']);
  assert.deepEqual(actorMembers('agent'), ['agent']);
  assert.deepEqual(actorMembers(undefined), []);
  assert.equal(resolvePolicy(policy, 'openwiki/gotchas/x.md').policy, 'event-driven');
  assert.equal(resolvePolicy(policy, 'openwiki/runbooks/y.md').policy, 'regenerate');
  assert.equal(resolvePolicy(policy, 'docs/z.md'), null);
});
