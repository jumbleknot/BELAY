# OpenWiki Brief — BELAY

This file sets the scope and rules for the `openwiki/` knowledge bundle. It is **hand-authored**.
Anything that writes the bundle, whether a coding session or a generator run, reads this file and
never rewrites it.

The layout follows MovieCollectionManager's bundle, and so do its gates. Most rules here are
enforced by two gates in `scripts:lint`, inside the required `guardrails` check (see §9). The rest
are kept by review.

---

## 1. What this wiki is, and what it is not

This wiki is a **navigation and gotcha layer** over documentation that already exists. It is not a
second copy of it.

The documentation it sits over is the operator runbooks under `docs/runbooks/`, the templates under
`docs/templates/`, the governing constitution and the scripts' own `--help`. The failure mode to
avoid is a paraphrase of those documents that drifts away from them.

**Every concept page MUST:**

- Carry a **distilled summary**: what this subject is, in a few sentences.
- Carry the **load-bearing gotchas**: the non-obvious constraints and traps that cost a session
  when someone gets them wrong. This is the most valuable content on any page.
- Either carry a `resource` link to the **authoritative source** and defer to it for full detail,
  or *be* the authoritative source (§4c). An authoritative page carries **no** `resource` and is
  listed under `authoritative:` in `openwiki/protected.yaml`. Every page is exactly one of the two.

**Every concept page MUST NOT:**

- Reproduce the full text of the document it cites. A reader who needs the whole procedure follows
  the link to the runbook.
- Restate step-by-step operator procedures. Summarise *what* the procedure achieves and *when* to
  reach for it, and link to the *how*.
- Duplicate another concept page. One subject gets one page. Link between pages instead of
  repeating them.

A page that is accurate but is really just a copy of its source has failed this brief.

## 2. Exclusions: do not analyse or document these

Skip entirely:

- Dependency and build output: `node_modules/`, `target/`, `dist/`, `build/`, `out/`, `bin/`
- Caches and tool state: `.nx/`, `.pnpm-store/`, `.superpowers/`
- **Every environment file**: any `.env`, `.env.*` or `*.env`, with no exceptions
- **All secret material**: `secrets/` (other than its `README.md` and `*.example` templates),
  `*.key`, `*.pem`, `*.pfx`, `*.p12`
- Lock files: `pnpm-lock.yaml`, `Cargo.lock`, `package-lock.json`
- Binary and generated assets, and `.git/` internals

**Also exclude `docs/proposals/**`.** It holds ideation and design
records from before a spec existed. They are superseded once a spec or an implementation exists, so
documenting them would fill retrieval with dead ideas. The single
[spec-driven development page](process/spec-driven-development.md) describes the lifecycle and links
to the folders for anyone who wants the history.

**`specs/**` may be read, but it is NOT a coverage target.** A feature's spec, plan or research file
is often the only record of a measured fact, and that context makes a concept accurate. Do **not**
create a concept per feature, though. Features are historical units of work, superseded by the code
they produced.

**Source precedence: a spec records what a feature decided *at the time*, never the current state.**
Specs are not updated when a later change supersedes them. When a spec disagrees with a runbook, the
constitution or the code, **the later source wins**. State a spec's decision as current only when
nothing later contradicts it. Otherwise attribute it ("feature 001 originally …") or leave it out.

**Never rewrite `openwiki/INSTRUCTIONS.md` or `openwiki/protected.yaml` as a side effect of a page
refresh.** Both are hand-authored. A change to either is a deliberate, reviewed edit of its own.

## 3. Redaction: non-negotiable

Every page is a tracked file, and `scripts/secret-scan.mjs` and the CI digest redactor treat
credential-shaped strings as failures.

**Never reproduce, even when a source file contains it:**

- Hostnames of the self-hosted forge, the homelab host, or any tailnet host or address
- Host and port pairs that identify a real deployment
- Tokens, API keys, passwords, secrets, connection strings with credentials, or anything shaped
  like one
- Internal IP addresses

**Instead, refer to them abstractly**: "the forge host", "the tailnet address", "the CI digest
token". A reader who needs the literal value gets it from the secrets store or the source runbook,
never from a wiki page.

