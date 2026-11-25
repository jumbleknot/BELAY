// Scrubs the forge token, Authorization values and URL userinfo from anything about to leave the
// process: log lines, tool results and error text (spec FR-018, SC-008). It is applied at the point
// of logging and of returning, never deferred to a downstream consumer.

export const REDACTED = '[REDACTED]';

const AUTH_VALUE = /(authorization["']?\s*[:=]\s*["']?)(token|bearer|basic)\s+[^\s"',;}]+/gi;
const BARE_BEARER = /\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;

const escapeForRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {{secrets?: Array<string|undefined|null>}} opts the literal values to remove (the token)
 * @returns {(value: unknown) => unknown} a pure function returning a redacted deep copy
 */
export function createRedactor({ secrets = [] } = {}) {
  const literals = secrets.filter((s) => typeof s === 'string' && s.trim() !== '')
    .sort((a, b) => b.length - a.length)
    .map((s) => new RegExp(escapeForRegExp(s), 'g'));

  const redactString = (s) => {
    let out = s;
    for (const re of literals) out = out.replace(re, REDACTED);
    return out
      .replace(AUTH_VALUE, (_, prefix, scheme) => `${prefix}${scheme} ${REDACTED}`)
      .replace(BARE_BEARER, (_, scheme) => `${scheme} ${REDACTED}`)
      .replace(URL_USERINFO, (_, scheme) => `${scheme}${REDACTED}@`);
  };

  const redact = (value) => {
    if (typeof value === 'string') return redactString(value);
    if (value instanceof Error) return redactString(String(value.message));
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = /^authorization$/i.test(k) ? REDACTED : redact(v);
      return out;
    }
    return value;
  };
  return redact;
}
