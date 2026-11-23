// Registry retention: the forge's package registry keeps what is needed, and nothing else.
//
// The weekly dev-container build adds a 2–3 GB `belay-devcontainer` version, and nothing removed old
// ones. Retention is a repository script, report-only by default, whose protections are read from
// the committed config BEFORE any API call. The forge's own cleanup rules match names by regex, live
// only in the web UI and have no report-only run, so they cannot protect a pinned digest.
//
// WHAT IS PROTECTED. The sandbox's image pin lives in the VM's env file, which is never committed
// (it carries the registry host). A digest is neither a secret nor a host, so the re-pin step
// records it in the config's `protect:` list, and that list is the protected set.
//
// THE MEASURED HAZARD THE DECISIONS ARE BUILT AROUND. One push can create TWO kinds of version: the
// tag, whose manifest.json IS the pinned digest (an OCI image INDEX), and the `sha256:<digest>`
// children that index references (the platform manifest, which owns the layers, and an
// attestation). An index whose image did not change REUSES the previous push's platform manifest,
// so a child can be OLDER than the tag that needs it, and "delete what is old" deletes the layers
// of the pinned image. A child is therefore never judged by age alone: it is kept while any kept
// index references it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import {
  loadConfig, ConfigError, protectedDigests, decide, main, CONFIG_PATH, bundlePublishingJobs,
} from '../registry-retention.mjs';
import { DEFAULT_DURATION_RUNS } from '../ci-status.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const SLICE = JSON.parse(readFileSync(join(HERE, 'fixtures/registry-retention/container-slice.json'), 'utf8'));
const WORKFLOWS = resolve(REPO_ROOT, '.forgejo/workflows');
const NOW = Date.parse('2026-10-31T12:00:00Z');
const PKG = 'belay-devcontainer';

/** Jobs that publish an evidence bundle, counted from the workflows themselves. */
function countBundleJobs() {
  let n = 0;
  for (const f of readdirSync(WORKFLOWS).filter((x) => /\.ya?ml$/.test(x))) {
    const wf = parseYaml(readFileSync(join(WORKFLOWS, f), 'utf8'));
    for (const job of Object.values(wf?.jobs ?? {})) {
      if ((job.steps ?? []).some((s) => /node scripts\/ci-failure-digest\.mjs/.test(s.run ?? ''))) n += 1;
    }
  }
  return n;
}

const yamlOf = (o) => JSON.stringify(o); // JSON is YAML; keeps the cases readable
const baseConfig = () => ({
  mode: 'report',
  owner: 'o',
  evidenceWindowDays: 45,
  protect: [],
  packages: [{ name: PKG, type: 'container', keepNewest: 2, keepDays: 30 }],
});
const digestOf = (n) => `sha256:${String(n).padStart(64, '0')}`;

// ── config ────────────────────────────────────────────────────────────────────────────────────

test('config: the committed file loads and says mode: report', () => {
  const text = readFileSync(resolve(REPO_ROOT, CONFIG_PATH), 'utf8');
  const cfg = loadConfig(text);
  // Report first: deletion needs a reviewed report and its own one-line PR flipping this.
  assert.equal(cfg.mode, 'report');
  const dev = cfg.packages.find((p) => p.name === PKG);
  assert.equal(dev?.type, 'container', `${PKG} is not configured as a container package`);
  assert.ok(dev.keepNewest >= 4 && dev.keepDays >= 21, `${PKG} keeps less than the newest 4 / 21 days`);
  assert.ok(Array.isArray(cfg.protect), 'the committed config has no protect: list for the re-pin step to record into');
});

test('config: refuses an unknown key, at the top level, in a package and in a protect entry', () => {
  assert.throws(() => loadConfig(yamlOf({ ...baseConfig(), modee: 'apply' })), (e) => e instanceof ConfigError && /modee/.test(e.message));
  const c = baseConfig();
  c.packages[0].keepNewst = 3;
  assert.throws(() => loadConfig(yamlOf(c)), (e) => e instanceof ConfigError && /keepNewst/.test(e.message));
  const p = baseConfig();
  p.protect = [{ package: PKG, digest: digestOf(1), note: 'pin', sourc: 'x' }];
  assert.throws(() => loadConfig(yamlOf(p)), (e) => e instanceof ConfigError && /sourc/.test(e.message));
});

