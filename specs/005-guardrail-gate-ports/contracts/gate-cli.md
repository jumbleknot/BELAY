# Contract: gate CLI (every ported gate)

```
node scripts/<gate>.mjs              # scan the tracked tree
node scripts/<gate>.mjs --selftest   # prove detection on planted input; touches no repo file
node scripts/<gate>.mjs --help       # usage, exit 0
```

| Exit | Meaning |
|---|---|
| 0 | clean, or the selftest passed |
| 1 | at least one finding, or the selftest broke |
| 2 | bad arguments, or unreadable or unparseable input (never silently skipped) |

- Output: one line per finding, `<file>:<line>: <rule>: <message>`, then a one-line summary.
- Unknown flags are rejected with exit 2.
- Test fixtures that must look like violations are assembled from fragments at run time, so the
  committed test file is never a violation itself.
- In CI each gate is its own command in `scripts:lint`. The failure digest's per-step log carries
  its output.

Gate-specific modes:
- `check-openwiki-governance.mjs --fingerprint <path>`: print the passage fingerprints for
  `protected.yaml`.
- `wiki-refresh.mjs --stale | --diff <page> | --record <page>`: `--stale` exits 1 when anything is
  listed.
- `check-toolchain-consistency.mjs --dir <root>`: scan a fixture root (for tests).
