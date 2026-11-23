---
type: Reference
title: OpenWiki quickstart — BELAY
description: The root entry point to BELAY's OpenWiki bundle — what the bundle is and is not, how to query it by type, tag, resource or directory, a task-routing map to the concept areas, and how the derived-versus-authoritative split decides where a new learning belongs.
tags: [openwiki, navigation, quickstart]
resource: openwiki/INSTRUCTIONS.md
resource-sha256: 0a3419d0375100f174edfcae3a04ff230b346ee99663cd8a396600b00406d5f6
timestamp: 2026-11-23T13:26:41.476Z
---

# OpenWiki quickstart — BELAY

This bundle is a **navigation and gotcha layer** over documentation that already exists in BELAY.
It is not a second copy of it. Its job is to make the runbooks, templates and constitution *findable
and safe to act on* without reading every source document first.

Every concept page has the same shape. It starts with a short **summary** of the subject, then its
**gotchas**: the non-obvious traps that cost a session when missed, which are the most valuable
content on any page. A derived summary also carries a `resource` link to the authoritative source for
full detail. [The brief](./INSTRUCTIONS.md) sets the scope, the exclusions and the rules for writing
pages.

## How to query this bundle

Every page carries front matter: `type`, `title`, `description`, `tags`, and a `resource` when the
page is a derived summary.

- **By `type`**: `Reference` (this page and the repository tour), `Convention` (cross-cutting rules),
  `Process` (how work moves through the repository), `Runbook` (operator procedures), `Gotcha`
  (traps) and `Decision` (ratified decisions, such as the constitution). A page's type does not
  follow from its directory.
- **By `tags`**: themes such as `ci`, `secrets`, `testing`, `spec-kit` or `openwiki` span
  directories.
- **By `resource`**: `git grep -n "^resource: <path>" openwiki/` finds every page summarising a file.
  That is how you find the pages to refresh when you change the file.
- **By directory**: each directory has an `index.md` listing its pages with their descriptions.

**Derived or authoritative.** A page with a `resource` is a *derived summary* of that one file. A page
with none is *authoritative*: canonical in its own right, and listed under `authoritative:` in
[protected.yaml](./protected.yaml). That split decides where a new learning goes
([the brief](./INSTRUCTIONS.md), §7).

## Where to start, by task

| You are about to… | Read |
| --- | --- |
| change anything, for the first time here | [the repository](./projects/repository.md), then [the validation checklist](./invariants/feature-validation-checklist.md) |
| write code under a product folder | [spec-driven development](./process/spec-driven-development.md), [the constitution](./process/constitution.md) |
| touch `.specify/` or a `/speckit-*` skill | [Spec Kit](./runbooks/spec-kit.md) |
| write or change a test | [test authoring conventions](./process/test-authoring-conventions.md), [testing tiers](./invariants/testing-tiers.md) |
| add a dependency or a project | [package-manager enforcement](./invariants/package-manager-enforcement.md), [Nx](./invariants/nx-task-runner.md) |
| commit or switch branches in the shared dev container | [the dev container](./runbooks/devcontainer.md) |
| open, watch or merge a PR, or read a red CI run | [CI guardrails](./runbooks/ci.md), [PR batching](./process/pull-request-batching.md) |
| file or work a backlog item | [the backlog](./runbooks/backlog.md) |
| handle a token or a `.env` | [secrets](./invariants/secrets-management.md), [the .env trap](./gotchas/env-file-inline-comments.md) |
| trust a surprising tool result | [instrument traps](./gotchas/instrument-traps.md), [RTK](./invariants/rtk-token-compression.md) |
| rename or remove something documented | [doc drift](./runbooks/doc-drift.md), [wiki maintenance](./process/wiki-maintenance.md) |

## Coverage

Every document under `docs/runbooks/` has a concept that cites it. A runbook without one is a gap to
fix, not a sign that the subject is undocumented. `docs/proposals/`, `docs/superpowers/` and `specs/`
are deliberately not covered (see [the brief](./INSTRUCTIONS.md), §2).
