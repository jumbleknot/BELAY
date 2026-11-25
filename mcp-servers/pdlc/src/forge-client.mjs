// The forge's HTTP API, with the token in the Authorization header and nowhere else (spec FR-018).
// Every failure becomes a Refusal whose reason names what was refused, never the token and never the
// forge's error body, which can carry internals.
import { Refusal } from './refusal.mjs';

/** The forge caps `limit` at 50 (research R8, measured). */
export const PAGE_LIMIT = 50;
const DEFAULT_MAX_PAGES = 10;

/**
 * @param {{config: {apiBase: string, token: string}, fetch?: typeof globalThis.fetch}} deps
 */
export function createForgeClient({ config, fetch = globalThis.fetch }) {
  const url = (path, query = {}) => {
    const u = new URL(`${config.apiBase}${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    return u.href;
  };

  const send = async (method, path, { query, body, capability = 'reach the forge API', accept = 'application/json' } = {}) => {
    const headers = { Authorization: `token ${config.token}`, Accept: accept };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(url(path, query), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new Refusal('forge_unreachable', `the forge could not be reached (${method} ${path}); nothing was written`);
    }
    if (res.ok) return res;
    // The body is drained and discarded: it is never echoed (it can carry internals or the request).
    await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Refusal('forge_auth', `the forge refused the token permission to ${capability} (HTTP ${res.status}); check the token's scopes`);
    }
    if (res.status === 404) throw new Refusal('not_found', `the forge has no such resource (${method} ${path})`);
    if (res.status >= 500) throw new Refusal('forge_unreachable', `the forge failed to ${capability} (HTTP ${res.status}); retry later`);
    throw new Refusal('invalid_input', `the forge rejected the request to ${capability} (HTTP ${res.status})`);
  };

  const json = async (res) => {
    if (res.status === 204) return null;
    const text = await res.text();
    return text === '' ? null : JSON.parse(text);
  };

  return {
    async get(path, opts = {}) { return json(await send('GET', path, opts)); },

    /** Pages until x-total-count (or an empty page); stops at maxPages and says so with `truncated`. */
    async getAll(path, { query = {}, capability, maxPages = DEFAULT_MAX_PAGES, rows: pickRows = (body) => body } = {}) {
      const items = [];
      let total = null;
      for (let page = 1; page <= maxPages; page++) {
        const res = await send('GET', path, { query: { ...query, limit: PAGE_LIMIT, page }, capability });
        const header = res.headers.get('x-total-count');
        if (header !== null && /^\d+$/.test(header)) total = Number(header);
        const rows = pickRows(await json(res)) ?? [];
        items.push(...rows);
        if (rows.length === 0 || (total !== null && items.length >= total)) return { items, total: total ?? items.length, truncated: false };
      }
      const truncated = total === null || items.length < total;
      return { items, total: total ?? items.length, truncated };
    },

    async post(path, body, opts = {}) { return json(await send('POST', path, { ...opts, body })); },
    async patch(path, body, opts = {}) { return json(await send('PATCH', path, { ...opts, body })); },
    async delete(path, opts = {}) { return json(await send('DELETE', path, opts)); },

    /** A file's bytes as text, or null when the forge has no such file (check_setup's "missing"). */
    async raw(path, { query, capability = 'read repository files' } = {}) {
      try {
        const res = await send('GET', path, { query, capability, accept: '*/*' });
        return await res.text();
      } catch (e) {
        if (e instanceof Refusal && e.code === 'not_found') return null;
        throw e;
      }
    },
  };
}
