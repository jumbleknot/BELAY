// Unit tests for the tasks-to-issues fan-out (scripts/taskstoissues.mjs).
//
// Offline and token-free: every case drives an exported function with an injected `backlog` double
// that records the commands it was asked to run and answers like scripts/backlog.mjs would. No forge
// call, no child process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTasks, run, main } from '../taskstoissues.mjs';

const SLUG = '042-sample';

const TASKS = `# Tasks

- [X] T001 **Doc-impact sweep** (REQUIRED).
  - **Command:** grep.
- [ ] T002 [P] [US1] Port \`scripts/a.mjs\`.
- [ ] Untracked line without an id.
- [ ] T0003 [US2] Four-digit id from converge.
`;

/** A backlog double: `existing` is the list of rows already in the milestone. */
function fakeBacklog({ existing = [], fail = {}, milestoneExists = true } = {}) {
  const calls = [];
  let next = 100;
  const backlog = (args, input) => {
    calls.push({ args, input });
    const [cmd] = args;
    if (fail[cmd]) return { code: fail[cmd], out: `${cmd} failed` };
    if (cmd === 'setup-milestone') return { code: 0, out: `milestone ${args[1]} ready` };
    if (cmd === 'list') {
      if (!milestoneExists) return { code: 2, out: `unknown milestone "${SLUG}"` };
      const page = Number(args[args.indexOf('--page') + 1]);
      const rows = existing.slice((page - 1) * 50, page * 50);
      return { code: 0, out: `${JSON.stringify(rows)}\n` };
    }
    if (cmd === 'create') return { code: 0, out: `created item #${next++}\n` };
    if (cmd === 'dep') return { code: 0, out: 'dependency added' };
    return { code: 1, out: `unexpected ${cmd}` };
  };
  return { backlog, calls, cmds: () => calls.map((c) => c.args[0]) };
}

const quiet = () => {};

test('(parse) reads ids of three or more digits, done state and the indented block', () => {
  const { tasks, skippedNoId } = parseTasks(TASKS);
  assert.deepEqual(tasks.map((t) => t.id), ['T001', 'T002', 'T0003']);
  assert.deepEqual(tasks.map((t) => t.done), [true, false, false]);
  assert.equal(skippedNoId, 1);
  assert.match(tasks[0].block, /\*\*Command:\*\* grep\./);
});

test('(parse) strips [P], [US#] and bold from the title', () => {
  const { tasks } = parseTasks(TASKS);
  assert.equal(tasks[0].title, 'T001: Doc-impact sweep (REQUIRED).');
  assert.equal(tasks[1].title, 'T002: Port `scripts/a.mjs`.');
  assert.equal(tasks[2].title, 'T0003: Four-digit id from converge.');
});

test('(parse) truncates a long description on a word boundary with an ellipsis', () => {
  const long = `- [ ] T009 ${'word '.repeat(40)}`;
  const [t] = parseTasks(long).tasks;
  assert.ok(t.title.length <= 'T009: '.length + 110, t.title);
  assert.ok(t.title.endsWith('…'));
  assert.doesNotMatch(t.title, /wor…$/);
});

test('(fresh) sets up the milestone, creates one item per task and chains them', async () => {
  const f = fakeBacklog();
  const s = await run({ slug: SLUG, tasksText: TASKS, backlog: f.backlog, log: quiet });
  assert.equal(f.cmds()[0], 'setup-milestone');
  assert.deepEqual(s, { tasks: 3, created: 3, alreadyFiled: 0, skippedNoId: 1, deps: 2 });
  const creates = f.calls.filter((c) => c.args[0] === 'create');
  assert.deepEqual(creates[0].args, [
    'create', '--title', 'T001: Doc-impact sweep (REQUIRED).', '--body-file', '-',
    '--label', 'type/chore', '--label', 'priority/p2', '--milestone', SLUG,
  ]);
  assert.match(creates[0].input, /Mirrors \*\*T001\*\*/);
  assert.match(creates[0].input, /\*\*done\*\*/);
  const deps = f.calls.filter((c) => c.args[0] === 'dep').map((c) => c.args);
  assert.deepEqual(deps, [['dep', '101', '--blocked-by', '100'], ['dep', '102', '--blocked-by', '101']]);
});

test('(rerun) creates nothing and adds no dependency when every task has an item', async () => {
  const existing = [
    { number: 5, title: 'T001: a' }, { number: 6, title: 'T002: b' }, { number: 7, title: 'T0003: c' },
  ];
  const f = fakeBacklog({ existing });
  const s = await run({ slug: SLUG, tasksText: TASKS, backlog: f.backlog, log: quiet });
  assert.equal(s.created, 0);
  assert.equal(s.deps, 0);
  assert.deepEqual(f.cmds().filter((c) => c === 'create' || c === 'dep'), []);
});

test('(partial) a new task is chained to the existing item before it', async () => {
  const f = fakeBacklog({ existing: [{ number: 5, title: 'T001: a' }] });
  await run({ slug: SLUG, tasksText: TASKS, backlog: f.backlog, log: quiet });
  const deps = f.calls.filter((c) => c.args[0] === 'dep').map((c) => c.args);
  assert.deepEqual(deps, [['dep', '100', '--blocked-by', '5'], ['dep', '101', '--blocked-by', '100']]);
});

test('(paging) reads past a full page of 50 before deciding a task is unfiled', async () => {
  const filler = Array.from({ length: 50 }, (_, i) => ({ number: 200 + i, title: `T${900 + i}: x` }));
  const f = fakeBacklog({ existing: [...filler, { number: 7, title: 'T0003: c' }] });
  const s = await run({ slug: SLUG, tasksText: TASKS, backlog: f.backlog, log: quiet });
  const pages = f.calls.filter((c) => c.args[0] === 'list').map((c) => c.args[c.args.indexOf('--page') + 1]);
  assert.deepEqual(pages, ['1', '2']);
  assert.equal(s.created, 2);
});

test('(dry-run) issues no write at all, even for a milestone that does not exist yet', async () => {
  const f = fakeBacklog({ milestoneExists: false });
  const s = await run({ slug: SLUG, tasksText: TASKS, backlog: f.backlog, dryRun: true, log: quiet });
  assert.deepEqual(f.cmds().filter((c) => c !== 'list'), []);
  assert.equal(s.created, 3);
});

test('(failure) a failed create stops the run with that exit code and no later writes', async () => {
  const f = fakeBacklog({ fail: { create: 4 } });
  await assert.rejects(
    run({ slug: SLUG, tasksText: TASKS, backlog: f.backlog, log: quiet }),
    (e) => e.code === 4 && /create T001/.test(e.message),
  );
  assert.equal(f.cmds().filter((c) => c === 'create').length, 1);
  assert.equal(f.cmds().includes('dep'), false);
});

test('(main) usage errors exit 2 before any backlog command runs', async () => {
  const f = fakeBacklog();
  assert.equal(await main([], { backlog: f.backlog, log: quiet }), 2);
  assert.equal(await main(['not a slug'], { backlog: f.backlog, log: quiet }), 2);
  assert.equal(await main([SLUG, '--tasks', join(tmpdir(), 'no-such-tasks.md')], { backlog: f.backlog, log: quiet }), 2);
  assert.deepEqual(f.calls, []);
});

test('(main) reads --tasks and exits 0 on success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tti-'));
  try {
    const p = join(dir, 'tasks.md');
    writeFileSync(p, TASKS);
    const f = fakeBacklog();
    assert.equal(await main([SLUG, '--tasks', p], { backlog: f.backlog, log: quiet }), 0);
    assert.equal(f.cmds().filter((c) => c === 'create').length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
