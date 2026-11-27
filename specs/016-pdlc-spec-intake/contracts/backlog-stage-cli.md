# Contract: `backlog.mjs stage` and the `speckit.belay.spec-stage` hook

Replaces feature 014's `close-proposal` verb and `speckit.belay.close-proposal` hook.

## Verb

```text
node scripts/backlog.mjs stage <number> <spec-in-progress|in-engineering> --spec <specs/NNN-slug> --branch <branch>
```

1. Resolves the issue. Refuses (exit 2) unless it is open, carries `type/proposal` and is not `status/bot-managed`.
2. Refuses (exit 2) unless `<spec>/spec.md` exists in the working tree.
3. Refuses (exit 2, `stage_transition_refused`) unless the transition is in
   [stages.md](stages.md) for the caller "backlog.mjs".
4. Posts the stage comment with its trailer, then swaps the stage label.
5. Idempotent: already at that stage with the same branch prints `already <stage>` and exits 0.

Exit codes 3, 4 and 5 keep their existing meaning (credential, authorisation, transport).

## Hook

`.specify/extensions.yml`:

```yaml
after_specify:
  - extension: belay
    command: speckit.belay.spec-stage
    enabled: true
    optional: false
    priority: 20
    prompt: Move the source proposal to "spec in progress"?
    description: Record the spec's stage on the proposal it came from (feature 016)
    condition: null
after_plan:
  - extension: belay
    command: speckit.belay.spec-stage
    enabled: true
    optional: false
    priority: 20
    prompt: Move the source proposal to "in engineering"?
    description: Record that planning started on the proposal it came from (feature 016)
    condition: null
```

Both entries are registered in `scripts/check-speckit-overrides.mjs` `EXTENSION_HOOKS` with `local: true`, and in
`docs/runbooks/spec-kit.md`'s inventory. The skill `.claude/skills/speckit-belay-spec-stage/SKILL.md` is
project-owned (`PROJECT_OWNED`). It:
1. reads `.specify/feature.json` (or the branch) for the feature folder;
2. finds exactly one `Proposal #<n>` in the spec's **Input** line, or says "not from a proposal" and stops;
3. picks the stage from the feature folder: `in-engineering` when `plan.md` exists in it (the `after_plan` point),
   otherwise `spec-in-progress` (the `after_specify` point). A skill cannot see which hook invoked it, so the
   decision rests on a file that only planning creates;
4. runs the verb, and relays its output and exit code exactly.
