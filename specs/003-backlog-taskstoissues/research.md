# Research: Backlog Tooling and Tasks-to-Issues (003)

**Source:** MovieCollectionManager (MCM) at `E:\Programming\VSCode\MovieCollectionManager`. The user's direction is to reuse it as much as possible and strip only MCM coupling. Line references are to MCM's files on 2026-11-22.

| MCM file | Lines | Port to |
| --- | --- | --- |
| `scripts/backlog.mjs` | 898 | the same path |
| `scripts/__tests__/backlog.test.mjs` | 654 | the same path |
| `scripts/__tests__/fixtures/backlog/blocked-close-412.json` | — | the same path |
| `.claude/skills/speckit-taskstoissues/SKILL.md` | 134 | the same path; project-owned |
| `.claude/skills/forgejo-issues/SKILL.md` | 98 | the same path |
| `docs/runbooks/backlog.md` | 118 | the same path |
| `.forgejo/issue_template/backlog-item.yaml` | 68 | the same path |

**R-strip and neutral names** apply as in features 001 and 002: comments lose MCM feature, item and spec numbers, and job and app names in test data are neutralized.

**Not ported:** MCM's `.github/agents/speckit.taskstoissues.agent.md` and `.github/prompts/…`. They're the unmodified upstream Copilot / GitHub-MCP variant, and BELAY has no Copilot integration.

## R1. Credentials: keep MCM's environment-only model

- **Finding:** `selectToken` (L86–90) uses `MCM_FORGE_ISSUE_TOKEN` for writes. Reads prefer it and fall back to `MCM_FORGE_TOKEN`. It never uses the git credential helper, and nothing imports `forge-credential.mjs`.
- **Decision:**
  - Keep that model, renamed to `FORGE_ISSUE_TOKEN` / `FORGE_TOKEN` (spec FR-012).
  - The user-facing strings (L71–75, L92, L477, L483) name the new variables and point at `docs/runbooks/backlog.md`. The dev-container, `${localEnv}` and `setx` / "fully quit VS Code" advice is dropped.
- **Rationale:** issue writes need only `write:issue`. The git credential (repository write) stays reserved for `forge-pr`, which is the least-privilege split.

## R2. Origin and owner/repo checks: unchanged

- **Finding:** `connect()` (L561) uses `forgeEndpoint` from `ci-status.mjs`, which is byte-identical in BELAY. There are two write guards:
  - `assertWriteTargetsOriginRepo` (L135) checks any `--repo`;
  - `assertWritePathTargetsOriginRepo` (L153) checks every non-GET path.
- **Decision:** port both unchanged (spec FR-011). `renderLine` (L43) is also kept unchanged. Every output line goes through `redactForPublication` and `stripControlChars`, so the forge host prints as `<forge>` and an issue title can't inject terminal escapes.

## R3. Label set

- **Decision:** port `TAXONOMY` (L50–61) with its colours and descriptions, minus `status/bot-managed`. That leaves nine labels (spec FR-014).
- **Also removed:**
  - the bot-managed filter in `selectReadyItems` (L317) and the `ready` pre-filter (L654);
  - the Renovate item #29 note in HELP (L501);
  - the "container firewall" text (L190).

## R4. `/speckit-taskstoissues`: a project-owned fork

- **Finding:** MCM's skill was forked from spec-kit 0.16.5's `templates/commands/taskstoissues.md`. Spec Kit 1.x removed that command from core, so the skill is project-owned. Its flow:
  1. the `before_taskstoissues` hooks;
  2. `.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks`;
  3. `setup-milestone <NNN-slug>`;
  4. `list --state all --milestone … --json`, paged, deduplicating on `\bT\d{3,}\b`;
  5. `create` per task, with the `[P]` / `[US#]` markers stripped;
  6. `dep` for ordering;
  7. the `after_taskstoissues` hooks.

  BELAY's git extension registers both hook keys, as `speckit.git.commit`, optional.
