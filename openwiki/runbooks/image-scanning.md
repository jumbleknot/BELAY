---
type: Runbook
title: Image CVE scanning — the builder gate and the scheduled sweep
description: How BELAY scans container images with a pinned, sha256-verified Trivy — the dev-container build scans before push and publishes nothing on a fixable Critical, a Tuesday and Friday sweep covers every third-party image the tree names, the verdict line always counts the images scanned, the sweep/verdict status is the only readable record of a green run, and allowlist entries must be version- or digest-keyed and expiring so a re-pin discharges them.
tags: [security, trivy, images, cve, ci, runbook]
resource: docs/runbooks/image-scanning.md
resource-sha256: d31f1a9b4eec7fd7d199a63a5cef3adad0b1ac2e6579492d549d0b654f5786b7
timestamp: 2026-11-24T01:30:25.597Z
---

# Image CVE scanning

Every image BELAY depends on is scanned in exactly one place.
- **The builder** (`devcontainer-image.yml`) scans the image it just built between `Build` and `Push`. A fixable
  Critical means nothing is pushed, so a vulnerable dev image never exists to re-pin onto.
- **The sweep** (`image-scan.yml`, Tuesday and Friday and on change) scans every third-party image the tree names.

Only a **fixable Critical** with no live allowlist entry blocks. Everything else is reported as counts. The full
procedure is in [the runbook](../../docs/runbooks/image-scanning.md).

## Gotchas

- **The verdict line always starts with the number of images scanned.** `0 images scanned`, a `NOT SCANNABLE`
  reference, or a missing report each fail. A skipped scan never reads as clean.
- **A green run's counts are only in the `sweep/verdict` commit status**: `ci-status status --sha <sha>`. The forge
  has no log or artifact endpoint. The `<job>/<label>` name, with no spaces, is what lets `ci-status` find the `sweep`
  job's bundle.
- **An allowlist key must carry a version or a digest.** A bare name would match every future version and never end.
  A re-pin makes the entry `UNMATCHED`, which is the discharge.
- **For an image BELAY builds, an allowlist entry cannot help** (its tag is a commit sha). Upgrade the package in the
  Dockerfile instead.
- **Trivy forwards `GITHUB_TOKEN` to ghcr.** On the runner it is a Forgejo token, which ghcr refuses (`DENIED`), so
  Trivy runs without it.
- **The Trivy pin lives only in `scripts/install-trivy.mjs`**, with its sha256 frozen in the repository, never read
  from the release.
- **Not a required check**: the builder is the hard gate. The soft spot is in the
  [register of unenforced rules](../invariants/unenforced-rules.md).