test('config: refuses a bad mode', () => {
  assert.throws(() => loadConfig(yamlOf({ ...baseConfig(), mode: 'delete' })), (e) => e instanceof ConfigError && /mode/.test(e.message));
});

test('config: refuses a package that keeps nothing by rule', () => {
  const c = baseConfig();
  c.packages[0] = { name: 'x', type: 'container' };
  assert.throws(() => loadConfig(yamlOf(c)), /keepNewest|keepDays|keepAll/);
});

test('config: protect must be a list of entries naming a configured container package and a well-formed digest', () => {
  const withProtect = (protect) => yamlOf({ ...baseConfig(), protect });
  assert.throws(() => loadConfig(withProtect('sha256:abc')), (e) => e instanceof ConfigError && /protect/.test(e.message));
  // An unconfigured package: a protection that nothing would honour reads as safety it is not.
  assert.throws(
    () => loadConfig(withProtect([{ package: 'other-image', digest: digestOf(1), note: 'pin' }])),
    (e) => e instanceof ConfigError && /protect/.test(e.message) && /other-image/.test(e.message),
  );
  // A generic package has no digests to protect.
  const generic = baseConfig();
  generic.packages.push({ name: 'scratch', type: 'generic', keepNewest: 1 });
  generic.protect = [{ package: 'scratch', digest: digestOf(1), note: 'pin' }];
  assert.throws(() => loadConfig(yamlOf(generic)), (e) => e instanceof ConfigError && /scratch/.test(e.message) && /container/.test(e.message));
  // A malformed digest: short, upper-case, or a tag instead of a digest.
  for (const digest of ['sha256:abc', `sha256:${'A'.repeat(64)}`, 'latest', undefined]) {
    assert.throws(
      () => loadConfig(withProtect([{ package: PKG, digest, note: 'pin' }])),
      (e) => e instanceof ConfigError && /digest/.test(e.message),
      `accepted digest ${JSON.stringify(digest)}`,
    );
  }
  assert.doesNotThrow(() => loadConfig(withProtect([{ package: PKG, digest: digestOf(1), note: 'sandbox pin' }])));
  // An empty list, and an absent key, both mean "nothing recorded yet".
  assert.doesNotThrow(() => loadConfig(withProtect([])));
  const absent = baseConfig();
  delete absent.protect;
  assert.doesNotThrow(() => loadConfig(yamlOf(absent)));
});

test('config: refuses an evidence package window shorter than the evidence window', () => {
  const c = baseConfig();
  c.packages.push({ name: 'belay-ci-failures', type: 'generic', keepDays: 30, keepNewest: 5000 });
  assert.throws(() => loadConfig(yamlOf(c)), (e) => e instanceof ConfigError && /belay-ci-failures/.test(e.message) && /evidenceWindowDays/.test(e.message));
});

test('config: refuses an evidence package keepNewest below the durations sample × bundle jobs', () => {
  const jobs = countBundleJobs();
  assert.ok(jobs >= 2, `only ${jobs} bundle-publishing jobs found — the count is broken`);
  assert.equal(bundlePublishingJobs(), jobs, 'the script and the test count different jobs');
  const floor = DEFAULT_DURATION_RUNS * jobs;
  const c = baseConfig();
  c.packages.push({ name: 'belay-ci-failures', type: 'generic', keepDays: 45, keepNewest: floor - 1 });
  assert.throws(() => loadConfig(yamlOf(c)), (e) => e instanceof ConfigError && e.message.includes(String(floor)));
  c.packages[1].keepNewest = floor;
  assert.doesNotThrow(() => loadConfig(yamlOf(c)));
  // The control: a generic package that is NOT evidence keeps whatever window it likes.
  const other = baseConfig();
  other.packages.push({ name: 'belay-scratch', type: 'generic', keepDays: 1, keepNewest: 1 });
  assert.doesNotThrow(() => loadConfig(yamlOf(other)));
});

test('config: the committed config covers this repository\'s evidence package at the floor', async () => {
  const { bundlePackagesFor, isEvidencePackage } = await import('../ci-failure-digest.mjs');
  const cfg = loadConfig(readFileSync(resolve(REPO_ROOT, CONFIG_PATH), 'utf8'));
  const evidence = cfg.packages.filter((p) => isEvidencePackage(p.name));
  assert.deepEqual(evidence.map((p) => p.name), bundlePackagesFor('belay'),
    'the retention config must list exactly this repository\'s evidence package');
});

