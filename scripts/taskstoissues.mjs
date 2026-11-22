// The tasks-to-issues fan-out behind /speckit-taskstoissues: mirrors a feature's tasks.md into its
// Forgejo milestone, one item per task, deduplicated by task id and chained in task order.
//
// Every forge call goes through scripts/backlog.mjs, so its origin-repo write guard, credential
// selection and exit codes apply unchanged. tasks.md stays authoritative; the items are a mirror.
// Runbook: docs/runbooks/backlog.md ("Tasks to issues").
//
// Usage: node scripts/taskstoissues.mjs <NNN-slug> [--tasks <path>] [--dry-run]
//   --tasks     defaults to specs/<NNN-slug>/tasks.md
//   --dry-run   lists what would be created; issues no write, not even setup-milestone
//
// Exit codes: 0 ok, 2 usage, otherwise the failing backlog.mjs command's own exit code.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 50;
const TITLE_MAX = 110;
const LABELS = ['type/chore', 'priority/p2'];
const SLUG_RE = /^\d{3,}(?:-\d{6})?-[a-z0-9][a-z0-9-]*$/;
const TASK_ID_RE = /\bT\d{3,}\b/g;

export class FanOutError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Tasks in file order: `- [ ] T001 …` lines plus their indented continuation lines. */
export function parseTasks(text) {
  const lines = text.split(/\r?\n/);
  const tasks = [];
  let skippedNoId = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \[( |x|X)\] (.*)$/);
    if (!m) continue;
    const id = (m[2].match(/^(T\d{3,})\b/) ?? [])[1];
    if (!id) {
      skippedNoId++;
      continue;
    }
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length && /^\s{2,}\S/.test(lines[j]); j++) block.push(lines[j]);
    const desc = m[2]
      .slice(id.length)
      .replace(/\[P\]|\[US\d+\]/g, '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const short = desc.length > TITLE_MAX ? `${desc.slice(0, TITLE_MAX - 3).replace(/\s+\S*$/, '')}…` : desc;
    tasks.push({ id, done: m[1] !== ' ', title: `${id}: ${short}`, block: block.join('\n') });
  }
  return { tasks, skippedNoId };
}

function itemBody(task, slug) {
  return [
    `Mirrors **${task.id}** of [specs/${slug}/tasks.md](../src/branch/main/specs/${slug}/tasks.md). ` +
      '`tasks.md` is authoritative; this item is a mirror for coordination.',
    '',
    `Status in tasks.md when filed: **${task.done ? 'done' : 'open'}**.`,
    '',
    '```markdown',
    task.block,
    '```',
    '',
  ].join('\n');
}

/**
 * Runs the fan-out. `backlog(args, stdin)` runs one backlog.mjs command and returns { code, out }.
 * Returns the summary counts; throws FanOutError carrying the failing command's exit code.
 */
export async function run({ slug, tasksText, backlog, dryRun = false, log = console.log }) {
  const must = (label, args, input) => {
    const r = backlog(args, input);
    if (r.code !== 0) throw new FanOutError(`${label} exited ${r.code}:\n${r.out}`, r.code);
    return r.out;
  };
  const { tasks, skippedNoId } = parseTasks(tasksText);

  if (!dryRun) log(must('setup-milestone', ['setup-milestone', slug]).trim());

  // Every task id already in a title, in either state, across every page.
  const existing = new Map();
  for (let page = 1; ; page++) {
    const args = ['list', '--state', 'all', '--milestone', slug, '--limit', String(PAGE), '--page', String(page), '--json'];
    const r = backlog(args);
    if (dryRun && r.code === 2 && /milestone/i.test(r.out)) break; // not created yet: nothing filed
    if (r.code !== 0) throw new FanOutError(`list exited ${r.code}:\n${r.out}`, r.code);
    const rows = JSON.parse(r.out.slice(r.out.indexOf('[')));
    for (const row of rows) for (const id of row.title.match(TASK_ID_RE) ?? []) if (!existing.has(id)) existing.set(id, row.number);
    if (rows.length < PAGE) break;
  }

  const created = new Set();
  for (const t of tasks) {
    if (existing.has(t.id)) {
      log(`${t.id} already has an item (#${existing.get(t.id)}), skipping`);
      continue;
    }
    if (dryRun) {
      log(`would create: ${t.title}`);
      created.add(t.id);
      continue;
    }
    const args = ['create', '--title', t.title, '--body-file', '-'];
    for (const l of LABELS) args.push('--label', l);
    args.push('--milestone', slug);
    const out = must(`create ${t.id}`, args, itemBody(t, slug));
    const n = Number((out.match(/created item #(\d+)/) ?? [])[1]);
    if (!n) throw new FanOutError(`create ${t.id} printed no item number:\n${out}`, 1);
    log(`${t.id} → #${n}`);
    existing.set(t.id, n);
    created.add(t.id);
  }

  // Each newly created item is blocked by the task before it, so `ready` shows the next task.
  let deps = 0;
  for (let i = 1; i < tasks.length; i++) {
    if (!created.has(tasks[i].id)) continue;
    if (dryRun) {
      deps++;
      continue;
    }
    const cur = existing.get(tasks[i].id);
    const prev = existing.get(tasks[i - 1].id);
    must(`dep ${tasks[i].id}`, ['dep', String(cur), '--blocked-by', String(prev)]);
    deps++;
  }

  const summary = { tasks: tasks.length, created: created.size, alreadyFiled: tasks.length - created.size, skippedNoId, deps };
  log(
    `${dryRun ? 'DRY RUN ' : ''}tasks=${summary.tasks} ${dryRun ? 'would-create' : 'created'}=${summary.created} ` +
      `already-filed=${summary.alreadyFiled} no-id-skipped=${skippedNoId} deps=${deps}`,
  );
  return summary;
}

function spawnBacklog(args, input) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'backlog.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
  });
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

export async function main(argv, { backlog = spawnBacklog, log = console.log } = {}) {
  const usage = (msg) => {
    log(`${msg}\nUsage: node scripts/taskstoissues.mjs <NNN-slug> [--tasks <path>] [--dry-run]`);
    return 2;
  };
  let slug;
  let tasksPath;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--tasks') tasksPath = argv[++i];
    else if (a === '--help' || a === '-h') {
      usage("Mirror a feature's tasks.md into its Forgejo milestone.");
      return 0;
    }
    else if (!slug) slug = a;
    else return usage(`unexpected argument: ${a}`);
  }
  if (!slug) return usage('missing <NNN-slug>');
  if (!SLUG_RE.test(slug)) return usage(`not a feature slug (NNN-name): ${slug}`);
  if (tasksPath === undefined) tasksPath = join(ROOT, 'specs', slug, 'tasks.md');
  let tasksText;
  try {
    tasksText = readFileSync(tasksPath, 'utf8');
  } catch {
    return usage(`cannot read tasks file: ${tasksPath}`);
  }
  try {
    await run({ slug, tasksText, backlog, dryRun, log });
    return 0;
  } catch (e) {
    if (e instanceof FanOutError) {
      log(e.message);
      return e.code;
    }
    throw e;
  }
}

// process.exit() can abort on Windows (exit 127); set the code and let the loop drain instead.
function exitWith(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2000).unref();
}

if (process.argv[1] && process.argv[1].endsWith('taskstoissues.mjs')) {
  main(process.argv.slice(2))
    .then(exitWith)
    .catch((e) => {
      console.error(`Unexpected: ${e?.stack ?? e}`);
      exitWith(1);
    });
}