Port *numbers* discussed as a design convention are fine. What must not appear is a real host paired
with a port.

## 4. What to cover

**a. Per-project overviews.** One concept per deployable unit or tool family, covering what it is
responsible for, its shape and its boundaries. Today that is the repository itself and the `scripts`
Nx project, whose tools are covered through their runbooks. Add a page when a project appears under
`backend/`, `frontend/`, `agents/`, `mcp-servers/`, `packages/` or `tools/`.

**b. Cross-cutting invariants.** The rules that span projects and are easy to break: the toolchain
(pnpm, Nx, RTK), the secrets posture, the testing tiers and what gates a merge, and the validation
checklist.

**c. Non-obvious rules and measured operational facts.** These are the most valuable pages. They
cover decisions where the obvious approach is wrong and the reason is not visible from the code, and
traps that each cost a session to rediscover. **These pages are authoritative and carry NO
`resource`.** Never cite `AGENTS.md` or `CLAUDE.md`. The first is an index and the second is a shim,
so a citation would point at a summary of the page itself.

**d. Runbooks, decision records and architecture documents.** Each gets at least one concept. Every
document under `docs/runbooks/` and `docs/decisions/` must be reachable from a concept, so that a
missing concept reliably means "no such document" rather than "not covered yet".

## 5. Front matter

Every page needs a `type`. Beyond that, fill in `title`, `description`, `tags`, `resource` and
`timestamp` wherever they apply. Fill in `description` in particular, because each directory's
`index.md` is built from it.

```yaml
---
type: Runbook
title: CI guardrails and the failure digest
description: One sentence a reader can choose the page from.
tags: [ci, forgejo]
resource: docs/runbooks/ci.md   # derived pages only
timestamp: 2026-11-22
---
```

Use only these `type` values, so filtering stays predictable:

`Architecture` · `Service` · `Runbook` · `Decision` · `Process` · `Convention` · `Gotcha` · `Reference`

- **Front matter must parse as YAML.** Double-quote a value that contains `: `, `{`, `[` or `${`.
  Never repeat a key. When you rewrite a page, keep its `resource` and `tags`.
- **A `description` never contains `#`.** An index builder ends the entry at the first `#`. Write
  "item 12", not the hash form.
- **`resource` names one canonical FILE, never a directory, and never a file a bot rewrites** (a
  lock file, a workflow, a manifest). A directory has no single fingerprint, and a bot-rewritten file
  would make the page stale with no session there to refresh it. Cite the document that states the
  rule, such as a runbook, the constitution or a template, not the folder its instances live in.
- **`resource` is what classifies a page.** A page that has one is a *derived summary* of that file.
  A page without one is *authoritative* and must be listed in `protected.yaml`. Leaving out a
  citation you should have made turns a summary into false canon.
- **Do not write `resource-sha256` by hand.** `node scripts/wiki-refresh.mjs --record <page>` records
  the fingerprint from the file's actual bytes, and every derived page carries one (§9).
- `timestamp` is ISO 8601. It records when the page was last brought up to date.

## 6. Links in the body: relative to the file, never to the site root

**Every in-repository link in a page body MUST be relative to the file it is written in.**

```markdown
<!-- written from a page in openwiki/runbooks/ -->
✅  [Spec-driven development](../process/spec-driven-development.md)
✅  [the CI runbook](../../docs/runbooks/ci.md)
❌  [Spec-driven development](/openwiki/process/spec-driven-development.md)
```

A leading `/` is **not** the repository root. Forgejo resolves it against the **site** root, so the
link 404s. MovieCollectionManager measured this on Forgejo 15 and found 204 dead links across 61 of
its 77 files before anyone checked.

**A link to a section of a source document targets that document, not its concept page.** A concept
page does not carry its source's headings. Link a concept page by its file only, and link a specific
section through the source document's path.

Links inside a fenced code block or a code span are exempt.

## 7. Where a new learning goes: the canonical-home rule

This section is for anyone, human or assistant, who has just learned something durable about this
repository and has to decide where to write it.

**The rule: a durable learning goes to the canonical home of its subject.** Work it out from the
concept that covers the subject:

