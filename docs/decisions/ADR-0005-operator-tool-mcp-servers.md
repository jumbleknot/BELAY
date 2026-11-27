# ADR-0005: Operator-tool MCP servers are local stdio Node servers, shipped as Claude Desktop Extensions

- **Status:** Accepted; superseded in part by [ADR-0006](ADR-0006-pdlc-spec-intake.md) (the `pdlc` token's
  `read:repository` scope and the read-only local copies)
- **Date:** 2026-11-25
- **Approved by:** the maintainer, 2026-11-25, in a Claude Code session while planning feature 014
  (decisions M1 and M2, and the transport, audit and locality rulings recorded in its `research.md`)
- **Related:** [feature 014](../../specs/014-pdlc-proposal-intake/spec.md) (the `pdlc` server);
  constitution 1.1.0 § Operator-Tool MCP Servers; [ADR-0001](ADR-0001-pnpm-and-nx-only.md)

## Context

Feature 014 lets the operator capture and refine feature proposals in Claude Desktop on the Windows
workstation. For that, Claude Desktop needs an MCP server, `pdlc`, that reads and writes proposal issues
on the forge and keeps read-only local clones that a Claude Desktop project can read as files.

Constitution 1.0.1 knew only one kind of MCP server: one the Agent Gateway serves, "a dedicated Python
Docker container", with its own `Dockerfile`, `pytest` and `ruff`. `pdlc` is not part of the agent
runtime. There is no gateway, no JWT to propagate and nothing to listen on a port. Claude Desktop
launches a local process and talks to it over stdio. Two more rules did not fit a one-operator local
tool:

- **Transport Security** requires TLS 1.3, and the forge is reached over the tailnet, as every BELAY
  forge tool reaches it.
- **Audit Logging** and **Log Retention** ask for a dedicated, append-only audit store kept for 90 days.
  A process that Claude Desktop starts and stops has none.

## Decision

**The constitution is amended (MINOR, 1.0.1 → 1.1.0) to add an *operator-tool MCP server* class (M1)**:
a local stdio server that a desktop or IDE assistant launches for one operator. Node (pnpm and Nx) or
Python is permitted, and no Dockerfile is required. It must still meet the Core Principles, hold a
narrowest-scope credential, enforce a write allowlist for git and the forge, and follow the testing
tiers. The Python/Docker text now applies only to servers the Agent Gateway serves. The amendment
also states two rules for this class:

- **Transport**: tailnet (WireGuard) transport meets the TLS requirement.
- **Audit**: the audit log is the launching host's capture of the server's stderr, together with the
  forge's own issue history for writes. The server writes one `audit` line per call, allowed or refused,
  before returning, and never opens the log. The OS user can edit that log, which is accepted for one
  operator on one workstation. Retention is the host's, as measured, rather than 90 days.

**`pdlc` is packaged as a Claude Desktop Extension (`.mcpb`) (M2)**, built with the official MCP SDK. The
bundle runs on the Node that ships with Claude Desktop, so the workstation needs nothing installed beyond
Git for Windows. The bundle must carry a real, flat `node_modules`, so the `pdlc:pack` target stages the
package with `pnpm --filter @belay/pdlc deploy --prod --config.node-linker=hoisted` before running
`mcpb pack`. pnpm's default isolated layout is symlinks into a store, which a zip does not carry.

**Dependencies**, all exact pins, none with an install script (so `allowBuilds` is unchanged):

| Package | Version | Kind | Why |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.32.2 | runtime | `McpServer`, `StdioServerTransport`, and `InMemoryTransport` for the contract test |
| `zod` | 4.6.7 | runtime | the SDK's schema library, declared directly because the server imports it |
| `@anthropic-ai/mcpb` | 2.1.2 | dev | `mcpb pack` and `mcpb validate`, run through `pnpm exec`, never `npx` |

**The workspace gains `mcp-servers/*`** in `pnpm-workspace.yaml`, so `mcp-servers/pdlc/` is an Nx project
(`pdlc`) like any other. No top-level folder is added: `mcp-servers/` already exists for this purpose.

Alternatives considered:

- **A Python MCP server in a Docker container**, as 1.0.1 required. Rejected: it needs Docker Desktop on
  the workstation, a bind-mounted clone folder and a second language toolchain in BELAY, all for a
  one-operator tool. Node reuses BELAY's only chosen toolchain ([ADR-0001](ADR-0001-pnpm-and-nx-only.md))
  and the patterns already proven in `scripts/backlog.mjs`.
- **A hand-written JSON-RPC stdio loop instead of the SDK.** Rejected: the bundle removes the "nothing to
  install" advantage it would have had, and the SDK owns protocol-version negotiation with Claude Desktop.
- **A remote connector (Claude Desktop given a URL).** Rejected: Claude Desktop contacts a remote
  connector from Anthropic's cloud, so the server would have to be reachable from the public internet.
  That puts a forge write path on the internet, bringing OAuth, TLS 1.3, rate limiting and security
  headers with it. The clones would also sit out of reach of Claude Desktop's file access, so grounding
  would need new file-reading tools, which changes the fixed tool contract.
- **A tailnet-only server with a local stdio bridge.** Rejected for now: it keeps the token and the logs
  off the workstation, but it needs a server to run, a bridge (the common one is a third-party package
  fetched at run time) and the same file-reading tools. It is the path to revisit if there are ever more
  operators or workstations.
- **Keeping the 90-day audit minimum** by having the server write its own log file. Rejected: the server
  would then hold a file-write path, which the write allowlist exists to rule out, and the forge already
  keeps every write permanently. Only refusal lines can age out of the host's log.

## Consequences

- **A new long-lived credential**: a dedicated forge token named `pdlc`, scoped `write:issue` +
  `read:repository`, used by nothing else. It is a Claude Desktop sensitive setting on the workstation and
  never in the dev container. The live-forge test tier maps the dev container's `FORGE_ISSUE_TOKEN`, which
  has the same scope, to `PDLC_FORGE_TOKEN` at the point of use.
- **Three new Nx targets gate or support the merge**: `pdlc:lint`, `pdlc:test` (with a 70% coverage floor
  through `check-coverage.mjs --policy`) and `pdlc:integration` (real git) run in `guardrails`.
  `pdlc:integration-forge` (the real forge, `ci-smoke`) is operator-run, and fails rather than skips
  without its credential.
- **The audit trail depends on the host.** Where Claude Desktop writes the server's stderr, and how long
  it keeps it, are measured on the workstation and stated in `docs/runbooks/pdlc.md`. A Claude Desktop
  change to its log handling is a change to the audit trail, and the runbook is re-measured.
- **The bundle is rebuilt and reinstalled by hand** after every change that merges, and the skill zip is
  re-uploaded. Nothing installs itself.
- **Renovate and SAST/SCA cover the new packages** through the lock file, as for any other dependency.
  The SDK's HTTP stack (`express`, `hono`) is in the tree but never loaded over stdio. That costs bundle
  size, not runtime attack surface, and its advisories still fail `scripts:sast`.
- **Nothing BELAY runs may depend on the server** (feature 014 FR-035). A guard test scans BELAY's own
  tooling for any reference to it.
