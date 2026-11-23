#!/usr/bin/env bash
# .devcontainer/ensure-rtk-hook.sh — feature 004 (postCreateCommand)
#
# RTK IS NOT ACTIVE JUST BECAUSE THE BINARY EXISTS. It compresses only through the
# `rtk hook claude` PreToolUse entry in ~/.claude/settings.json. `rtk init -g`, run
# non-interactively by an automated install, PROMPTS before patching and defaults to NO, printing a
# "manual step" into a build log nobody reads. The result is RTK installed but inactive: `rtk
# --version` answers and every session gets zero compression. This wires the hook idempotently,
# backs settings.json up first, refuses to touch invalid JSON, and no-ops when no personal layer is
# installed. Always exits 0: it must never block container start.
set -uo pipefail

CLAUDE_DIR="${HOME}/.claude"
SETTINGS="${CLAUDE_DIR}/settings.json"
RTK_BIN="${CLAUDE_DIR}/tools/bin/rtk"

if [ ! -x "$RTK_BIN" ]; then
  echo "ensure-rtk-hook: RTK not installed at ${RTK_BIN} — nothing to wire."
  echo "ensure-rtk-hook: install the personal layer once per fresh belay-claude volume, from the VM shell:"
  echo "    devcontainer up --workspace-folder /workspaces/belay \\"
  echo "      --config /workspaces/belay/.devcontainer/devcontainer.json \\"
  echo "      --dotfiles-repository https://github.com/jumbleknot/mcm-dotfiles"
  exit 0
fi

command -v node >/dev/null 2>&1 || { echo "ensure-rtk-hook: node absent; cannot patch settings.json" >&2; exit 0; }
mkdir -p "$CLAUDE_DIR"

node -e '
const fs = require("fs");
const p = process.argv[1];
let cfg = {};
if (fs.existsSync(p)) {
  try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) {
    console.error("ensure-rtk-hook: " + p + " is not valid JSON — refusing to overwrite it.");
    console.error("  " + e.message);
    process.exit(3);
  }
}
cfg.hooks = cfg.hooks || {};
cfg.hooks.PreToolUse = cfg.hooks.PreToolUse || [];
if (JSON.stringify(cfg.hooks.PreToolUse).includes("rtk hook")) {
  console.log("ensure-rtk-hook: RTK hook already wired — no change.");
  process.exit(0);
}
cfg.hooks.PreToolUse.push({ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] });
// Back up first: this is the developer'"'"'s personal config on a persistent volume.
if (fs.existsSync(p)) fs.copyFileSync(p, p + ".pre-rtk-hook.bak");
fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
console.log("ensure-rtk-hook: RTK PreToolUse hook wired into " + p);
' "$SETTINGS"
rc=$?

if grep -q 'rtk hook' "$SETTINGS" 2>/dev/null; then
  echo "ensure-rtk-hook: verified — RTK is ACTIVE (PreToolUse → 'rtk hook claude')."
  exit 0
fi
echo "ensure-rtk-hook: FAILED to wire the RTK hook (node exit ${rc})." >&2
echo "ensure-rtk-hook: RTK is installed but INACTIVE — sessions will get ZERO compression." >&2
exit 0