- **Decision:**
  - **Port the skill:** its frontmatter `source` records "forked from spec-kit 0.16.5 via MovieCollectionManager". The `/tmp/t012.md` example becomes a scratch path that also works on Windows, from `mktemp`.
  - **Register it in the gate's `PROJECT_OWNED`,** with MCM's marker `scripts/backlog.mjs` and a BELAY `why`.
  - **Add an inventory row in `docs/runbooks/spec-kit.md`.** The gate needs this, or it fails with `inventory-stale` (spec FR-016).
  - **Selftest:** `SELFTEST_OWNED` already uses the real `PROJECT_OWNED` once that list is non-empty, so the gate's selftest now covers this entry without code changes.

## R5. The issue form

- **Decision:** port `.forgejo/issue_template/backlog-item.yaml`, so the forge offers a backlog form and `validate-form` (spec FR-004) has something to validate. Replace MCM's placeholders (L16 "The movie list re-fetches…", L35 "mc-service, mcm-app, the BFF…") with BELAY examples, such as "the guardrails gate passes when…" and "scripts, CI, Spec Kit customisations".
- **Check:** `.forgejo/issue_template/` isn't `.forgejo/workflows/`, so the digest-coverage gate ignores it.

## R6. Tests

- **Port:** `backlog.test.mjs`, including its fetch stub (`fakeFetch`, L176) and the `blocked-close-412.json` fixture.
- **Removed:** `ready work excludes bot-managed items` (L338).
- **Adjusted:**
  - the taxonomy assertion: nine labels, no `status/bot-managed`;
  - the token-name tests (L94–149, L200): `FORGE_*`;
  - the `setx` assertion (L118): it now asserts that the message names `docs/runbooks/backlog.md`.
- **Added:** a `(no-leak)` test. A planted `FORGE_ISSUE_TOKEN` must never appear in output or errors for `list`, `create` and `update` against 401, 403 and 200. Its RED is confirmed with a mutation, as in feature 002.
- **Network:** every test uses the stub; none use the network.

## R7. Entry point

- **Finding:** MCM detects direct invocation with `process.argv[1].endsWith('backlog.mjs')` (L890).
- **Decision:** keep it. Switching to `scripts/lib/is-main.mjs` would be a behaviour-neutral refactor with no requirement behind it. `backlog.mjs` has no `--selftest`, so `scripts:lint` gains nothing.

## R8. Docs

- **`forgejo-issues` skill:**
  - "the MCM backlog" becomes BELAY's;
  - the token is `FORGE_ISSUE_TOKEN`, and the dev-container requirement goes;
  - the bot-managed and Renovate passages (L43–44, L57) are dropped;
  - MCM's item-number examples are made generic;
  - the "143 rows" measurement stays as "measured on a Forgejo 1.22 tracker", because it's a property of the forge.
- **`docs/runbooks/backlog.md`:**
  - **Dropped:** the backup section (L102–105, MCM's restic/Postgres infrastructure), the dev-container and `setx` advice, and the bot-managed and Renovate entries.
  - **Changed:** the Nx paragraph (L30–33) now points at `pnpm nx run scripts:test`.
  - **Added:** a link from AGENTS.md and from `docs/runbooks/ci.md`'s credentials section, which already names `FORGE_ISSUE_TOKEN` for feature 003.

## R9. Live setup on BELAY

- **Decision:** after the code lands, run `setup-labels --dry-run`, then `setup-labels`, against BELAY. Then label issue #1 with `type/tech-debt` and `priority/p2` (spec Assumptions). Then run `/speckit-taskstoissues` on this feature's `tasks.md` twice: the second run must create zero issues (SC-001).

## R10. Constitution notes

- **Nx:** the tests run through `scripts:test`. `backlog.mjs` is an operator CLI run directly with `node`, like `ci-status` and `forge-pr` (feature 002, research R10).
- **Dependencies:** none are added.