// ── protected set, from the config ────────────────────────────────────────────────────────────

test('protected set: built from the config\'s protect list, keyed by digest', () => {
  const cfg = loadConfig(yamlOf({ ...baseConfig(), protect: [{ package: PKG, digest: digestOf(7), note: 'sandbox pin 2026-11' }] }));
  const p = protectedDigests(cfg);
  assert.equal(p.size, 1);
  assert.equal(p.get(digestOf(7)).package, PKG);
  assert.match(p.get(digestOf(7)).source, /sandbox pin 2026-11/);
  assert.equal(protectedDigests(loadConfig(yamlOf(baseConfig()))).size, 0);
});

// ── decisions ─────────────────────────────────────────────────────────────────────────────────

/** The fixture slice as the collector would hand it to decide(). */
function sliceCollected() {
  const versions = SLICE.versions.map((v) => {
    const manifest = SLICE.files[v.version]?.find((f) => f.name === 'manifest.json');
    const index = SLICE.manifests[v.version]?.body;
    return {
      ...v,
      indexDigest: manifest ? `sha256:${manifest.sha256}` : null,
      children: (index?.manifests ?? []).map((m) => m.digest),
      size: (SLICE.files[v.version] ?? []).reduce((n, f) => n + f.Size, 0),
    };
  });
  return { [PKG]: { type: 'container', versions } };
}
const tagVersions = () => SLICE.versions.filter((v) => /^[0-9a-f]{40}$/.test(v.version))
  .sort((a, b) => b.created_at.localeCompare(a.created_at));
const indexDigestOf = (tag) => `sha256:${SLICE.files[tag].find((f) => f.name === 'manifest.json').sha256}`;
const rowOf = (rows, version) => rows.find((r) => r.version === version);

test('decisions: newest N kept, the rest deleted, and each row carries its first keep reason', () => {
  const cfg = loadConfig(yamlOf(baseConfig()));
  const rows = decide({ config: cfg, packages: sliceCollected(), protectedSet: new Map(), now: NOW });
  const tags = tagVersions();
  assert.equal(rowOf(rows, tags[0].version).decision, 'keep:newest');
  assert.equal(rowOf(rows, tags[1].version).decision, 'keep:newest');
  // tags[2] and tags[3] are inside 30 days: kept by the time window, not by count.
  assert.equal(rowOf(rows, tags[2].version).decision, 'keep:recent');
  // The two from June are outside both windows.
  assert.equal(rowOf(rows, tags[4].version).decision, 'delete');
  assert.equal(rowOf(rows, tags[5].version).decision, 'delete');
});

test('decisions: a referenced child is kept while ANY kept index references it — even when it is older', () => {
  const cfg = loadConfig(yamlOf(baseConfig()));
  const rows = decide({ config: cfg, packages: sliceCollected(), protectedSet: new Map(), now: NOW });
  const keptChildren = new Set(
    tagVersions().slice(0, 4).flatMap((t) => SLICE.manifests[t.version].body.manifests.map((m) => m.digest)),
  );
  for (const d of keptChildren) assert.equal(rowOf(rows, d)?.decision, 'keep:referenced', `${d} is not kept`);
  // The measured shared child: created by an earlier push and reused by the newest index.
  const newestChildren = SLICE.manifests[tagVersions()[0].version].body.manifests.map((m) => m.digest);
  const shared = SLICE.versions.find((v) => newestChildren.includes(v.version) && v.created_at < tagVersions()[0].created_at);
  assert.ok(shared, 'the fixture lost its shared child — re-record it');
  assert.equal(rowOf(rows, shared.version).decision, 'keep:referenced');
});

