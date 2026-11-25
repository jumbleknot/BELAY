---
type: Decision
title: The governing constitution
description: BELAY's ratified, versioned constitution, derived from MovieCollectionManager's — the non-negotiable principles (AI assistant constraints, security, TDD), the common stack rules (pnpm, Nx, RTK, dependency pinning, documentation and the doc-impact sweep), the per-layer principles a future project inherits, and the amendment process every spec and plan is checked against.
tags: [constitution, governance, process, spec-kit]
resource: .specify/memory/constitution.md
resource-sha256: 8611f5ddd5c7480ba1260163ec48c92af4f1e02330e1c4005d4fde03c54ba8a8
timestamp: 2026-11-25T12:39:02.048Z
---

# The governing constitution

`.specify/memory/constitution.md` holds the principles every spec, plan and task list is checked
against. Every `/speckit-*` command reads it. It was ratified on 2026-11-21 as v1.0.0, derived from
MovieCollectionManager's constitution v2.11.0, and its version history is at the top of the file.
It is at **1.1.0** (2026-11-25).
The constitution supersedes every other practice. `AGENTS.md` and this wiki are runtime guidance and
must never contradict it.

## What it covers

- **Core principles**, which always apply:
  - **AI Assistant Constraints** (non-negotiable): adhere to the constitution and the plan, and ask
    when a task appears to violate either or is underspecified.
  - **Security** (non-negotiable): authentication, authorisation, sessions, data protection,
    transport and infrastructure hardening.
  - **Test-Driven Development** (non-negotiable), with the **TDD Checkpoint Format** and **Test Type
    Integrity**.
  - **Logging & Monitoring**.
- **Common technology stack and standards:**
  - pnpm only, with `packageManager` declared once, in the root `package.json` (stated so since 1.1.0;
    1.0.x said every project declares it, which the enforced check forbids), and Nx for every test,
    lint, build, e2e and deploy operation;
  - RTK in every AI-assisted shell;
  - **Dependency Security**: the lock file pins installs, lockstep groups are exact, and other
    dependencies may use `^`;
  - **Documentation**, including the mandatory doc-impact sweep.
- **Per-layer principles** for Backend Services, Frontend Apps, AI Agents and Shared Packages, with
  the stacks and Nx plugins each would use. **None of those layers has a project yet.** The sections
  describe what a new project must follow, not what exists.
- **Operator-tool MCP servers** (added in 1.1.0, [ADR-0005](../decisions/adr-0005-operator-tool-mcp-servers.md)):
  local stdio servers that a desktop or IDE assistant launches for one operator. Node or Python, no
  Dockerfile, a narrowest-scope credential and a write allowlist. The first is `mcp-servers/pdlc/`.
  The Python/Docker MCP rules now apply only to servers the Agent Gateway serves.
- **Governance**: how the constitution is amended.

## Gotchas

- **Deviating from the constitution is the one change that is not self-service.** A plan or
  implementation may diverge from `spec.md` or `plan.md` by updating them. Diverging from the
  constitution needs explicit human approval and a documented rationale, and a principle change is a
  versioned amendment: MAJOR for principles, MINOR for guidance, PATCH for clarifications.
- **The per-layer sections are inherited text, not decisions already taken for BELAY.** They describe
  the stack a backend, frontend or agent project would use. Introducing the first such project is
  still a structural decision to ask about (see [the repository page](../projects/repository.md)).
- **Operator-tool MCP servers have their own transport and audit rules.** Tailnet (WireGuard)
  transport meets the TLS 1.3 requirement. The audit log is the launching host's capture of the
  server's stderr plus the forge's issue history, with the host's retention rather than 90 days. The
  server writes one `audit` line per call and never opens the log.
- **The doc-impact sweep is a constitutional requirement, not just a template task.** It applies even
  when the tasks template is not used (see [doc drift](../runbooks/doc-drift.md)).
- **`/speckit-constitution` checks the core tasks template, not the override,** when it reviews
  dependent templates after an amendment. Check `.specify/templates/overrides/tasks-template.md` by
  hand (see [Spec Kit](../runbooks/spec-kit.md)).
