# Contract: `backlog.mjs close-proposal` and the `after_specify` hook (BELAY)

Spec FR-033 and FR-035; research R14. This path never involves the `pdlc` server.

## Command

```text
node scripts/backlog.mjs close-proposal <n> --spec specs/NNN-slug [--json]
```

| Exit | Meaning |
| --- | --- |
| 0 | Closed now, with the comment. Or it was already closed by this flow, which is idempotent and says "already closed" |
| 2 | Usage or validation: not a proposal, bot-managed, the spec folder has no `spec.md`, or the issue was closed without this flow's comment |
| 3 / 4 / 5 | Credential / authorisation / transport, as for every `backlog.mjs` verb |

- **Comment text**: ``Superseded by spec `specs/NNN-slug/` (branch `NNN-slug`).`` The branch is read from git, never
  typed.
- **Order**: comment first, then close. If the close fails after the comment was posted, a re-run sees the comment and
  completes the close.
- **Same-repository write guard**: unchanged. Writes go to `origin`'s repository only.

## Hook

`.specify/extensions.yml`, under `hooks.after_specify`:

```yaml
  - extension: belay
    command: speckit.belay.close-proposal
    enabled: true
    optional: false
    priority: 20
    prompt: Close the proposal this spec came from?
    description: Close the source proposal with a link to the new spec (feature 014)
    condition: null
```

It is registered in `EXTENSION_HOOKS` (`scripts/check-speckit-overrides.mjs`) with `local: true`. The skill
`.claude/skills/speckit-belay-close-proposal/SKILL.md` is in `PROJECT_OWNED`. Both are listed in the inventory table of
`docs/runbooks/spec-kit.md`.

## Skill behaviour

1. Read `.specify/feature.json` to get the feature directory, then that directory's `spec.md`.
2. Find `Proposal #(\d+)` in the `**Input**` line.
   - **None**: print "not from a proposal — nothing to close" and stop.
   - **More than one distinct number**: stop and ask the operator which one.
3. Run `node scripts/backlog.mjs close-proposal <n> --spec <feature dir>` and relay its output and exit code.

## Pick-up convention (the `forgejo-issues` skill)

1. `node scripts/backlog.mjs ready` lists the ready proposals.
2. `node scripts/backlog.mjs show <n>` gives the body.
3. Start `/speckit-specify` with this input:

   ```text
   Proposal #<n>: <title>

   <body>
   ```