test('decisions: a protected digest older than every window is keep:protected, and so are its children', () => {
  const old = tagVersions()[5];
  const protect = [{ package: PKG, digest: indexDigestOf(old.version), note: 'sandbox pin' }];
  const cfg = loadConfig(yamlOf({ ...baseConfig(), protect }));
  const protectedSet = protectedDigests(cfg);
  const rows = decide({ config: cfg, packages: sliceCollected(), protectedSet, now: NOW });
  assert.equal(rowOf(rows, old.version).decision, 'keep:protected');
  assert.equal(rowOf(rows, old.version).digest, indexDigestOf(old.version), 'the row does not carry the digest a reviewer greps for');
  for (const child of SLICE.manifests[old.version].body.manifests.map((m) => m.digest)) {
    assert.equal(rowOf(rows, child).decision, 'keep:referenced', 'a protected image lost a child');
  }
  // Under EVERY rule, no protected digest is in the delete list.
  for (const keepNewest of [1, 2, 6]) {
    for (const keepDays of [1, 30, 365]) {
      const c = loadConfig(yamlOf({ ...baseConfig(), protect, packages: [{ name: PKG, type: 'container', keepNewest, keepDays }] }));
      const r = decide({ config: c, packages: sliceCollected(), protectedSet: protectedDigests(c), now: NOW });
      assert.notEqual(rowOf(r, old.version).decision, 'delete', `deleted under ${keepNewest}/${keepDays}`);
    }
  }
});

test('decisions: unreferenced children outside the window are deleted; inside it they are kept', () => {
  const cfg = loadConfig(yamlOf(baseConfig()));
  const rows = decide({ config: cfg, packages: sliceCollected(), protectedSet: new Map(), now: NOW });
  const referencedByAny = new Set(Object.values(SLICE.manifests).flatMap((m) => m.body.manifests.map((c) => c.digest)));
  const orphans = SLICE.versions.filter((v) => v.version.startsWith('sha256:') && !referencedByAny.has(v.version));
  assert.equal(orphans.length, 2);
  for (const o of orphans) assert.equal(rowOf(rows, o.version).decision, 'delete');
  const late = decide({ config: cfg, packages: sliceCollected(), protectedSet: new Map(), now: Date.parse('2026-07-02T00:00:00Z') });
  assert.equal(rowOf(late, orphans[1].version).decision, 'keep:recent', 'a fresh orphan may be a push in progress');
});

test('decisions: keepAll keeps everything, and an unlisted package is reported, never deleted', () => {
  const cfg = loadConfig(yamlOf({ ...baseConfig(), packages: [{ name: 'release-bundle', type: 'generic', keepAll: true }] }));
  const packages = {
    'release-bundle': { type: 'generic', versions: [{ id: 1, version: '1.0.0-aaaaaaa', created_at: '2026-01-01T00:00:00Z', size: 9 }] },
    // Another repository's image under the same owner: not in this config, so never ours to delete.
    [PKG]: sliceCollected()[PKG],
  };
  const rows = decide({ config: cfg, packages, protectedSet: new Map(), now: NOW });
  assert.equal(rows.find((r) => r.package === 'release-bundle').decision, 'keep:all');
  const unlisted = rows.filter((x) => x.package === PKG);
  assert.equal(unlisted.length, SLICE.versions.length, 'an unlisted package must still be REPORTED, row by row');
  for (const r of unlisted) assert.equal(r.decision, 'keep:unconfigured');
});

test('decisions: when a kept index cannot be read, no child of that package is deleted', () => {
  const cfg = loadConfig(yamlOf(baseConfig()));
  const packages = sliceCollected();
  const newest = packages[PKG].versions.find((v) => v.version === tagVersions()[0].version);
  newest.children = null; // the registry answered 404/500 for its index
  const rows = decide({ config: cfg, packages, protectedSet: new Map(), now: NOW });
  const children = rows.filter((r) => r.version.startsWith('sha256:'));
  assert.ok(children.length > 0);
  assert.ok(children.every((r) => r.decision !== 'delete'), 'a child was deleted while an index it may belong to was unread');
  assert.ok(children.some((r) => r.decision === 'keep:unverified'));
});

