---
type: Decision
title: ADR-0005 — operator-tool MCP servers, local stdio, shipped as Claude Desktop Extensions
description: The maintainer's 2026-11-25 approval (feature 014, M1 and M2) of a second MCP server class in constitution 1.1.0 — local stdio servers a desktop assistant launches for one operator, Node or Python with no Dockerfile — with its tailnet transport rule and host-log audit rule, the .mcpb packaging through a hoisted pnpm deploy, the three exact-pinned packages, the mcp-servers/* workspace entry, and why a remote or bridged server was rejected.
tags: [decision, adr, mcp, constitution, claude-desktop]
resource: docs/decisions/ADR-0005-operator-tool-mcp-servers.md
resource-sha256: 1d08b0a027f30c2a7b0dfa2b5bd33aa24ccd937fc90ec4d022991661047e4cb1
timestamp: 2026-11-27T18:27:27.827Z
---

# ADR-0005 — operator-tool MCP servers

Accepted on 2026-11-25 for feature 014's `pdlc` server. Constitution 1.0.1 made every MCP server a
Python Docker container served by the Agent Gateway. `pdlc` is a local process that Claude Desktop
launches over stdio for one operator, so 1.1.0 adds an **operator-tool MCP server** class: Node
(pnpm and Nx) or Python, no Dockerfile, a narrowest-scope credential, a write allowlist, and the
usual testing tiers. It ships as a Claude Desktop Extension (`.mcpb`).

**Superseded in part by [ADR-0006](adr-0006-pdlc-spec-intake.md)** (feature 016): the `pdlc` token's
`read:repository` scope and the read-only-copies premise. The rest stands.

## Gotchas

- **Two constitution rules change for this class only.** Tailnet transport meets the TLS rule. The
  audit log is the host's capture of the server's stderr plus the forge's issue history, kept as long
  as the host keeps it, not 90 days. The server never opens a log file.
- **The bundle needs a real, flat `node_modules`.** pnpm's default layout is symlinks, which a zip
  does not carry, so `pdlc:pack` stages with `pnpm deploy --prod --config.node-linker=hoisted` first.
- **Three exact pins, no install scripts**: `@modelcontextprotocol/sdk` and `zod` at runtime,
  `@anthropic-ai/mcpb` for packing. `allowBuilds` is unchanged.
- **The server stays local.** A remote connector would be reached from Anthropic's cloud, putting a
  forge write path on the internet. A tailnet server with a bridge is the option to revisit if there
  are ever more operators.
- **A new credential**: a dedicated `pdlc` token (`write:issue` + `read:repository`) on the
  workstation only (see the [secrets posture](../invariants/secrets-management.md)).
- **Nothing BELAY runs may depend on the server.** A guard test enforces it.
