---
type: Process
title: Test authoring conventions — the RED/GREEN task format and what a red test proves
description: The rule that every feature test task follows the Verify RED then Verify GREEN checkpoint format, how to get a genuine RED when the behaviour already exists, why watching a test fail proves it sensitive but not correct, and how to decide between fixing the code and fixing the spec.
tags: [testing, tdd, process]
timestamp: 2026-11-22
---

# Test authoring conventions

## The RED then GREEN checkpoint format

Every feature test task follows `docs/templates/feature-test-tasks-template.md`. It pairs each
test-writing task with an implementation task and requires two explicit checkpoints:

- **Verify RED**, run before implementing: the test must fail, with the expected failure named. If
  it shows 0 failures, the test passes trivially and must be fixed before implementation.
- **Verify GREEN**, run after implementing: the test must pass. Then re-run the touched suite as a
  regression check.

Documentation and config tasks are exempt from the RED/GREEN cycle. The template gives them a
separate "Done when" format. The constitution makes the format mandatory (**TDD Checkpoint
Format**). The project's tasks-template override carries a sample pair, and the Spec Kit gate fails
if an upgrade drops it (`tdd-format-missing`; see [Spec Kit](../runbooks/spec-kit.md)).

BELAY's tests are `node:test` files in `scripts/__tests__/`, named after the script they cover
(`backlog.mjs` and `backlog.test.mjs`). Fixtures go in `scripts/__tests__/fixtures/`.

## Gotchas

- **A passing test that was never RED is not a TDD test.** The template's "Expected RED: [N] test(s)
  failing" line exists to catch a test written to pass trivially.
- **When the behaviour already exists, use a mutation RED, not a compile error.** In a test-only
  change, a new assertion goes green on its first run because the code is already right. Apply a
  named source edit, watch the test fail, then revert the edit. Never "trust it works" without having
  watched it fail.
- **If a test goes green on the first run against unfixed code, suspect the test double first.**
  MovieCollectionManager measured a double that returned a fresh object on every call. That
  invalidated cached state and repaired the very bug the test was meant to catch. Make the double
  behave like the real thing, and only then observe a genuine RED.
- **The paired implementation task's regression check runs the touched suite, not the full suite.**
  The full run belongs to the [validation checklist](../invariants/feature-validation-checklist.md).
- **A local subset pass is not evidence about a change to shared code.** For a change to something
  every test loads, such as a shared helper, run the full suite. MovieCollectionManager once saw a
  fix pass every local check and then fail 28 tests in CI under the full suite's concurrency.

## Watching a test fail proves it is SENSITIVE, not that it is CORRECT

Removing the code and watching the test go red proves only that the assertion tracks that code. It
says nothing about whether it is the right assertion. A test can be perfectly sensitive to a property
nobody needs.

MovieCollectionManager measured it: a test asserted that a hook was *asked for* one kind of update.
Deleting the option made it fail, which felt like proof. But passing that option **replaced** the
default list instead of extending it, so other updates silently stopped arriving. The unit suite
stayed green, because it asserted what was **requested** and never what was still **delivered**.

So, after watching a test fail, ask the second question:

> **If this assertion held and the feature were still broken, how would that look?** If you can
> describe that state, the assertion is measuring the wrong thing.

Prefer asserting an **observable outcome** over a **configuration detail**. Configuration is a
means. When a test pins the means, the means can be satisfied while the end is not.

## When a test fails: fix the code, or fix the test?

> **Does the test still describe intended behaviour?**

- **Yes: fix the CODE.** Rewording a test to match what the code happens to do is fixing the test to
  match the code, and that is how a suite quietly stops describing the product.
- **No: fix the TEST.** When a deliberate change made the old expectation stale, update the
  expectation and say so in the commit.

Both look identical from the failure output: a red test and a plausible one-line change either way.
Never decide by which file is quicker to edit.
