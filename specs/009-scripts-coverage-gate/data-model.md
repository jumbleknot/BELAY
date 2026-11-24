# Data model: Coverage gate for the scripts project

## Coverage policy (`scripts/coverage-policy.yaml`)

The one place the floor is stated (FR-013). It is read by `scripts/check-coverage.mjs`, and sits inside
the Nx project root so that a change to it invalidates the cached `test` target (research R6).

| Field | Type | Rule |
| --- | --- | --- |
| `version` | integer | `1` |
| `floor` | number | Percent of lines. `70` at landing. Must be 50–100 |
| `include` | list of globs | Repository-relative source patterns, `scripts/*.mjs` and `scripts/lib/*.mjs` at landing. Non-empty. Every pattern ends in `.mjs`, and none matches `scripts/__tests__/` |
| `exceptions` | list of Exception | Empty at landing (FR-012) |

A policy that fails validation fails the gate with exit 2 (bad input). It never falls back to a default
floor.

## Exception

| Field | Type | Rule |
| --- | --- | --- |
| `module` | string | A repository-relative path that the `include` patterns match. An exception for a module that does not exist fails (stale entry) |
| `floor` | number | ≥ 50 and < the policy `floor` |
| `reason` | string | Non-blank |
| `addedBy` | string | Non-blank |
| `expiry` | `YYYY-MM-DD` | Required. Classified by `allowlist-expiry.mjs`: `active`, `expiring` (≤ 14 days, warns) or `expired` (no longer applies, so the module is judged at the policy floor) |

## Module result (computed, never stored)

| Field | Meaning |
| --- | --- |
| `module` | repository-relative path |
| `linesFound` / `linesHit` | from lcov `LF` / `LH`. Both are `null` when the module is absent from the report |
| `branchesFound` / `branchesHit` | from `BRF` / `BRH`. Reported, never gated |
| `percent` | `100 × linesHit / linesFound`. A module with `linesFound = 0` is 100% |
| `appliedFloor` | the exception's floor if it is active or expiring, otherwise the policy floor |
| `status` | `ok` · `below-floor` · `no-coverage-data` |

## Verdict (computed)

The verdict **fails** when any of these holds:
- any module is `below-floor` or `no-coverage-data`;
- the total `ΣlinesHit / ΣlinesFound` is below the policy floor, where modules with no data count as 0
  hit of 0 found (so the total cannot hide them, and they fail on their own);
- the report is missing or empty, or contains no record for any source module;
- the policy is invalid;
- an exception names a module that does not exist.

Otherwise it **passes**, printing the total, the lowest module, and any expiring exceptions.