test('decisions: the evidence package inside its window is kept', () => {
  const floor = DEFAULT_DURATION_RUNS * countBundleJobs();
  const cfg = loadConfig(yamlOf({ ...baseConfig(), packages: [{ name: 'belay-ci-failures', type: 'generic', keepDays: 45, keepNewest: floor }] }));
  const versions = Array.from({ length: floor + 3 }, (_, i) => ({
    id: i, version: `${9000 - i}--guardrails`, created_at: new Date(NOW - i * 3600_000).toISOString(), size: 1,
  }));
  versions.push({ id: 99999, version: '1--guardrails', created_at: new Date(NOW - 50 * 86400_000).toISOString(), size: 1 });
  const rows = decide({ config: cfg, packages: { 'belay-ci-failures': { type: 'generic', versions } }, protectedSet: new Map(), now: NOW });
  assert.ok(rows.filter((r) => r.version !== '1--guardrails').every((r) => r.decision.startsWith('keep:')));
  assert.equal(rowOf(rows, '1--guardrails').decision, 'delete');
});

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

const FORGE = 'http://forge.example.invalid';

/** A fake forge serving the slice, recording every call. */
function fakeForge({ slice = SLICE } = {}) {
  const calls = [];
  const versions = slice.versions;
  const fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const method = opts.method ?? 'GET';
    calls.push({ method, path: u.pathname + u.search });
    const json = (o, headers = {}) => ({
      ok: true, status: 200, headers: new Map(Object.entries({ 'x-total-count': String(versions.length), ...headers })),
      json: async () => o, text: async () => JSON.stringify(o),
    });
    if (method === 'DELETE') return { ok: true, status: 204, headers: new Map(), text: async () => '' };
    if (u.pathname === '/api/v1/packages/o') {
      const page = Number(u.searchParams.get('page'));
      const limit = Number(u.searchParams.get('limit'));
      return json(versions.slice((page - 1) * limit, page * limit));
    }
    const files = u.pathname.match(/^\/api\/v1\/packages\/o\/(\w+)\/([^/]+)\/(.+)\/files$/);
    if (files) return json(slice.files[decodeURIComponent(files[3])] ?? []);
    const man = u.pathname.match(/^\/v2\/o\/([^/]+)\/manifests\/(.+)$/);
    if (man) {
      const m = slice.manifests[decodeURIComponent(man[2])];
      if (!m) return { ok: false, status: 404, headers: new Map(), json: async () => ({}), text: async () => '' };
      return json(m.body, { 'content-type': m.contentType });
    }
    throw new Error(`unexpected ${method} ${u.pathname}`);
  };
  return { fetch, calls, deletes: () => calls.filter((c) => c.method === 'DELETE') };
}

function writeConfig(o) {
  const dir = mkdtempSync(join(tmpdir(), 'retention-cfg-'));
  const p = join(dir, 'retention.yaml');
  writeFileSync(p, yamlOf(o));
  return p;
}

async function runCli(args, {
  config = baseConfig(), forge = fakeForge(), env = {}, origin = () => { throw new Error('no origin remote'); },
} = {}) {
  const out = [];
  const err = [];
  const code = await main(args, {
    env: { GITHUB_SERVER_URL: FORGE, REGISTRY_CLEANUP_TOKEN: 't', ...env },
    fetch: forge.fetch,
    configPath: writeConfig(config),
    readOrigin: origin,
    now: NOW,
    log: (l) => out.push(String(l)),
    logError: (l) => err.push(String(l)),
  });
  return { code, out: out.join('\n'), err: err.join('\n'), forge };
}

test('CLI: no arguments reports, and makes ZERO delete calls', async () => {
  const r = await runCli([]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.forge.deletes().length, 0);
  assert.match(r.out, /belay-devcontainer\s+d7469efc\w*\s+2026-06-28\s+delete/);
  assert.match(r.out, /would free/);
  assert.match(r.out, /nothing was deleted/);
});

test('CLI: --apply with mode: report exits 2 naming the mismatch, with zero calls', async () => {
  const r = await runCli(['--apply']);
  assert.equal(r.code, 2);
  assert.match(r.err, /mode: report/);
  assert.equal(r.forge.deletes().length, 0);
  assert.equal(r.forge.calls.length, 0, 'the refusal reached the forge');
});

test('CLI: --apply with mode: apply deletes only the delete rows, indexes before children', async () => {
  const r = await runCli(['--apply', '--json'], { config: { ...baseConfig(), mode: 'apply' } });
  assert.equal(r.code, 0, r.err);
  const report = JSON.parse(r.out);
  const deleted = r.forge.deletes().map((c) => decodeURIComponent(c.path.split('/').pop()));
  const expected = report.rows.filter((x) => x.decision === 'delete').map((x) => x.version);
  assert.ok(expected.length >= 4);
  assert.deepEqual([...deleted].sort(), [...expected].sort());
  const firstChild = deleted.findIndex((v) => v.startsWith('sha256:'));
  assert.ok(deleted.slice(firstChild).every((v) => v.startsWith('sha256:')));
});

