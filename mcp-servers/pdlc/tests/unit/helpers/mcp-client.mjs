// Connects a real MCP Client to a real server over the SDK's InMemoryTransport: the tests speak the
// actual protocol (tools/list, tools/call), never a hand-built tool list (research R11).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../../src/server.mjs';
import { createLogger } from '../../../src/log.mjs';
import { createRedactor } from '../../../src/redact.mjs';
import { CANARY } from './fixtures.mjs';

export async function connect(deps = {}) {
  const stderr = [];
  const redact = createRedactor({ secrets: [CANARY] });
  const log = deps.log ?? createLogger({ stream: { write: (s) => { stderr.push(s); return true; } }, redact });
  const server = createServer({ log, redact, ...deps });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'pdlc-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const audits = () => stderr.map((l) => JSON.parse(l)).filter((l) => l.event === 'audit');
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ...r, payload: JSON.parse(r.content[0].text) };
  };
  return { client, server, stderr, audits, call, close: () => client.close() };
}
