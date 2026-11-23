# Research: SAST dependency-downgrade gate

Baseline: MCM `main` at `fc2b953`: `scripts/check-dependency-downgrade.mjs` (295 lines),
`scripts/__tests__/check-dependency-downgrade.test.mjs` (192 lines), and the step in MCM's
`.forgejo/workflows/guardrails.yml` `sast` job (the "no package resolution moves INTO a known
advisory" step, after the gate).

## R1 — The imported functions behave as in MCM {#r1}

- **Decision**: import them unchanged; no shim.
- **Evidence** (2026-11-23, each function body extracted and diffed, BELAY `410c70c` against MCM
  `fc2b953`):
  - `pnpmAdvisoryId`, `pnpmFindingLocation` (`scripts/sast-scan.mjs`): identical.
  - `evaluate`, `loadAllowlist` (`scripts/check-sast-findings.mjs`): identical. A code-only diff of the
    whole file differs only in selftest fixture names (`mcm-*` → `belay-*`, MCM paths → BELAY paths)
    and comments, so the helpers `evaluate` calls behave the same.
  - `scripts/lib/argv-contract.mjs`: differs only in five comment lines (MCM item references made
    generic).
- **Shape of the input**: a BELAY full scan writes `security/sast/reports/pnpm-audit-native.json` as
  `{ "pnpm-lock.yaml": { advisories, metadata } }`, the lockfile-keyed map `findRegressions` reads.

## R2 — Port the code and comments; make them BELAY's {#r2}

- **Decision**: port `check-dependency-downgrade.mjs` line for line. Change only:
  - MCM item and spec numbers (`#776`, `#774`, spec 081) → BELAY's item #43, keeping one sentence that
    says the measured case is MCM's;
  - the runbook link `docs/runbooks/sast-scanning.md` → `docs/runbooks/sast.md`;
  - "the dev tree runs in CI jobs that hold the remote-cache token" → "… that hold tokens" (BELAY has
    no remote-cache token; its jobs hold the digest token);
  - the usage text's `(item #776)` → `(item #43)`.
- **Kept on purpose**: the undici example in the failure hint and the test fixture. It is the measured
  case, and the advice (an override floor) applies to BELAY unchanged: overrides live in
  `pnpm-workspace.yaml`, which the hint does not name a file for.

## R3 — The wiring guard lives in `guardrails-workflow.test.mjs` {#r3}

- **Decision**: MCM's last test (`guardrails.yml runs the downgrade gate …`) moves to
  `scripts/__tests__/guardrails-workflow.test.mjs`, next to the other `sast` job assertions, and
  checks the parsed job rather than string offsets: the step exists, it comes after the gate step
  (which itself follows the scan), it has the PR-only `if:`, `BASE_REF` from `github.base_ref`, and
  it runs through `ci-log-step.sh` with `--base "origin/$BASE_REF"`.
- **Why**: item #43's acceptance criteria name `guardrails-workflow.test.mjs`, and that file already
  pins the `sast` job's step order (feature 006). One file asserting the order means one place to
  update.
- **Deviation**: MCM asserts "after the scan"; BELAY asserts "after the gate", the position item #43
  asks for (and MCM's actual placement).

## R4 — One test added: an unreadable base lockfile fails closed {#r4}

- **Decision**: add a CLI test: a valid native report and an unknown `--base` ref exit 1.
- **Why**: item #43 lists "an unreadable lockfile" among the fail-closed inputs. MCM's code handles it
  (`gitShow` throws on any `git show` error other than "path does not exist"), but MCM's test file
  covers only the missing and empty report. The test pins the behaviour; the code is unchanged.

## R5 — Generic fixtures {#r5}

- **Decision**: the nested-workspace fixture `tools/openwiki-generator/pnpm-lock.yaml` (an MCM path)
  becomes `tools/example/pnpm-lock.yaml`. Every other fixture is generic already.

## R6 — Not wired into `scripts:sast` {#r6}

- **Decision**: the Nx target `scripts:sast` (full scan, then the gate) does not run the check.
- **Why**: the check needs a base ref, and a local full scan has none. As in MCM, the check is
  PR-only. The runbook gives the local command (`--base origin/main` after a scan).

## R7 — No new dependency {#r7}

- The check uses Node built-ins and the three existing modules. Its range parser exists so that no
  `semver` dependency is needed (FR-010). The `yaml` package is used only through `loadAllowlist`.

## R8 — The demonstration {#r8}

- **Decision**: a throwaway local worktree that pins the `yaml` dev dependency to `2.2.1`, inside
  GHSA-f9xv-q969-pqx4 (`<2.2.2`); the base lockfile resolves `yaml` only to 2.9.x. Run the full scan,
  the main gate (expect 0: dev scope) and the check against `origin/main` (expect 1). The
  branch is never pushed.

## R9 — No "not ported" note to remove {#r9}

- Item #43 asks for "the 'not ported' note" to be removed. Feature 006 shipped none: no tracked file
  mentions the downgrade gate (searched 2026-11-23 for `downgrade`, `item #43`, `not ported`). The
  runbook's statement "Dev-scope advisories … never block" is the closest thing, and is reworded to
  name this check.
- **Result** (2026-11-23): the head resolved `yaml` to 2.2.1 and 2.9.0 (base: 2.9.0, 2.9.1). The scan
  reported GHSA-f9xv-q969-pqx4 (**High**, `>=2.0.0-5 <2.2.2`) and GHSA-48c2-rrv3-qjmp (Moderate,
  `>=2.0.0 <2.8.3`), both `pnpm-audit/dev`. The main gate exited 0 ("SAST gate passed"); the check
  exited 1 with both regressions. The worktree was then removed.