test('CLI: a protected digest that is not in the registry exits 5, names it, and deletes nothing', async () => {
  const config = { ...baseConfig(), mode: 'apply', protect: [{ package: PKG, digest: digestOf(42), note: 'sandbox pin' }] };
  const r = await runCli(['--apply'], { config });
  assert.equal(r.code, 5);
  assert.match(r.err, new RegExp(digestOf(42)));
  assert.match(r.err, /sandbox pin/);
  assert.equal(r.forge.deletes().length, 0);
});

test('CLI: a protected digest that IS in the registry is kept, and an apply run never deletes it', async () => {
  const old = tagVersions()[5];
  const config = { ...baseConfig(), mode: 'apply', protect: [{ package: PKG, digest: indexDigestOf(old.version), note: 'sandbox pin' }] };
  const r = await runCli(['--apply', '--json'], { config });
  assert.equal(r.code, 0, r.err);
  assert.equal(rowOf(JSON.parse(r.out).rows, old.version).decision, 'keep:protected');
  const deleted = r.forge.deletes().map((c) => decodeURIComponent(c.path.split('/').pop()));
  assert.ok(!deleted.includes(old.version), 'the protected tag was deleted');
  for (const child of SLICE.manifests[old.version].body.manifests.map((m) => m.digest)) {
    assert.ok(!deleted.includes(child), 'a child of the protected tag was deleted');
  }
});

