# Research: Guardrail gate ports and registry retention

Source of every port: MovieCollectionManager (MCM) `main` at `fc2b953`, cloned read-only for this
feature. Each decision records what was chosen, why, and what was rejected.

## R1 — One feature, one branch, one pull request {#r1}

- **Decision**: items #1, #2, #28 and #32 ship as one Spec Kit feature, on one branch, in one PR.
  Commits are grouped per item.
- **Rationale**: the items share one shape (port a gate, strip coupling, wire into `scripts:lint`,
  document) and the same integration points (`scripts/project.json`, the runbooks, `AGENTS.md`). Four
  spec sets and four PRs would each pay for those edits and a full guardrails run. The batching rule's
  test passes: every gate is its own lint command and test file, so a red build names its gate.
- **Alternatives**: one PR per item (4× the integration edits and runs, with no attribution gain);
  doing item #2 directly without a spec (allowed for a small addition to an existing tool, but item
  #28 needs a spec anyway, and sharing it costs nothing).

## R2 — Toolchain consistency: which MCM rules apply {#r2}

MCM's gate is 950 lines, and most of it guards MCM surfaces. BELAY's pins are `package.json`
(`packageManager`, `engines.node`, `devDependencies`), `.forgejo/workflows/*.yml` (`node-version:`)
and `.devcontainer/toolchain.Dockerfile` (`FROM node:`).

- **Kept**: rule 1 (every Node pin satisfies `engines.node`), rule 2 (pnpm named only by
  `packageManager`), rule 2b (`packageManager` declared exactly once, at the root), rule 4 (one Node
  major across every pin), the implicit-Node rule (a Node-running job needs a pinned setup-node
  before its first Node use; `install-pnpm.sh` excepted, as in MCM), and the lockstep-exact rule.
- **Lockstep-exact**: MCM enforces exactness for the `nx` group and `@playwright/test` through its
  rule set. BELAY's constitution v1.0.1 names `nx`, every `@nx/*` and `@playwright/test`, so the
  BELAY port checks exactly those names, in every workspace `package.json`.
- **Dropped**: rule 3 (the Playwright container image in `app-ci.yml`; BELAY has no app CI), the
  `frontend/mcm-app/Dockerfile` pin site, and any rule keyed to an MCM-only workflow.
- **Alternatives**: a fresh, smaller gate. Rejected: the issue asks for a port, and MCM's parsing
  edge cases (comment lines, `with:` blocks owned by the enclosing step) are measured bugs, worth
  keeping verbatim.

## R3 — Topology scrub: port unchanged {#r3}

- **Decision**: port MCM's script byte-for-byte, except the header's MCM references. It has no MCM
  coupling, scans `git ls-files`, and treats any host containing `tailnet` or `example` as a
  placeholder.
- **Note**: the current BELAY tree already uses `forge.tailnet-example.ts.net`, `server.tailnet.ts.net`
  and `example-host.ts.net` in tests, all of them placeholders. The first scan is expected to be clean.
  The git remote URL is in `.git/config`, which is untracked, so it is out of the scan by construction.

## R4 — OpenWiki gates: the policy module and the managed regions {#r4}

- **Decision**: port `check-openwiki-okf.mjs`, `check-openwiki-governance.mjs`, `wiki-refresh.mjs`
  and their five shared modules. Keep `openwiki-policy.mjs`, because governance imports it, but run it
  with **no** `openwiki/policy.yaml`: in MCM that file declares per-path regeneration by the paid
  generator, and BELAY has no generator. A missing policy file therefore means "no generated paths",
  never an error.
- **Managed regions in `AGENTS.md`**: BELAY's only one is Spec Kit's agent-context
  `<!-- SPECKIT START/END -->` region. The governance allowlist of regions is narrowed to what BELAY
  has. Any MCM-only region is removed rather than left permitted.
- **Size budget**: keep MCM's line and byte budget values unless the current BELAY `AGENTS.md`
  exceeds them. In that case the file is trimmed (per FR-003), and the budget is not raised.
- **Fingerprints**: derived pages get `resource-sha256` from `wiki-refresh.mjs --record`.
  `protected.yaml` passages get theirs from governance's `--fingerprint` mode. Neither is typed by hand.

## R5 — Registry retention: protection without git-pinned digests {#r5}

