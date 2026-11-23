#!/usr/bin/env bash
# .devcontainer/persist-claude-config.sh — feature 004 (onCreateCommand)
#
# The belay-claude volume holds ~/.claude, but Claude Code's GLOBAL config is ~/.claude.json, a
# sibling on the ephemeral overlay. A recreate therefore dropped the account identity, the machine id
# and every project's history, while the OAuth tokens (inside ~/.claude) survived: the asymmetry hid
# the loss. devcontainer.json sets CLAUDE_CONFIG_DIR=/home/coder/.claude, which moves only that one
# file onto the volume. This script carries an EXISTING config across, once:
#
#   1. a parseable $CLAUDE_CONFIG_DIR/.claude.json already exists → nothing to do;
#   2. else a parseable ~/.claude.json (the pre-move location) → COPY it (cp -p, not mv: a failed
#      copy must not lose the only copy);
#   3. else the newest PARSEABLE $CLAUDE_CONFIG_DIR/backups/.claude.json.backup.* → restore it
#      (Claude Code writes rolling backups; the newest can be truncated);
#   4. else nothing: Claude Code creates a fresh config on the volume.
#
# Never a symlink: Claude Code replaces the file by write-then-rename, which swaps a symlink back to
# a plain overlay file and silently restores the bug. Always exits 0.
set -uo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
TARGET="$CLAUDE_DIR/.claude.json"
LEGACY="$HOME/.claude.json"
BACKUP_DIR="$CLAUDE_DIR/backups"

say() { printf '[persist-claude-config] %s\n' "$1"; }

# Parseable JSON object? python3 or node when present; otherwise a structural check, so a missing
# interpreter does not make every candidate look broken.
is_usable() {
  [ -s "$1" ] || return 1
  if command -v node >/dev/null 2>&1; then
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$1" 2>/dev/null
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" 2>/dev/null
    return $?
  fi
  [ "$(tr -d '[:space:]' < "$1" | head -c 1)" = "{" ] && [ "$(tr -d '[:space:]' < "$1" | tail -c 1)" = "}" ]
}

if [ ! -d "$CLAUDE_DIR" ]; then
  say "no $CLAUDE_DIR (the belay-claude volume is absent) — nothing to do."
  exit 0
fi

if is_usable "$TARGET"; then
  say "already persisted at $TARGET — no action."
  exit 0
fi

if is_usable "$LEGACY"; then
  if cp -p "$LEGACY" "$TARGET"; then
    say "copied $LEGACY → $TARGET (identity and project history are now on the belay-claude volume)."
    exit 0
  fi
  say "WARNING: could not copy $LEGACY → $TARGET; Claude Code will start from a fresh config."
  exit 0
fi

if [ -d "$BACKUP_DIR" ]; then
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    is_usable "$candidate" || { say "skipping unparseable backup $(basename "$candidate")."; continue; }
    if cp -p "$candidate" "$TARGET"; then
      say "restored $TARGET from $(basename "$candidate")."
      exit 0
    fi
    say "WARNING: could not restore from $candidate."
    break
  done <<EOF
$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '.claude.json.backup.*' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | cut -d' ' -f2-)
EOF
fi

say "no existing config to carry over — Claude Code will create one at $TARGET (on the volume)."
exit 0