test('CLI: --dry-run and --package without a value are rejected with exit 2, before any call', async () => {
  for (const args of [['--dry-run'], ['--package'], ['--package', '--json'], ['--aply']]) {
    const r = await runCli(args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`);
    assert.equal(r.forge.calls.length, 0, `${args.join(' ')} reached the forge`);
  }
});

test('CLI: --help prints usage and exits 0 without a single call', async () => {
  const r = await runCli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /registry-retention\.mjs/);
  assert.equal(r.forge.calls.length, 0);
});

test('CLI: --json is valid JSON with per-package totals; --package narrows it', async () => {
  const r = await runCli(['--json', '--package', PKG]);
  assert.equal(r.code, 0, r.err);
  const report = JSON.parse(r.out);
  const t = report.packages[PKG];
  assert.equal(t.total, SLICE.versions.length);
  assert.equal(t.keep + t.delete, t.total);
  assert.ok(t.bytesFreed > 0);
  assert.equal(report.mode, 'report');
});

test('CLI: an invalid config exits 2 naming the key, before any call', async () => {
  const r = await runCli([], { config: { ...baseConfig(), keepForever: true } });
  assert.equal(r.code, 2);
  assert.match(r.err, /keepForever/);
  assert.equal(r.forge.calls.length, 0);
});

test('CLI: the forge base comes from the runner, else the origin remote — never a default host', async () => {
  // No runner URL: the origin remote supplies scheme and host, as every BELAY forge script does.
  const viaOrigin = await runCli([], { env: { GITHUB_SERVER_URL: '' }, origin: () => `${FORGE}/o/belay.git` });
  assert.equal(viaOrigin.code, 0, viaOrigin.err);
  assert.ok(viaOrigin.forge.calls.length > 0);
  // Neither: a usage error, and nothing is called.
  const none = await runCli([], { env: { GITHUB_SERVER_URL: '' } });
  assert.equal(none.code, 2);
  assert.match(none.err, /GITHUB_SERVER_URL|origin/);
  assert.equal(none.forge.calls.length, 0);
});

test('CLI: no token is a usage error naming both credentials; the read-only FORGE_TOKEN serves a report', async () => {
  const none = await runCli([], { env: { REGISTRY_CLEANUP_TOKEN: '', FORGE_TOKEN: '' } });
  assert.equal(none.code, 2);
  assert.match(none.err, /REGISTRY_CLEANUP_TOKEN/);
  assert.match(none.err, /FORGE_TOKEN/);
  assert.equal(none.forge.calls.length, 0);
  const readOnly = await runCli([], { env: { REGISTRY_CLEANUP_TOKEN: '', FORGE_TOKEN: 'r' } });
  assert.equal(readOnly.code, 0, readOnly.err);
});

// ── workflow ──────────────────────────────────────────────────────────────────────────────────

const workflow = () => parseYaml(readFileSync(join(WORKFLOWS, 'registry-retention.yml'), 'utf8'));
const workflowSteps = () => Object.values(workflow().jobs).flatMap((j) => j.steps);
const guardrailSteps = () => parseYaml(readFileSync(join(WORKFLOWS, 'guardrails.yml'), 'utf8')).jobs.guardrails.steps;

test('workflow: the schedule can never pass --apply; only an apply dispatch does, through env', () => {
  const wf = workflow();
  assert.ok(wf.on.schedule, 'no weekly schedule');
  assert.equal(wf.on.workflow_dispatch?.inputs?.apply?.type, 'boolean');
  assert.equal(wf.on.workflow_dispatch.inputs.apply.default, false);
  assert.ok(!wf.on.pull_request && !wf.on.push, 'retention runs on its schedule and on dispatch only');
  const run = workflowSteps().find((s) => /registry-retention\.mjs/.test(s.run ?? ''));
  assert.ok(run, 'the workflow does not run the script');
  // --apply appears ONLY behind a dispatch with apply == true, carried through env (an expression
  // interpolated into `run:` is a shell-injection finding) and passed on by that variable alone.
  const applies = [...JSON.stringify(workflow()).matchAll(/--apply/g)];
  assert.equal(applies.length, 1, 'more than one --apply in the workflow');
  assert.doesNotMatch(run.run, /\$\{\{/, 'an expression is interpolated into run:');
  assert.match(run.env?.RETENTION_ARGS ?? '', /^\$\{\{ \(github\.event_name == 'workflow_dispatch' && inputs\.apply == true\) && '--apply' \|\| '' \}\}$/);
  assert.match(run.run, /registry-retention\.mjs \$\{RETENTION_ARGS:\+"\$RETENTION_ARGS"\}/);
  assert.match(JSON.stringify(run.env ?? {}), /secrets\.REGISTRY_CLEANUP_TOKEN/);
});

test('workflow: runs on belay, with Node pinned exactly as guardrails pins it, before any Node use', () => {
  const [job] = Object.values(workflow().jobs);
  assert.equal(job['runs-on'], 'belay');
  const steps = workflowSteps();
  const g = guardrailSteps();
  const pinOf = (list, action) => list.find((s) => (s.uses ?? '').startsWith(`${action}@`));
  for (const action of ['actions/checkout', 'actions/setup-node']) {
    assert.equal(pinOf(steps, action)?.uses, pinOf(g, action).uses, `${action} is not pinned as guardrails pins it`);
  }
  assert.equal(pinOf(steps, 'actions/setup-node').with?.['node-version'], pinOf(g, 'actions/setup-node').with['node-version']);
  // History is not read: the protected set is in the committed config.
  assert.equal(pinOf(steps, 'actions/checkout').with?.['fetch-depth'], undefined);
  const setupAt = steps.findIndex((s) => (s.uses ?? '').startsWith('actions/setup-node@'));
  const firstNode = steps.findIndex((s) => /\b(node|pnpm)\b/.test(s.run ?? ''));
  assert.ok(setupAt >= 0 && setupAt < firstNode, 'a step uses Node or pnpm before setup-node pins it');
});

test('workflow: the report reaches the log and the job summary, and the last step is the failure digest', () => {
  const steps = workflowSteps();
  const reportAt = steps.findIndex((s) => /registry-retention\.mjs/.test(s.run ?? ''));
  assert.match(steps[reportAt].run, /tee registry-retention-report\.txt/);
  const summary = steps.find((s) => /GITHUB_STEP_SUMMARY/.test(s.run ?? ''));
  assert.ok(summary && summary.if === 'always()', 'the job summary is not written on every outcome');
  const digest = steps.at(-1);
  const gDigest = guardrailSteps().at(-1);
  assert.equal(digest.run, gDigest.run);
  assert.equal(digest.if, 'always()');
  assert.equal(digest['continue-on-error'], true);
  assert.deepEqual(digest.env, gDigest.env);
});
