#!/usr/bin/env node
// gen-egress-policy.mjs — feature 004 (dev container on Docker Sandbox)
//
// One canonical destination list, and every enforcement form DERIVED from it, never maintained by
// hand in parallel. Emits the forms of .devcontainer/egress-allowlist.json:
//
//   --format sbx-policy     one `allow network <domain>` line per destination: the host-side
//                           Docker Sandbox network policy, applied with `sbx policy allow network`
//   --format ipset-domains  newline-separated domains (kept for parity with the upstream tool; no
//                           BELAY consumer uses it)
//   --check                 validate the list; exit 1 naming each offending entry
//
// Optional everywhere:
//   --forge-host <host>     append the forge registry host. It is topology, so it is NEVER stored in
//                           the list: it is injected at run time. Absent => omitted cleanly, exit 0.
//   --file <path>           read a different list (tests)
//
// This tool NEVER writes files. Each form is piped by its consumer, so there is no generated
// artefact that can fall stale in git and disagree with its source.
//
// Contract: specs/004-devcontainer-sandbox/contracts/cli.md. Rules: data-model.md, Egress
// allowlist. Exit codes: 0 ok · 1 validation failure · 2 usage error.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LIST = resolve(REPO_ROOT, '.devcontainer/egress-allowlist.json');

const VALID_GROUPS = ['agent', 'source', 'registry', 'packages', 'app'];

// Emission order: group (in the order above), then domain alphabetically. Deterministic, so a
// regenerated form produces an empty diff, and related entries stay together in `sbx policy ls`.
const groupRank = (g) => {
  const i = VALID_GROUPS.indexOf(g);
  return i === -1 ? VALID_GROUPS.length : i;
};

