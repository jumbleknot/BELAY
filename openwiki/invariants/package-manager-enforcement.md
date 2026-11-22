---
type: Convention
title: Package-manager enforcement (pnpm only)
description: Why npm and yarn are hard-blocked rather than discouraged — the root preinstall hook running only-allow pnpm, the single packageManager declaration that pins pnpm's version, the frozen-lockfile install, and the allowBuilds supply-chain control in pnpm-workspace.yaml.
tags: [pnpm, package-manager, tooling, supply-chain]
timestamp: 2026-11-22
---

# Package-manager enforcement (pnpm only)

pnpm is the only package manager for the JavaScript workspace. npm and yarn are prohibited outright,
and not only in the docs. The root `package.json`'s `preinstall` script enforces it mechanically:

```json
"preinstall": "npx --yes only-allow pnpm"
```

Install with `pnpm install --frozen-lockfile`. The pnpm version comes from `packageManager` in the
root `package.json`. CI installs exactly that version through `scripts/install-pnpm.sh`.

## Gotchas

- **The guard is a `preinstall` hook, not a convention.** It fires under whatever package manager was
  actually invoked, so `npm install` or `yarn` aborts with "Use pnpm install" before anything is
  written. In a tree that already has pnpm's symlinked `node_modules`, npm crashes even earlier in its
  own dependency resolver. That is also blocked, just less cleanly. There is no supported recovery
  path through npm or yarn.
- **The pnpm version is declared once, in the ROOT `package.json`.** A workspace package must never
  declare its own `packageManager`. MovieCollectionManager measured what goes wrong: Renovate maintains
  each copy as a separate dependency, and an app copy drifted a whole major version behind the root.
  A directory with its own `pnpm-workspace.yaml` uses its own copy from any working directory, so a
  second copy there silently wins. The rule is "declared once", not "declared consistently", because
  an agreeing copy is one bot PR away from drifting.
- **Every package with an install script needs an explicit `allowBuilds` entry in
  `pnpm-workspace.yaml`.** pnpm 11 and later make an undecided package a hard error
  (`ERR_PNPM_IGNORED_BUILDS`, and the install exits 1). A postinstall script is arbitrary code running
  at install time, so this is a supply-chain control. Never blanket-`true` the placeholder block pnpm
  writes. Set an entry to `true` only with a reason.
- **`overrides` belong in `pnpm-workspace.yaml`, not in `package.json`'s `pnpm` field.** pnpm 11 and
  later no longer read that field and only warn that the keys were ignored. An override exists to
  force a vulnerable transitive dependency to a patched version, so an ignored one quietly lets the
  vulnerability back in. If a pnpm upgrade warns about ignored keys, move them. Don't dismiss the
  warning.
- **A freshly published transitive can fail a frozen install.** pnpm 11 and later apply a
  release-age policy when they verify the lock file. If an install fails with
  `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, wait for the package to age past the cutoff and re-run.
  Use `minimumReleaseAgeExclude` only for a security fix needed now.

See [Nx as the universal task runner](./nx-task-runner.md) for how installed tools are then invoked.
