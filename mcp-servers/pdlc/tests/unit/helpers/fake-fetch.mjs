// A recording fetch double for the unit tier. `routes` maps "METHOD /path" (the path after /api/v1,
// without the query) to a handler returning {status, body, headers} or throwing to simulate a network
// failure. Every call is recorded so a test can assert that NO write request was made.
export function fakeFetch(routes = {}, { base = 'https://forge.example/api/v1' } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const path = u.href.startsWith(base) ? u.pathname.slice(new URL(base).pathname.length) : u.pathname;
    calls.push({ method, url: u.href, path, query: Object.fromEntries(u.searchParams), headers: { ...(init.headers ?? {}) }, body: init.body });
    const handler = routes[`${method} ${path}`] ?? routes[`* ${path}`];
    if (!handler) return response({ status: 404, body: { message: `no fake route for ${method} ${path}` } });
    const r = await handler({ method, path, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined, calls });
    return response(r);
  };
  return { fetch, calls, writes: () => calls.filter((c) => c.method !== 'GET') };
}

function response({ status = 200, body = null, headers = {}, text } = {}) {
  const payload = text ?? (body === null ? '' : JSON.stringify(body));
  return new Response(status === 204 ? null : payload, { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A paged list handler over `items`, honouring page/limit and answering x-total-count. */
export function paged(items) {
  return ({ query }) => {
    const limit = Number(query.limit ?? 30);
    const page = Number(query.page ?? 1);
    return { body: items.slice((page - 1) * limit, page * limit), headers: { 'x-total-count': String(items.length) } };
  };
}
