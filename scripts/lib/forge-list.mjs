// Read a forge listing to its END, or fail (feature 012, research R8, FR-013).
//
// WHY THIS EXISTS. This forge caps a page at 50 rows, and ignores `?limit=` unless `&page=` is
// also given (both measured in MovieCollectionManager). A listing read as one page is silently
// short, and a short list of open PRs reads exactly like "fewer open PRs". For the branch reaper,
// that is the difference between keeping a branch and deleting one in use. So every page is read,
// the total is checked against what was read, and any mismatch throws.
//
// Two shapes:
//   - the usual one: an array page, with the total in the `x-total-count` header;
//   - with `items` (the Actions tasks listing, measured 2026-11-24): an object page
//     `{ <items>: [...], total_count }`, with no header.

export class ForgeListError extends Error {}

export async function listAll(path, { fetch: doFetch = fetch, token, base, pageSize = 50, items } = {}) {
  const rows = [];
  let total = null;
  for (let page = 1; ; page++) {
    const url = `${base}${path}${path.includes('?') ? '&' : '?'}limit=${pageSize}&page=${page}`;
    const res = await doFetch(url, { headers: token ? { Authorization: `token ${token}` } : {} });
    if (!res.ok) throw new ForgeListError(`GET ${path}: HTTP ${res.status}`);
    const body = await res.json();
    let pageRows;
    let pageTotal;
    if (items) {
      if (!body || !Array.isArray(body[items])) throw new ForgeListError(`GET ${path}: the page has an unexpected shape (no ${items} list)`);
      pageRows = body[items];
      pageTotal = body.total_count;
    } else {
      if (!Array.isArray(body)) throw new ForgeListError(`GET ${path}: the page has an unexpected shape (not a list)`);
      pageRows = body;
      pageTotal = res.headers?.get?.('x-total-count');
    }
    if (pageTotal === null || pageTotal === undefined || !Number.isInteger(Number(pageTotal))) {
      throw new ForgeListError(`GET ${path}: no total to check the read against`);
    }
    total = Number(pageTotal);
    rows.push(...pageRows);
    if (rows.length >= total || pageRows.length === 0) break;
  }
  if (rows.length !== total) throw new ForgeListError(`GET ${path}: read ${rows.length} of ${total} rows; a short read is never complete`);
  return rows;
}
