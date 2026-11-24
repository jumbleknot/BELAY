# Image CVE scanning (Trivy)

Feature 010 (backlog item 49) scans every container image BELAY depends on for known vulnerabilities. It does this
in two places, and each image is scanned in exactly one of them:

| Where | What it scans | When | On a blocking finding |
| --- | --- | --- | --- |
| **The builder**: `devcontainer-image.yml`, between `Build` and `Push` | the dev-container image it just built (`belay-devcontainer`) | every build: on change to `main`, weekly on Friday, and by dispatch | the job fails and **nothing is pushed**, so no one can re-pin onto it |
| **The sweep**: `image-scan.yml` | every **third-party** image the tree names: Dockerfile `FROM` lines, compose `image:` keys under `infrastructure-as-code/`, workflow job and service containers | Tuesday and Friday 04:00 UTC, on any change to an image reference or to the scanning files, and by dispatch | the run fails, and `sweep/verdict` on the commit says why |

An image BELAY builds (`BUILT_IMAGES` in `scripts/image-scan.mjs`) is excluded from the sweep by **membership**,
never by a name prefix. A guard test checks that each such image is scanned by its builder before its push.

**Blocking means a fixable Critical**: severity Critical, a fixed version exists, and no live allowlist entry covers
it. A Critical with no fix, and everything below Critical, is a warning and is reported as counts. A version bump
cannot clear an unfixable advisory, so it must not wedge the gate.

## Running it

```bash
node scripts/image-scan.mjs --list                    # enumerate only: no Trivy, works anywhere
node scripts/install-trivy.mjs ~/.local/bin           # the pinned, sha256-verified Trivy
node scripts/image-scan.mjs                           # the sweep: writes security/images/reports/
node scripts/image-scan.mjs --image <ref> --image-src remote|docker   # one image (the builder path)
node scripts/check-image-findings.mjs                 # the gate: 0 pass, 1 blocking or no scan, 2 bad allowlist
```

- In CI, run the sweep on a branch with `node scripts/forge-pr.mjs dispatch image-scan.yml --ref <branch>`.
- In the dev container, every host it needs is on the egress allowlist: GitHub releases and their asset host,
  ghcr and its blob host, and Docker Hub. A blocked host fails naming it.
- Running the downloaded Trivy binary in a coding session may need that session's permission. The feature's
  planning session was refused it, which is why the baseline was measured in CI.

## Reading a result

**The verdict line always starts with how many images were scanned**:
`❌ 1 image scanned: 1 blocking · 0 allowlisted · 20 Critical (no fix) · 675 High · …`.
- `0 images scanned` fails.
- A reference that cannot be resolved (`NOT SCANNABLE`) fails.
- A missing report fails, as `report missing: nothing was scanned`.

That is how a skipped scan is told from a clean one, which MovieCollectionManager's sweep could not do: its required
green tick passed on runs where Trivy never ran.

**A green run's counts are readable in one place only**: the `sweep/verdict` commit status. The forge has no log or
artifact endpoint, and the failure digest publishes only on failure. So:

```bash
node scripts/ci-status.mjs status --sha <sha>          # the sweep/verdict status and its description
node scripts/ci-status.mjs failure --run <id> --job sweep   # on failure, the ✗ BLOCKING lines
```

The context is named `<job>/<label>`, with no spaces, on purpose. `ci-status` reads `a / b` as workflow `a`, job `b`.
The first name, `image-scan / verdict`, sent it looking for a job called `verdict` (measured on run 8286).

## Allowlisting a finding that cannot be fixed yet

The remedies come in this order:
1. Re-pin the image to a newer digest that carries the fix.
2. For an image BELAY builds, upgrade the package in its Dockerfile.
3. Only then, an entry in `security/images/allowlist.yaml`.

Each entry needs every field: `image`, `id`, `justification`, `addedBy` and `expiry`.

- **`image` must carry a version (`:26…`) or a digest (`@sha256:…`).** A bare name or a floating tag (`node`,
  `node:latest`) is refused. It would match every future version, so the entry could never end, and it would silently
  suppress every later advisory too.
- **A re-pin discharges the entry.** Its key no longer matches, the finding blocks again if it is still there, and
  the gate reports the entry `UNMATCHED`. Re-key or delete it then.
- Expiry uses `scripts/allowlist-expiry.mjs`: a warning 14 days ahead, and an expired entry stops suppressing.

## The pins

The Trivy version and the sha256 of its release tarball live **only** in `scripts/install-trivy.mjs` (`TRIVY_PIN`),
and they move together.
- The sha256 is pinned in the repository rather than read from the release's own `checksums.txt`. A same-origin
  checksum catches corruption, not tampering.
- The piped installer is never used. MovieCollectionManager measured it resolving a version, then downloading nothing,
  without an error.
- Renovate tracks `TRIVY_PIN` once it is adopted (item 47).

## Measured traps

- **Trivy forwards `GITHUB_TOKEN` to ghcr.** On the CI runner that is a Forgejo token, and ghcr answered
  `DENIED: denied` (run 8286), while an anonymous request from the dev container got HTTP 200. Trivy runs without
  `GITHUB_TOKEN` or `GH_TOKEN`.
- **The default database mirror is unreachable from the dev container.** Both databases list ghcr first and
  `mirror.gcr.io` second.
- **The baseline on 2026-11-24 (run 8290):** `node:26-bookworm@sha256:b7087bc4…` carried one fixable Critical,
  CVE-2026-99083 in `linux-libc-dev` 6.1.190-1, fixed in 6.1.192-1. Docker Hub's current digest **was** the pin, so no
  re-pin could clear it.
  - The sweep allowlists it until 2026-12-24.
  - `toolchain.Dockerfile` upgrades the package, so the image BELAY publishes is clean.
  - Delete both once upstream rebuilds and the base is re-pinned.

## Not a required check

The sweep is deliberately not a required context (research R8 of feature 010). The hard gate is the builder: no
vulnerable dev image is pushed. The soft spot is that a PR adding a vulnerable third-party image can merge with a red,
optional `image-scan` check. It is recorded in `openwiki/invariants/unenforced-rules.md`.
