// Shared fixtures for the unit tier.
export const CANARY = 'canary-0123456789abcdef0123456789abcdef';

export const config = Object.freeze({
  forgeUrl: 'https://forge.example',
  apiBase: 'https://forge.example/api/v1',
  owner: 'operator',
  token: CANARY,
  cloneRoot: '/clones',
});

export const repoRow = (name, { owner = 'operator', default_branch = 'main', description = `${name} repo` } = {}) =>
  ({ name, owner: { login: owner }, default_branch, description, full_name: `${owner}/${name}` });

/** A repos/search handler answering the forge's {ok, data} envelope, paged. */
export const searchRoute = (rows) => ({ query }) => {
  const limit = Number(query.limit ?? 30);
  const page = Number(query.page ?? 1);
  return { body: { ok: true, data: rows.slice((page - 1) * limit, page * limit) }, headers: { 'x-total-count': String(rows.length) } };
};
