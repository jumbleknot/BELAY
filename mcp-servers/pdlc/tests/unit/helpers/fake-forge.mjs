// An in-memory forge for the unit tier: just enough of the issues API, with its measured quirks
// (research R8): `limit` caps at 50, totals come from x-total-count, an unknown name in `labels=` is
// IGNORED (the unfiltered set comes back), and pull requests interleave unless type=issues is sent.
// Every request is recorded, so a test can assert that a refusal made no write.
const LABEL_NAMES = ['type/proposal', 'status/proposal-draft', 'status/needs-spec', 'priority/p1', 'priority/p2',
  'priority/p3', 'status/bot-managed', 'type/feature', 'type/bug'];

export function fakeForge({ owner = 'operator', repos = ['BELAY'], labels = LABEL_NAMES, apiBase = 'https://forge.example/api/v1' } = {}) {
  let clock = 0;
  const now = () => `2026-11-25T10:${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock++ % 60).padStart(2, '0')}Z`;
  const state = {
    repos: repos.map((name) => ({ name, owner: { login: owner }, default_branch: 'main', description: `${name} repo` })),
    labels: Object.fromEntries(repos.map((r) => [r.toLowerCase(), labels.map((name, i) => ({ id: 1000 + i, name }))])),
    issues: Object.fromEntries(repos.map((r) => [r.toLowerCase(), []])),
    files: {}, templates: {},
    failNext: null,
  };
  const calls = [];
  let nextNumber = 1;

  const labelRows = (repo, names) => names.map((n) => {
    const l = state.labels[repo].find((x) => x.name === n);
    if (!l) throw new Error(`fake forge: no label ${n}`);
    return { ...l };
  });

  /** Seed an issue (or a PR with pull: true). Returns it. */
  const addIssue = (repo, { title, body = '', labels: names = [], state: st = 'open', pull = false, comments = [] }) => {
    const issue = { number: nextNumber++, title, body, labels: labelRows(repo.toLowerCase(), names), state: st,
      updated_at: now(), html_url: `https://forge.example/${owner}/${repo}/issues/${nextNumber - 1}`,
      ...(pull && { pull_request: { merged: false } }), comments: comments.map((c) => ({ ...c, id: nextNumber * 100 })) };
    state.issues[repo.toLowerCase()].push(issue);
    return issue;
  };

  const page = (rows, query) => {
    const limit = Math.min(Number(query.limit ?? 30), 50);
    const p = Number(query.page ?? 1);
    return { status: 200, body: rows.slice((p - 1) * limit, p * limit), headers: { 'x-total-count': String(rows.length) } };
  };
  const view = (i) => { const { comments, ...rest } = i; return structuredClone(rest); };
  const touch = (i) => { i.updated_at = now(); };

  const routes = [
    ['GET', /^\/repos\/search$/, ({ query }) => {
      const r = page(state.repos, query); return { ...r, body: { ok: true, data: r.body } };
    }],
    ['GET', /^\/repos\/([^/]+)\/([^/]+)\/labels$/, ({ m, query }) => page(state.labels[m[2].toLowerCase()] ?? [], query)],
    // Feature 016: branch protections (report-only in check_setup); a test sets state.protections, else 404.
    ['GET', /^\/repos\/([^/]+)\/([^/]+)\/branch_protections$/, () => state.protections ?? { status: 404, body: { message: 'not set' } }],
    ['GET', /^\/repos\/([^/]+)\/([^/]+)\/issue_templates$/, ({ m }) => ({ status: 200, body: state.templates[m[2].toLowerCase()] ?? [] })],
    ['GET', /^\/repos\/([^/]+)\/([^/]+)\/raw\/(.+)$/, ({ m }) => {
      const t = state.files[`${m[2].toLowerCase()}:${decodeURIComponent(m[3])}`];
      return t === undefined ? { status: 404, body: { message: 'not found' } } : { status: 200, text: t };
    }],
    ['GET', /^\/repos\/([^/]+)\/([^/]+)\/issues$/, ({ m, query }) => {
      let rows = state.issues[m[2].toLowerCase()];
      const st = query.state ?? 'open';
      if (st !== 'all') rows = rows.filter((i) => i.state === st);
      if (query.type === 'issues') rows = rows.filter((i) => !i.pull_request);
      if (query.labels) {
        const known = state.labels[m[2].toLowerCase()].map((l) => l.name);
        const wanted = query.labels.split(',').filter((n) => known.includes(n));
        rows = rows.filter((i) => wanted.every((w) => i.labels.some((l) => l.name === w)));
      }
      if (query.q) rows = rows.filter((i) => `${i.title}\n${i.body}`.toLowerCase().includes(query.q.toLowerCase()));
      return page([...rows].reverse().map(view), query);
    }],
    ['GET', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/, ({ issue }) => ({ status: 200, body: view(issue) })],
    ['GET', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/, ({ issue, query }) => page(issue.comments, query)],
    ['POST', /^\/repos\/([^/]+)\/([^/]+)\/issues$/, ({ m, body }) => {
      const repo = m[2].toLowerCase();
      const names = body.labels.map((id) => state.labels[repo].find((l) => l.id === id)?.name ?? `unknown-${id}`);
      const i = addIssue(state.repos.find((r) => r.name.toLowerCase() === repo).name, { title: body.title, body: body.body, labels: names.filter((n) => !n.startsWith('unknown-')) });
      return { status: 201, body: view(i) };
    }],
    ['PATCH', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/, ({ issue, body }) => {
      for (const k of ['title', 'body', 'state']) if (body[k] !== undefined) issue[k] = body[k];
      touch(issue); return { status: 201, body: view(issue) };
    }],
    ['POST', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/labels$/, ({ m, issue, body }) => {
      for (const id of body.labels) {
        const l = state.labels[m[2].toLowerCase()].find((x) => x.id === id);
        if (l && !issue.labels.some((x) => x.id === id)) issue.labels.push({ ...l });
      }
      touch(issue); return { status: 200, body: issue.labels };
    }],
    ['DELETE', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/labels\/(\d+)$/, ({ m, issue }) => {
      issue.labels = issue.labels.filter((l) => l.id !== Number(m[4])); touch(issue); return { status: 204 };
    }],
    ['POST', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/, ({ m, issue, body }) => {
      const c = { id: issue.comments.length + 1, user: { login: owner }, created_at: now(), body: body.body,
        html_url: `https://forge.example/${owner}/${m[2]}/issues/${issue.number}#issuecomment-${issue.comments.length + 1}` };
      issue.comments.push(c); touch(issue); return { status: 201, body: c };
    }],
  ];

  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const path = decodeURI(u.pathname.slice(new URL(apiBase).pathname.length));
    const query = Object.fromEntries(u.searchParams);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, query, url: u.href, headers: { ...(init.headers ?? {}) }, body });
    if (state.failNext) { const f = state.failNext; state.failNext = null; if (f === 'network') throw new TypeError('fetch failed'); return respond({ status: f, body: { message: `failure ${f} with ${init.headers?.Authorization}` } }); }
    for (const [verb, re, handler] of routes) {
      const m = path.match(re);
      if (verb !== method || !m) continue;
      if (m[2] && !state.issues[m[2].toLowerCase()]) return respond({ status: 404, body: { message: 'no repo' } });
      let issue;
      if (m[3] && /^\d+$/.test(m[3])) {
        issue = state.issues[m[2].toLowerCase()].find((i) => i.number === Number(m[3]));
        if (!issue) return respond({ status: 404, body: { message: 'no issue' } });
      }
      return respond(handler({ m, query, body, issue }));
    }
    return respond({ status: 404, body: { message: `fake forge has no route ${method} ${path}` } });
  };

  return {
    fetch, calls, state, addIssue,
    writes: () => calls.filter((c) => c.method !== 'GET'),
    issue: (repo, n) => state.issues[repo.toLowerCase()].find((i) => i.number === n),
    issues: (repo) => state.issues[repo.toLowerCase()],
  };
}

function respond({ status = 200, body = null, headers = {}, text } = {}) {
  const payload = text ?? (body === null ? null : JSON.stringify(body));
  return new Response(status === 204 ? null : payload, { status, headers: { 'content-type': 'application/json', ...headers } });
}
