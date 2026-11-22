---
type: Convention
title: RTK (Rust Token Killer) token compression
description: RTK is a mandatory transparent CLI proxy that compresses command output before it reaches the agent's context; it must be active before any AI-assisted session, is verified with rtk gain, and can rewrite or hide a tool's answer, so a surprising result is re-run without it.
tags: [rtk, tooling, context-window, prerequisite]
timestamp: 2026-11-22
---

# RTK (Rust Token Killer) token compression

The constitution (**Token Compression**) requires RTK to be installed and active in every shell used
for AI-assisted development. RTK sits in front of commands such as test runs, builds and git diffs,
and compresses their output before it reaches the assistant, so the context window is left for
reasoning.

```bash
rtk init --global   # activate it
rtk gain            # confirm compression is happening, after the first test run
rtk --version       # which version is in use
```

In Claude Code a hook rewrites commands through RTK transparently, so `git status` runs as
`rtk git status`.

## Gotchas

- **A session must not begin without RTK active.** That is a hard prerequisite.
- **`rtk gain` is the check, not a one-time install step.** Installed-but-inactive looks exactly like
  not-installed until you run it. It is the last item on the
  [validation checklist](./feature-validation-checklist.md), because it measures the commands that
  ran before it.
- **RTK can rewrite a tool's answer into its opposite.** MovieCollectionManager measured it on
  2026-11-08: `npx prettier --file-info <file>` returned `{ "ignored": true }`, and RTK printed
  `Prettier: All files formatted correctly`, which is a different command's success line. When a
  result is surprising, or when the command is a *query* rather than a check (`--file-info`,
  `check-ignore`, `--find-config-path`), re-run it with `rtk proxy <cmd>` before concluding anything.
- **RTK compresses summaries, so never monitor by grepping output.** Test output can be reduced to a
  `PASS (n) FAIL (n)` line, and a script that greps for a phrase like "n passed" will miscount. Judge
  by exit code or a structured status.
- **A negative `grep` result can be a binary-file notice that RTK dropped.** GNU grep treats a file
  containing a NUL byte as binary. It prints no matching lines, sends `binary file matches` to stderr
  and exits 0. RTK drops that notice, so the result looks exactly like "no matches". Cross-check with
  `grep -c`, which still reports the true count. Write a NUL sentinel in a text file as the `\u0000`
  escape, never as a raw byte.
- **For anything whose exact output matters, write it to a file and read the file.** Ad-hoc
  `node -e` or `python -c` output can be rewritten on its way through the proxy.

See [instrument traps](../gotchas/instrument-traps.md) for the wider class of tools that answer a
different question from the one you asked.
