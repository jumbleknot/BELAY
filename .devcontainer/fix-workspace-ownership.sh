#!/usr/bin/env bash
# .devcontainer/fix-workspace-ownership.sh — feature 004 (onCreateCommand and postStartCommand)
#
# THE REPAIR half of the VM-user / container-user uid split (research R6). The CURE is in
# toolchain.Dockerfile, which creates `coder` at uid 1000, matching the sandbox VM user that owns the
# clone. This script repairs a tree that was written from the VM side anyway: any
# `ssh <sandbox> 'git -C /workspaces/belay …'` writes new objects as the VM user, which is an easy
# reflex. git does not fail cleanly then: it fails deep on individual object writes, with messages
# that read like repository corruption ("111 of 256 .git/objects subdirs plus 27 worktree files are
# owned by node, not coder, so any object write fails" — uid 1000 renders as `node` inside the
# image's base and as `agent` on the VM, which is what disguises the problem). The standing rule is:
# run git INSIDE the container.
#
# It repairs only mismatched paths, so the healthy case costs one `find`. It always exits 0: a
# permissions oddity must never block container start.
#
# Usage: fix-workspace-ownership.sh [workspace]   (default: $BELAY_WORKSPACE, else /workspaces/belay)
set -uo pipefail

WS="${1:-${BELAY_WORKSPACE:-/workspaces/belay}}"
ME="$(id -un)"
MY_UID="$(id -u)"

if [ ! -d "$WS" ]; then
  echo "[fix-workspace-ownership] no workspace at $WS — nothing to do"
  exit 0
fi

mismatched="$(find "$WS" -not -uid "$MY_UID" -print -quit 2>/dev/null || true)"
if [ -z "$mismatched" ]; then
  echo "[fix-workspace-ownership] ✓ $WS is entirely owned by $ME ($MY_UID) — nothing to repair"
else
  n="$(find "$WS" -not -uid "$MY_UID" 2>/dev/null | wc -l)"
  echo "[fix-workspace-ownership] $n path(s) under $WS are NOT owned by $ME ($MY_UID) — repairing"
  echo "  (the VM-user vs container-user uid split; see this script's header)"
  find "$WS" -not -uid "$MY_UID" -exec sudo chown "$MY_UID":"$(id -g)" {} + 2>/dev/null || true
  left="$(find "$WS" -not -uid "$MY_UID" 2>/dev/null | wc -l)"
  if [ "$left" -eq 0 ]; then
    echo "[fix-workspace-ownership] ✓ repaired — all paths now owned by $ME"
  else
    echo "[fix-workspace-ownership] ⚠ $left path(s) still mismatched; inspect with:" >&2
    echo "    find $WS -not -uid $MY_UID -printf '%u %p\\n' | head" >&2
  fi
fi

# The clone is created by the VM user, so git inside the container may otherwise refuse it as
# "dubious ownership" until the repair above has run.
git config --global --add safe.directory "$WS" 2>/dev/null || true
exit 0
