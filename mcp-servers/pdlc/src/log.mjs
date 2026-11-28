// The JSON-lines logger (research R17). Stdout is the MCP protocol stream, so every line goes to
// stderr, which Claude Desktop captures into its per-server log: that host-written file is the audit
// log for operator-tool MCP servers (constitution 1.1.0). The server never opens a log file.

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
const SERVICE = 'pdlc';

/** The only fields an audit line may carry: no body, no section text, no token (R17). */
const AUDIT_FIELDS = new Set(['correlation_id', 'tool', 'repo', 'number', 'branch', 'decision', 'code', 'outcome']);
const DECISIONS = new Set(['allowed', 'refused']);

/**
 * @param {{stream?: {write(s: string): unknown}, redact: (v: unknown) => unknown, level?: string, clock?: () => Date}} opts
 */
export function createLogger({ stream = process.stderr, redact, level = 'INFO', clock = () => new Date() }) {
  const threshold = Math.max(0, LEVELS.indexOf(String(level).toUpperCase()));

  const line = (record) => `${JSON.stringify(redact(record))}\n`;

  const emit = (lvl, msg, fields = {}) => {
    if (LEVELS.indexOf(lvl) < threshold) return;
    const { correlation_id = null, tool = null, ...rest } = fields;
    try {
      stream.write(line({ ts: clock().toISOString(), level: lvl, service: SERVICE, correlation_id, tool, ...rest, msg }));
    } catch {
      // A logging failure must never crash or change a tool call (constitution: No Business Logic in Logging).
    }
  };

  /**
   * One line per tool call, allowed or refused, written before the result is returned. Unlike the
   * ordinary levels it is never filtered, and a write failure propagates: an audit event is never
   * silently discarded (constitution: Log Delivery Guarantee).
   */
  const audit = (record) => {
    for (const key of Object.keys(record)) {
      if (!AUDIT_FIELDS.has(key)) throw new TypeError(`audit record may not carry "${key}"`);
    }
    if (!DECISIONS.has(record.decision)) throw new TypeError(`audit decision must be allowed or refused, got ${JSON.stringify(record.decision)}`);
    const { correlation_id = null, tool = null, ...rest } = record;
    stream.write(line({ ts: clock().toISOString(), level: 'INFO', service: SERVICE, event: 'audit', correlation_id, tool, ...rest }));
  };

  return {
    debug: (msg, fields) => emit('DEBUG', msg, fields),
    info: (msg, fields) => emit('INFO', msg, fields),
    warn: (msg, fields) => emit('WARN', msg, fields),
    error: (msg, fields) => emit('ERROR', msg, fields),
    audit,
  };
}
