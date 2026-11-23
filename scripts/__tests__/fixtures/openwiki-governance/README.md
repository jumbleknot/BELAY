# Fixtures — `scripts/check-openwiki-governance.mjs`

Each subdirectory is a **mini-repository root**, not a bundle root. It holds `AGENTS.md` (the index),
`CLAUDE.md` (the shim that imports it), a `docs/` tree and an `openwiki/` bundle, because the
governance rules span all of them. Drive the gate with `--root <fixture>`.

There are two baselines. `valid` is BELAY's shape: **no** `openwiki/policy.yaml`, because BELAY has no
wiki generator. `with-policy` is `valid` plus a policy file that declares every path legally; the
policy rules (G1–G4, G12) only apply when a policy file exists, so their fixtures start from it.

Every other fixture is one baseline with **exactly one** mutation, so a failure names one rule and
nothing else. `diff -r valid <fixture>` (or `with-policy`) shows the mutation. A single mutation may
raise more than one FINDING of the same rule (`protected-on-derived` raises two G7s), but never a
second rule.

| Fixture | Baseline | Expected | Rule |
|---|---|---|---|
| `valid` | — | pass | BELAY's shape, no policy file |
| `with-policy` | — | pass | a policy file declaring every path |
| `unclassified-path` | with-policy | fail | **G1** a documentation path no `policy.yaml` entry matches |
| `invalid-policy-value` | with-policy | fail | **G2** `policy: sometimes`, outside the five declared states |
| `generator-outside-bundle` | with-policy | fail | **G3** `actor: generator` on `docs/runbooks/**` |
| `event-driven-without-events` | with-policy | fail | **G4** `event-driven` with no `events` |
| `authoritative-declared-regenerate` | with-policy | fail | **G12** an authoritative concept whose effective policy is `regenerate` |
| `unparseable-policy` | with-policy | fail | fail-closed: a present but unreadable `policy.yaml` is G0 |
| `reworded-passage` | valid | fail | **G5** words changed under a protected anchor |
| `deleted-passage` | valid | fail | **G6** the anchor is gone: a *removal*, not a pass for lack of text |
| `protected-on-derived` | valid | fail | **G7** a protected passage on a concept carrying a `resource` |
| `fingerprint-updated` | valid | **pass** | passage and fingerprint corrected in the same change |
| `whitespace-drift` | valid | **pass** | CRLF and trailing spaces are not a change |
| `index-stray-prose` | valid | fail | **G8** a paragraph in `AGENTS.md` outside the index and the Spec Kit region |
| `dangling-index-entry` | valid | fail | **G9** an index entry pointing at a concept that does not exist |
| `stale-assistant-surface` | valid | fail | **G10** an `opencode.json` pointing at a path that has moved |
| `claude-shim-content` | valid | fail | **G15** an index entry added to the `CLAUDE.md` shim instead of `AGENTS.md` |
| `claude-shim-no-import` | valid | fail | **G15** the shim no longer carries the `@AGENTS.md` import |
| `unclassified-concept` | valid | fail | **G11** a concept that is neither derived nor authoritative |
| `both-classifications` | valid | fail | **G11** a concept that is both |
| `missing-manifest` | valid | fail | fail-closed: an absent `protected.yaml` is G0, never a skip |

The absent-policy behaviour, the MCM-only managed regions and G16 are tested by mutating a temp copy
of `valid` in the test file, not by a committed fixture.

## The fingerprints

`valid/openwiki/protected.yaml` hashes the section under `## A skipped test reads as a pass` in
`valid/openwiki/gotchas/instrument-traps.md`. Recompute any of them with the gate itself, never by
hand:

```bash
node scripts/check-openwiki-governance.mjs --root scripts/__tests__/fixtures/openwiki-governance/valid \
  --fingerprint openwiki/gotchas/instrument-traps.md "A skipped test reads as a pass"
```

`whitespace-drift` deliberately hashes to the **same** value as `valid`; that equality is the
property its test asserts. `reworded-passage` and `fingerprint-updated` share the same reworded text,
and only the manifest differs, which is what makes one a violation and the other the sanctioned
correction.
