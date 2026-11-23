// Tests for body-link scanning and normalization (scripts/openwiki-links.mjs).
//
// The OKF gate's rules V14 (site-root-absolute link) and V15 (relative link that does not resolve)
// read links through this module, and `normalizeLinks` is the mechanical remedy for V14. These tests
// pin the two properties that make that sharing safe: the scanner is length-preserving, and
// normalization moves NOTHING but the target inside `](…)`.
//
// Deterministic, offline, token-free, `node:` built-ins only; runs in CI under `scripts:test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maskCode, bodyLinks, classifyBodyLink, relativeFormFor, splitTarget, normalizeLinks } from '../openwiki-links.mjs';

// ── maskCode ────────────────────────────────────────────────────────────────────
test('maskCode preserves length exactly', () => {
  // Load-bearing: offsets from the masked text are spliced into the ORIGINAL text. If masking
  // changed the length, every rewrite after the first code span would land in the wrong place.
  const t = 'a `code` b\n\n```js\nconst x = 1;\n```\n\ntail\n';
  assert.equal(maskCode(t).length, t.length);
  assert.equal(maskCode(t).split('\n').length, t.split('\n').length);
});

test('maskCode blanks fences and code spans but leaves prose alone', () => {
  const masked = maskCode('keep `drop` keep\n```\ndrop\n```\nkeep\n');
  assert.match(masked, /keep/);
  assert.doesNotMatch(masked, /drop/);
});

test('maskCode closes a fence only on a matching-or-longer marker of the same kind', () => {
  // A ``` inside a ````-fenced block must not end it, or the rest of the file is scanned as prose.
  const t = '````\n```\n[x](/openwiki/a.md)\n````\n[y](/openwiki/b.md)\n';
  assert.deepEqual(bodyLinks(t).map((l) => l.target), ['/openwiki/b.md']);
});

// ── bodyLinks ───────────────────────────────────────────────────────────────────
test('bodyLinks reports offsets that index the ORIGINAL text', () => {
  const t = 'x [A](/a.md) y [B](/b.md) z';
  for (const l of bodyLinks(t)) {
    assert.equal(t.slice(l.targetIndex, l.targetIndex + l.targetLength), l.target);
  }
});

test('bodyLinks finds images, titled links and angle-bracket targets', () => {
  const t = '![i](img.png) [t](a.md "Title") [b](<b c.md>)';
  assert.deepEqual(bodyLinks(t).map((l) => l.target), ['img.png', 'a.md', 'b c.md']);
});

test('bodyLinks reports a 1-based line number', () => {
  assert.equal(bodyLinks('one\ntwo\n[x](a.md)\n')[0].line, 3);
});

// ── classifyBodyLink ────────────────────────────────────────────────────────────
test('classifyBodyLink separates site-root from relative, and skips what is not ours', () => {
  assert.equal(classifyBodyLink('/openwiki/a.md').kind, 'site-root');
  assert.equal(classifyBodyLink('a.md').kind, 'relative');
  assert.equal(classifyBodyLink('../a.md').kind, 'relative');
  for (const skip of ['#anchor', '', 'https://example.invalid/x', 'mailto:a@b.c', '//cdn.example/x']) {
    assert.equal(classifyBodyLink(skip).kind, 'skip', `${skip} should be skipped`);
  }
});

test('a protocol-relative URL is not mistaken for a site-root path', () => {
  // `//host/x` starts with `/` but is an absolute URL. Rewriting it would break a working link.
  const { text, rewrites } = normalizeLinks('[x](//cdn.example/a.md)\n', '/r/openwiki/p.md', '/r');
  assert.deepEqual(rewrites, []);
  assert.equal(text, '[x](//cdn.example/a.md)\n');
});

// ── splitTarget / relativeFormFor ───────────────────────────────────────────────
test('splitTarget separates a fragment from a percent-escaped path', () => {
  const s = splitTarget('b%20c.md#section');
  assert.equal(s.path, 'b c.md');
  assert.equal(s.suffix, '#section');
});

test('relativeFormFor keeps the fragment and points at the same file', () => {
  assert.equal(relativeFormFor('/r/openwiki/runbooks/p.md', '/openwiki/gotchas/g.md#why', '/r'), '../gotchas/g.md#why');
  assert.equal(relativeFormFor('/r/openwiki/p.md', '/docs/runbooks/d.md', '/r'), '../docs/runbooks/d.md');
  assert.equal(relativeFormFor('/r/openwiki/p.md', '/openwiki/q.md', '/r'), './q.md');
});

// ── normalizeLinks ──────────────────────────────────────────────────────────────
test('normalizeLinks rewrites every site-root link and touches nothing else', () => {
  const before = 'Prose with `[skip](/openwiki/x.md)` and:\n\n```\n[skip](/openwiki/y.md)\n```\n\n' +
    '[A](/openwiki/a.md), [B](/docs/b.md), [C](../c.md), [D](https://example.invalid/d).\n';
  const { text, rewrites } = normalizeLinks(before, '/r/openwiki/runbooks/p.md', '/r');
  assert.deepEqual(rewrites.map((r) => [r.from, r.to]), [
    ['/openwiki/a.md', '../a.md'],
    ['/docs/b.md', '../../docs/b.md'],
  ]);
  assert.match(text, /\[A\]\(\.\.\/a\.md\), \[B\]\(\.\.\/\.\.\/docs\/b\.md\), \[C\]\(\.\.\/c\.md\), \[D\]\(https:\/\/example\.invalid\/d\)\./);
  assert.match(text, /`\[skip\]\(\/openwiki\/x\.md\)`/, 'a code span must be left exactly as written');
  assert.match(text, /\n\[skip\]\(\/openwiki\/y\.md\)\n/, 'a fenced sample must be left exactly as written');
});

test('normalizeLinks handles several links on one line without corrupting offsets', () => {
  // Splices run back-to-front for exactly this case; front-to-back shifts every later target.
  const { text } = normalizeLinks('[a](/openwiki/aaaaaaaa.md) [b](/openwiki/b.md) [c](/openwiki/cc.md)\n',
    '/r/openwiki/p.md', '/r');
  assert.equal(text, '[a](./aaaaaaaa.md) [b](./b.md) [c](./cc.md)\n');
});

test('normalizeLinks is idempotent', () => {
  const once = normalizeLinks('[a](/openwiki/a.md)\n', '/r/openwiki/runbooks/p.md', '/r');
  const twice = normalizeLinks(once.text, '/r/openwiki/runbooks/p.md', '/r');
  assert.equal(twice.text, once.text);
  assert.deepEqual(twice.rewrites, []);
});

test('normalizeLinks changes only link targets — the rest of the file is byte-identical', () => {
  const before = '# Title\n\nParagraph with (parentheses) and /slashes/ and [A](/openwiki/a.md).\n\n> quote\n';
  const { text } = normalizeLinks(before, '/r/openwiki/p.md', '/r');
  const blank = (t) => t.replace(/(!?\[[^\]]*\]\(\s*<?)([^)\s>]+)/g, (m, lead) => `${lead}@`);
  assert.equal(blank(text), blank(before));
});
