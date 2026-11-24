# ADR-0004: A self-hosted Renovate bot proposes dependency, digest and lockfile updates

- **Status:** Accepted
- **Date:** 2026-11-23
- **Approved by:** the maintainer, 2026-11-23, in a Claude Code session, after a gap review of BELAY against MCM's learnings
- **Related:** backlog item 47 (adopt the bot, needs a spec), backlog item 48 (its health loop), backlog item 49 (image CVE scanning); MCM features 057 and 058

## Context

BELAY pins nearly everything:

- every third-party action, by commit SHA;
- the dev-container base image, by digest;
- the lockstep tool groups, to exact versions;
- every install, through `pnpm-lock.yaml`.

Pinning buys reproducibility and supply-chain safety, but a pinned thing never updates itself. Before
this decision nothing moved BELAY's pins. Feature 006 explicitly deferred "automatic dependency-bump
pull requests". The weekly `devcontainer-image` rebuild reuses the pinned base digest, so it cannot
pick up a base-image patch by itself. Because other repositories consume BELAY's tooling and pins,
staleness here spreads.

MovieCollectionManager (MCM) runs a self-hosted Renovate and measured how a bot fails, mostly
silently: on the wrong Node version, with a schedule window its cron never intersected, with lock files
that proposed nothing because ranges already allowed the fix (MCM feature 058), and with allowlist
expiry cliffs (MCM feature 057).

## Decision

**BELAY adopts Renovate, run as a Forgejo Actions workflow** on BELAY's own runner, with a dedicated
bot account. The hosted Renovate app supports only GitHub, and BELAY's forge is self-hosted.

The bot **proposes and never merges**:
- `automerge` is false everywhere;
- CI judges every bot PR like any other;
- a human merges.

The configuration's shape, schedule, groups and holds are decided in the feature spec that backlog
item 47 calls for. This ADR fixes only these points:
- a single top-level `renovate.json`;
- digest pinning for images;
- lockfile maintenance;
- a release-age cooling-off period;
- security updates exempt from the schedule;
- every hold carries a written justification and a re-check rule.

Alternatives considered:
- Updating pins by hand. Rejected: nobody reads release notes for a few hundred pins, and a hand
  process falls quietly behind until an upgrade becomes a project of its own.
- Dependabot or the hosted Renovate app. Rejected: neither runs against a self-hosted Forgejo.
- Automerge for patch updates. Rejected: BELAY is a dependency of other repositories, so a merge is a
  release to its consumers and keeps a human decision.

## Consequences

- **A new long-lived credential**: the bot's token, stored only as an Actions secret, never in the
  dev container, and scoped to what the bot needs. The secrets posture page gains it when the spec
  lands.
- **The bot is not done until its health loop is** (backlog item 48): a weekly health job whose
  silence is the alarm, a check that the lockfile-refresh PR appeared inside its window, and a branch
  reaper. MCM's lesson is that a bot that silently stops is worse than no bot, because you believe you
  are covered.
- Bot PRs rewrite lock files, workflows and manifests, which no wiki page may cite as its `resource`
  ([ADR-0002](ADR-0002-session-maintained-wiki.md)).
- Lockstep pins move as one PR per group, so `check-toolchain-consistency.mjs` has to pass on a bot PR.
  That is an acceptance test for the spec.
