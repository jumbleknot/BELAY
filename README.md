# BELAY

**B**uild, **E**ngineering, **L**ifecycle & **A**utomation **Y**ard

BELAY is a polyglot monorepo for common tooling that is built and maintained in one place and shared across other repositories. It covers:

- **SDLC** – software development lifecycle tooling: build, test, release, and versioning
- **PDLC** – product development lifecycle tooling: planning, specification, and delivery workflows
- **DevSecOps** – CI/CD pipelines, security scanning, policy, and infrastructure automation
- **Engineering utilities** – shared scripts, templates, configuration, and developer tooling

## Purpose

Putting this tooling in one repo means that:

- every project shares one source of truth for its pipelines, conventions, and automation
- improvements are made once and then adopted by the repos that use BELAY
- tooling is versioned and tested like any other product

## Status

Early setup. Tooling will be added here as it is developed.

## Development

BELAY is a pnpm + Nx workspace. With Node 24 or later:

```bash
pnpm install --frozen-lockfile   # install the workspace (pnpm version comes from package.json)
pnpm nx run scripts:lint         # gates and selftests
pnpm nx run scripts:test         # script unit tests
```

Every pull request runs the same checks in CI. See [docs/runbooks/ci.md](docs/runbooks/ci.md).

The backlog is this repository's Forgejo issue tracker, worked with `node scripts/backlog.mjs`. See
[docs/runbooks/backlog.md](docs/runbooks/backlog.md).

## License

[MIT](LICENSE) © 2026 Jumbleknot