- **Decision**: port `registry-retention.mjs` with its config schema, its decision function (keep by
  `protected`, `newest`, `recent` and `referenced`, in that order), its report format, the `--apply`
  double key and exit 5. Replace MCM's `protectedDigests()`, which reads `.env.deploy` files across git
  history, with a `protect:` list of `{ package, digest, note }` in the committed config.
- **Rationale**: BELAY's only image pin lives in the sandbox VM's env file, which is never committed
  because it carries the registry host. A digest is neither a secret nor a host, so committing it is
  safe. The runbook's re-pin step records it there. The window (keep the newest 4, or anything younger
  than 21 days, MCM's own values for its dev-container image) covers a pin nobody recorded.
- **Config**: `infrastructure-as-code/forgejo/registry-retention.yaml`, at the same path as MCM's.
  `mode: report`. Packages: `belay-devcontainer` (container, keepNewest 4, keepDays 21), plus BELAY's
  evidence package `belay-ci-failures` at the durations floor the script computes, because MCM's
  config says it does not cover that package. A package the config does not list (every MCM package
  under the same owner) is reported and never deleted. This is the source behaviour, and it is what
  makes two retention configs under one owner safe.
- **Credential**: `REGISTRY_CLEANUP_TOKEN` (`write:package`) as an Actions secret, which the
  maintainer provisions. The forge URL comes from the run's `github.server_url`, never from a committed
  file. Without the token, the run fails loudly.
- **Alternatives**: adding `belay-devcontainer` to MCM's config, a one-line change. Rejected: it makes
  BELAY's housekeeping live in a product repository that BELAY's tooling is meant to serve, and it
  could not protect a BELAY pin. The forge's built-in cleanup rules were rejected too: name-regex only,
  web-UI only, and no report mode (MCM's research R13).

## R6 — SAST deferred {#r6}

- **Decision**: do not port. Filed as item #37, carrying item #1's SAST candidate.
- **Rationale**: the MCM orchestrator needs Semgrep (via `uvx`), pip-audit and cargo-audit on the
  runner. Adding toolchains to `node:26-bookworm` is a structural decision the maintainer takes first.
  BELAY also has no Python, Rust or application JS yet, so the scan would protect almost nothing today.
  `pnpm audit` alone could run now, but a partial SAST port would read as coverage it is not.

## R8 — Port the mandated-surface gates ahead of their surfaces {#r8}

- **Decision** (maintainer, 2026-11-23): port the argv-secret, inline-secret, override-floor and
  naming gates now, and replace MCM's names with BELAY's. This reverses the first draft, which
  dropped them as having nothing to guard.
- **Rationale**: the constitution already requires a root `compose.yaml` with per-file secrets,
  Maestro for mobile tests, and dependency-security overrides. A gate added after the surface lands
  catches only later violations; a gate already in place catches the first one.
- **Generic naming grammar**: MCM hard-codes its services (`keycloak`, `mc-service`, `mcm-bff`…),
  its retired keys, its approved networks and an `mcm-` qualifier rule. In BELAY:
  - naming **contexts** are the project directory names under `backend/`, `frontend/`, `agents/`
    and `mcp-servers/` (kebab-case per the constitution), plus an explicit, initially empty list for
    infrastructure contexts (an identity provider, an observability stack) added with the first
    compose file that needs one;
  - **vendor bundles**, **retired keys** and **approved networks** become explicit, initially empty
    lists, each with a comment saying when to add an entry;
  - the grammar itself is kept: `<context>-<role>-<engine>-data` volumes (and MCM's `-logs` and
    `-snapshots` forms), `-network` networks with no compose-project underscore, and
    `container_name` equal to the service key;
  - dropped: the `mcm-` qualifier rule and the `ollama` removed-object section (MCM's history).
- **Vacuity**: each gate prints the number of files it scanned. With zero, it still exits 0, because
  "no compose file yet" is the correct state, but the count makes it visible. Each selftest proves
  detection on planted input.

## R7 — Secret scan as a tree gate {#r7}

- **Decision**: add `node scripts/secret-scan.mjs` (scan mode) to `scripts:lint` after its existing
  selftest, and give it a tree-scan test. The BELAY copy differs from MCM's only in its header.
- **Rationale**: the rules are already ported and tested. Only the wiring is missing.