1. Find the concept covering the subject. Read the relevant `index.md`, or search by `type` and
   `tags`.
2. **Does that concept carry a `resource`?**
   - **Yes: the learning goes into the cited source, and the summary is refreshed in the same PR.**
     The concept is a derived summary. Write the detail into the runbook or document it cites, then
     bring the summary up to date with that change, as a summary in its own words, not as a copy.
   - **No: the concept is authoritative, and the learning goes into the concept.** There is no
     upstream document. The concept *is* the canonical home.
3. **No concept covers the subject?** Add one. If the subject has a canonical document, write the
   detail there and cite it from the new concept. Never append prose to an index instead.

The [learnings ledger](../docs/BELAY-Learnings.md) is not a fourth answer. It indexes lessons and links each one to
its home; a new learning still goes to its home by the steps above, and enters the ledger at the next quarterly
refresh.

**Do not write prose into `AGENTS.md`.** It is the index every assistant reads. An entry there keeps
its rule, its trap and a link, and the story behind it goes in the linked page. `CLAUDE.md` is only a
shim that imports `AGENTS.md`, so anything written there reaches Claude alone.

The obvious alternative was rejected: keep writing learnings into the instruction file and have a
later run move them out. MovieCollectionManager's instruction file grew to 592 lines and 72 KB that
way. A rule that tolerates regrowth on the promise of a later clean-up produces the same file again,
only more slowly.

### A learning that corrects what is written: rewrite it in place

When a learning shows that a passage is wrong, **rewrite that passage** where it is, so it states
what is true now. Do not leave it and add a "SUPERSEDED" or "CORRECTION" block further down, and do
not add a disclaimer at the top. Git holds the history.

- **Keep every measured fact.** A measurement, date, error string, version or item number that
  explains *why* the rule now reads as it does stays in the rewritten passage, as its reason.
- **A short "was X until `<date>` (`<PR or commit>`)" note is allowed** only where a reader is still
  likely to meet the old behaviour, for example in an old checkout or a command in someone's shell
  history.

The reason is reading order: a reader meets the stale text first.

## 8. Tone, and no live state

Write for an engineer or coding agent who is competent but new to this repository. Be direct and
concrete. Prefer the specific detail that prevents a mistake over the general statement that sounds
complete. When a rule exists because something once broke, say so, because the reason is what makes
the rule stick.

**Never copy live state into a page.** That includes a run's outcome, a cost, a count of open issues
or a current CI verdict. A copied value is wrong by the next run, and a page that quotes it looks
authoritative while it is stale. A measured value that explains *why* a rule exists belongs in the
source runbook, dated, and the page may cite it from there.

## 9. What is enforced, and by what

Two gates enforce this brief. Both run in `pnpm nx run scripts:lint`, so the required `guardrails`
check fails on any finding. Each finding names the page and the rule. Neither has an allowlist: fix
the page, or the brief.

- **`scripts/check-openwiki-okf.mjs`** (the OKF gate) checks every page: front matter that parses
  and has a `type` (§5), ISO 8601 timestamps, a `resource` that resolves, an `index.md` in every
  directory listing every page, no site-root body link and no relative link that fails to resolve
  (§6). Its rule **V17** fails a derived page whose `resource-sha256` does not match its source.
- **`scripts/check-openwiki-governance.mjs`** keeps `AGENTS.md` an index within its size budget
  (§7), `CLAUDE.md` a shim that only imports it, and every page exactly one of derived or
  authoritative (§1, §4c). A `resource` must be one file that no bot rewrites (§5). It also checks
  the passage fingerprints in `protected.yaml`.
- **`scripts/wiki-refresh.mjs`** is the refresh tool. `--stale` lists the pages V17 would fail,
  `--diff <page>` shows the source's change since the page was recorded, and `--record <page>`
  writes the fingerprint. The `wiki-refresh` skill walks through it.

Still kept by review: whether a summary is *accurate* (V17 proves only that someone recorded it
after the source last changed), the redaction rules in §3 beyond what the secret scan and the
topology scrub catch, and the content rules in §1, §4 and §8.

The [wiki maintenance page](process/wiki-maintenance.md) has the procedure.
