#!/usr/bin/env bash
# .devcontainer/check-image-pin.sh — feature 004 (initializeCommand, step 1; runs on the sandbox VM)
#
# The thin Dockerfile builds FROM ${BASE_IMAGE}, which devcontainer.json sets to
# ${localEnv:BELAY_DEVCONTAINER_IMAGE:belay-devcontainer}. So when the pin is unset, or was sourced
# without `set -a` and never exported, the build SILENTLY uses whatever local `belay-devcontainer`
# image exists: possibly stale, possibly none. An all-CACHED build is the only tell. This script
# makes that fallback visible at every `devcontainer up` (spec US4-AC3).
#
# It prints only the DIGEST, never the full reference: the registry host is topology.
# It always exits 0, so a deliberate offline build from the local tag still works.
# Contract: specs/004-devcontainer-sandbox/contracts/cli.md.
set -uo pipefail

pin="${BELAY_DEVCONTAINER_IMAGE:-}"
digest="$(printf '%s' "$pin" | grep -oE '@sha256:[0-9a-f]{64}$' | cut -c2- || true)"

if [ -n "$digest" ]; then
  echo "[check-image-pin] ✓ pinned: ${digest}"
  exit 0
fi

if [ -z "$pin" ]; then
  why="BELAY_DEVCONTAINER_IMAGE is not set in this shell"
else
  why="BELAY_DEVCONTAINER_IMAGE is set but carries no @sha256: digest"
fi
cat <<EOF
[check-image-pin] ⚠ ${why}.
[check-image-pin] ⚠ This build will use the LOCAL image tag \`belay-devcontainer\`, which may be stale or absent.
[check-image-pin]   To use the published image, source the env file so its values are EXPORTED, then re-run:
[check-image-pin]     set -a; . ~/.belay-sandbox-env; set +a
[check-image-pin]   and check: echo "\$BELAY_DEVCONTAINER_IMAGE"   (must end in @sha256:<digest>)
[check-image-pin]   See docs/runbooks/devcontainer.md, "Re-pin the image".
EOF
exit 0
