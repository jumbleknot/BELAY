#!/usr/bin/env node
// The pdlc MCP server (feature 014). Claude Desktop starts this file over stdio; stdout is the protocol,
// so every log line goes to stderr (log.mjs).
//
// tools/call is handled HERE rather than by the SDK's McpServer, which validates arguments before any
// handler runs and answers with its own error text. Owning the call path is what lets every call,
// including one with invalid input, be refused in the contract's shape (invalid_input, write guard 0)
// and write its audit line before the result is returned (constitution 1.1.0, research R17).
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Refusal } from './refusal.mjs';
import { TOOLS, TOOL_NAMES, inputJsonSchema } from './tool-contract.mjs';
import { createToolHandlers } from './tools.mjs';

export const SERVER_NAME = 'pdlc';
export const SERVER_VERSION = '0.1.0';

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
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_NAMES.map((name) => ({ name, description: TOOLS[name].description, inputSchema: inputJsonSchema(name) })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = request.params.name;
    const args = request.params.arguments ?? {};
    const correlation_id = extra?.requestId ?? null;
    const where = { repo: typeof args.repo === 'string' ? args.repo : undefined, number: Number.isInteger(args.number) ? args.number : undefined };

    const finish = (decision, { code, outcome, result, error }) => {
      const repo = result?.repo ?? where.repo;
      const number = result?.number ?? where.number;
      log.audit({ correlation_id, tool, ...(repo !== undefined && { repo }), ...(number !== undefined && { number }), decision, ...(code && { code }), outcome });
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

if (isEntryPoint()) {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { createLogger } = await import('./log.mjs');
  const { createRedactor } = await import('./redact.mjs');
  const redact = createRedactor();
  await createServer({ log: createLogger({ redact }), redact }).connect(new StdioServerTransport());
}
