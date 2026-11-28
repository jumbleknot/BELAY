#!/usr/bin/env node
// The pdlc MCP server (feature 014). Claude Desktop starts this file over stdio; stdout is the protocol,
// so every log line goes to stderr (log.mjs).
//
// tools/call is handled HERE rather than by the SDK's McpServer, which validates arguments before any
// handler runs and answers with its own error text. Owning the call path is what lets every call,
// including one with invalid input, be refused in the contract's shape (invalid_input, write guard 0)
// and write its audit line before the result is returned (constitution 1.1.0, research R17).
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Refusal } from './refusal.mjs';
import { PANE_URI, TOOLS, TOOL_NAMES, inputJsonSchema } from './tool-contract.mjs';
import { createToolHandlers } from './tools.mjs';

export const SERVER_NAME = 'pdlc';
/** The package's own version, which the manifest's version must equal (one place, no second pin). */
export const SERVER_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const summariseIssues = (error) => error.issues
  .map((i) => `${i.path.length ? i.path.join('.') : 'arguments'}: ${i.message}`)
  .slice(0, 5).join('; ');

/**
 * @param {{log: ReturnType<import('./log.mjs').createLogger>, redact: (v: unknown) => unknown,
 *          handlers?: Record<string, Function>}} deps `handlers` overrides individual handlers (tests)
 */
export function createServer(deps) {
  const { log, redact } = deps;
  const handlers = { ...createToolHandlers(deps), ...(deps.handlers ?? {}) };
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {}, resources: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_NAMES.map((name) => ({ name, description: TOOLS[name].description, inputSchema: inputJsonSchema(name), ...(TOOLS[name]._meta && { _meta: TOOLS[name]._meta }) })),
  }));

  // Feature 016 (research R9): the right-hand pane is one MCP App page, a self-contained file the bundle carries.
  const PANE_MIME = 'text/html;profile=mcp-app';
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: PANE_URI, name: 'document-pane', title: 'Proposal and spec pane', mimeType: PANE_MIME }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== PANE_URI) throw new Error(`unknown resource ${request.params.uri}`);
    return { contents: [{ uri: PANE_URI, mimeType: PANE_MIME, text: readFileSync(new URL('../ui/document-pane.html', import.meta.url), 'utf8') }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = request.params.name;
    const args = request.params.arguments ?? {};
    const correlation_id = extra?.requestId ?? null;
    const where = { repo: typeof args.repo === 'string' ? args.repo : undefined, number: Number.isInteger(args.number) ? args.number : undefined };

    const finish = (decision, { code, outcome, result, error }) => {
      const repo = result?.repo ?? where.repo;
      const number = result?.number ?? where.number;
      // Feature 016: a spec tool's line names the feature branch it acted on (plan "Logging and audit").
      const branch = typeof result?.branch === 'string' ? result.branch : typeof error?.branch === 'string' ? error.branch : undefined;
      log.audit({ correlation_id, tool, ...(repo !== undefined && { repo }), ...(number !== undefined && { number }), ...(branch !== undefined && { branch }), decision, ...(code && { code }), outcome });
      if (decision === 'allowed') {
        const clean = redact(result);
        return { content: [{ type: 'text', text: JSON.stringify(clean) }], structuredContent: clean };
      }
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(redact(error)) }] };
    };

    try {
      if (!Object.hasOwn(TOOLS, tool)) throw new Refusal('invalid_input', `there is no tool "${tool}"`);
      const parsed = TOOLS[tool].input.safeParse(args);
      if (!parsed.success) throw new Refusal('invalid_input', `invalid arguments for ${tool}: ${summariseIssues(parsed.error)}`);
      const result = await handlers[tool](parsed.data, { correlation_id });
      return finish('allowed', { outcome: 'ok', result });
    } catch (e) {
      if (e instanceof Refusal) return finish('refused', { code: e.code, outcome: `refused: ${e.code}`, error: e.toJSON() });
      // Not a contract refusal: an unexpected failure. Its message is redacted, its stack never sent.
      log.error(`unexpected failure in ${tool}`, { correlation_id, tool, detail: String(e?.message ?? e) });
      return finish('refused', { code: 'internal_error', outcome: 'error', error: { refused: true, code: 'internal_error', reason: `${tool} failed unexpectedly; see the server log for correlation_id ${correlation_id}` } });
    }
  });

  return server;
}

const isEntryPoint = () => {
  try { return process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; }
};

/**
 * The production wiring: configuration from the environment (Claude Desktop's user_config, through the
 * manifest's mcp_config.env), then every module, then stdio. A ConfigError stops the server with ONE
 * redacted stderr line naming the variable, before anything else starts (spec FR-004).
 */
export async function main({ env = process.env, stderr = process.stderr } = {}) {
  const { loadConfig, ConfigError } = await import('./config.mjs');
  const { createLogger } = await import('./log.mjs');
  const { createRedactor } = await import('./redact.mjs');

  let config;
  try {
    config = loadConfig(env);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    const redact = createRedactor({ secrets: [env.PDLC_FORGE_TOKEN] });
    createLogger({ stream: stderr, redact }).error(`cannot start: ${e.message}; set it in the extension's settings`, { variable: e.variable });
    return 1;
  }

  const [{ StdioServerTransport }, { createForgeClient }, { createRepoAllowlist }, { createProposals },
    { createLocalCopy }, { createGitRunner }, { createSetupCheck }, { createSpecKitRunner }, { createSpecWorktree },
    { createSpecFiles }, { createSpecLifecycle }, { createSpecApproval }, { createDocumentPane }] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/stdio.js'), import('./forge-client.mjs'), import('./repo-allowlist.mjs'),
    import('./proposals.mjs'), import('./local-copy.mjs'), import('./git-runner.mjs'), import('./setup-check.mjs'),
    import('./spec-kit-runner.mjs'), import('./spec-worktree.mjs'), import('./spec-files.mjs'), import('./spec-lifecycle.mjs'),
    import('./spec-approval.mjs'), import('./document-pane.mjs'),
  ]);
  const redact = createRedactor({ secrets: [config.token] });
  const log = createLogger({ stream: stderr, redact });
  const forge = createForgeClient({ config });
  const allowlist = createRepoAllowlist({ forge, config });
  const git = createGitRunner({ token: config.token });
  const proposals = createProposals({ forge, allowlist, config });
  const localCopy = createLocalCopy({
    cloneRoot: config.cloneRoot,
    originUrlFor: (name) => `${config.forgeUrl}/${encodeURIComponent(config.owner)}/${encodeURIComponent(name)}.git`,
    git,
  });
  const specFiles = createSpecFiles();
  const specWorktree = createSpecWorktree({ cloneRoot: config.cloneRoot, git });
  const deps = {
    log, redact, allowlist, proposals, localCopy,
    pane: createDocumentPane({ allowlist, proposals, localCopy, worktree: specWorktree, files: specFiles, cloneRoot: config.cloneRoot }),
    setupCheck: createSetupCheck({ forge, allowlist, config }),
    // Feature 016. The Spec Kit runner never receives the token: its scripts run with none (research R1).
    specs: createSpecLifecycle({
      forge, allowlist, proposals, localCopy, config,
      specKit: createSpecKitRunner({ cloneRoot: config.cloneRoot, git }),
      worktree: specWorktree,
      files: specFiles,
      approval: createSpecApproval({ git }),
    }),
  };
  await createServer(deps).connect(new StdioServerTransport());
  log.info(`started ${SERVER_NAME} ${SERVER_VERSION} for owner ${config.owner}`);
  return null;
}

if (isEntryPoint()) {
  const code = await main();
  if (code !== null) process.exitCode = code;
}
