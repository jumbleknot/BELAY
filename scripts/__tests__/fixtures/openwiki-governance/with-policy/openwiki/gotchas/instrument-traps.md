---
type: Gotcha
title: Instrument traps
description: A tool's answer is about the tool, not about your question.
tags: [testing]
---

# Instrument traps

## A skipped test reads as a pass

`node --test` exits 0 when every test is skipped, so a credential-driven skip looks like a
green run. Read the skip count before calling a run a pass, and name the missing input before
retiring a tier to CI.

## Re-run under the raw tool

A condensed result can drop the line that mattered.
