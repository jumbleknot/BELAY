# Data model: Guardrail gate ports and registry retention

## Finding (every gate)

| Field | Meaning |
|---|---|
| `file` | repository-relative POSIX path |
| `line` | 1-based line, where meaningful |
| `rule` | the rule id or name (`V15`, `G8`, `node-major`, `tailnet-host`) |
| `message` | what to fix. It never prints a secret value; topology prints only the matched host |

A gate prints one line per finding and exits 1 if there is any.

## Derived page (openwiki)

Front matter: `type`, `title`, `description`, `tags`, `timestamp` (ISO-8601 date), `resource` (one
repository-relative file), `resource-sha256` (hex SHA-256 of the resource with CRLF normalised to LF).
- **Stale** when the `resource-sha256` differs from the file's current hash. **Missing** when the
  resource does not exist.
- Only `wiki-refresh.mjs --record` writes `resource-sha256` and `timestamp`.

## Authoritative page (openwiki)

Has no `resource`, and is listed under `authoritative:` in `openwiki/protected.yaml`. Optional
`passages:` entries fingerprint a load-bearing passage, and the fingerprint is computed by the
governance gate.

## Retention configuration

```yaml
mode: report | apply
owner: <forge owner>
evidenceWindowDays: <int ≥ 1>
protect:                       # BELAY addition (research R5)
  - { package: <name>, digest: sha256:<64 hex>, note: <why> }   # note is required
packages:
  - { name, type: container|generic, keepNewest?, keepDays?, keepAll?, note? }
```

Validation: unknown keys are refused. `keepAll` is exclusive with a window. Evidence packages must
meet the durations floor. A `protect` entry must name a configured container package and a
well-formed digest.

## Retention row

`{ package, version, digest, created_at, size, decision, reason }`, where `decision` is one of
`keep:protected`, `keep:newest`, `keep:recent`, `keep:referenced`, `keep:unverified` (a manifest
that could not be read), `keep:unconfigured` (a package the config does not list), `keep:all`, or
`delete`; `reason` is free text.

A container child (`sha256:…` version) is kept while any kept index references it. If any kept index
of that package cannot be read, no child of that package is deleted.