// A lowercase FQDN, optionally with ONE leading `*.` wildcard label. This single shape rejects a
// bare IP, a host:port, a URL, uppercase and whitespace in one place.
const FQDN = /^(\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// Private-network and overlay suffixes. A destination under one of these is by definition not a
// public egress target, so its presence means internal topology was pasted into the file.
const TOPOLOGY_SUFFIXES = ['.ts.net', '.internal', '.local', '.lan', '.home', '.home.arpa', '.intranet'];

function usage(msg) {
  if (msg) process.stderr.write(`gen-egress-policy: ${msg}\n`);
  process.stderr.write(
    [
      'Usage:',
      '  node scripts/gen-egress-policy.mjs --format sbx-policy    [--forge-host <host>] [--file <path>]',
      '  node scripts/gen-egress-policy.mjs --format ipset-domains [--forge-host <host>] [--file <path>]',
      '  node scripts/gen-egress-policy.mjs --check                [--file <path>]',
      '',
      'Apply to a sandbox (each line):  sbx policy allow network <domain> --sandbox belay',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

function parseArgs(argv) {
  const out = { format: null, forgeHost: null, check: false, file: DEFAULT_LIST };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--format') out.format = argv[++i] ?? usage('--format needs a value');
    else if (a === '--forge-host') out.forgeHost = argv[++i] ?? usage('--forge-host needs a value');
    else if (a === '--file') out.file = resolve(argv[++i] ?? usage('--file needs a value'));
    else if (a === '--help' || a === '-h') usage();
    else usage(`unknown argument: ${a}`);
  }
  if (!out.check && !out.format) usage('one of --check or --format is required');
  if (out.check && out.format) usage('--check and --format are mutually exclusive');
  if (out.format && !['sbx-policy', 'ipset-domains'].includes(out.format)) usage(`unknown --format: ${out.format}`);
  if (out.forgeHost !== null) {
    const h = out.forgeHost.trim();
    // A bare host only. A quoted value, a scheme or a port would become a policy rule that matches
    // nothing, and the forge would then be silently unreachable.
    if (h !== '' && !(FQDN.test(h) || IPV4.test(h))) {
      usage(`--forge-host must be a bare host name or IPv4 address (no quotes, scheme or port), got ${JSON.stringify(out.forgeHost)}`);
    }
    out.forgeHost = h;
  }
  return out;
}

function loadList(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    process.stderr.write(`gen-egress-policy: cannot read ${file}\n`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`gen-egress-policy: ${file} is not valid JSON — ${e.message}\n`);
    process.exit(1);
  }
}

function validate(list) {
  const problems = [];
  const push = (i, domain, msg) => problems.push(`entry ${i}${domain ? ` (${domain})` : ''}: ${msg}`);

  if (!list || typeof list !== 'object' || !Array.isArray(list.destinations)) {
    problems.push('top level: "destinations" must be an array');
    return problems;
  }
  if (list.destinations.length === 0) problems.push('top level: "destinations" is empty');

  const seen = new Map();
  list.destinations.forEach((d, i) => {
    if (!d || typeof d !== 'object') return push(i, null, 'not an object');
    const { domain, group, reason, cdnRotating } = d;

    if (typeof domain !== 'string' || domain.trim() === '') {
      push(i, null, 'missing or empty "domain"');
    } else {
      const dom = domain.trim();
      const lower = dom.toLowerCase();
      if (IPV4.test(dom) || /^[0-9a-f:]+:[0-9a-f:]*$/i.test(dom)) {
        push(i, dom, 'is a bare IP: destinations must be FQDNs (CDN-backed hosts rotate)');
      } else if (!FQDN.test(lower)) {
        push(i, dom, 'is not a bare FQDN (no scheme, port, path or whitespace; at most one leading "*.")');
      }
      for (const suffix of TOPOLOGY_SUFFIXES) {
        if (lower.endsWith(suffix)) {
          push(i, dom, `ends with "${suffix}": topology-sensitive, must never enter git`);
          break;
        }
      }
      const forgeEnv = (process.env.FORGE_REGISTRY_HOST || '').trim().toLowerCase();
      if (forgeEnv && lower === forgeEnv) {
        push(i, dom, 'is the forge registry host: inject it at run time with --forge-host, never store it');
      }
      if (seen.has(lower)) push(i, dom, `duplicate of entry ${seen.get(lower)}`);
      else seen.set(lower, i);
    }

    if (typeof group !== 'string' || !VALID_GROUPS.includes(group)) {
      push(i, domain, `group "${group}" is not one of: ${VALID_GROUPS.join(' | ')}`);
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      push(i, domain, 'has an empty "reason": an unexplained allowlist entry is an unreviewable one');
    }
    if (cdnRotating !== undefined && typeof cdnRotating !== 'boolean') {
      push(i, domain, '"cdnRotating" must be a boolean when present');
    }
  });

  return problems;
}

function orderedDomains(list) {
  return [...list.destinations]
    .sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.domain.localeCompare(b.domain))
    .map((d) => d.domain);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const list = loadList(args.file);
  const problems = validate(list);

  if (args.check) {
    if (problems.length > 0) {
      process.stderr.write(`gen-egress-policy: ${args.file} failed validation\n`);
      for (const p of problems) process.stderr.write(`  - ${p}\n`);
      process.exit(1);
    }
    process.stdout.write(`gen-egress-policy: ${list.destinations.length} destinations valid\n`);
    return;
  }

  // Emitting always validates first: piping a malformed list straight into an enforcement layer is
  // how a bad entry becomes a live policy rule nobody reviewed.
  if (problems.length > 0) {
    process.stderr.write(`gen-egress-policy: refusing to emit — ${args.file} failed validation\n`);
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    process.exit(1);
  }

  const domains = orderedDomains(list);
  // Appended LAST rather than sorted in, so its presence or absence never reorders the rest.
  if (args.forgeHost) domains.push(args.forgeHost);

  const out = args.format === 'sbx-policy' ? domains.map((d) => `allow network ${d}`) : domains;
  process.stdout.write(out.join('\n') + '\n');
}

main();
