#!/usr/bin/env bash
# .devcontainer/gen-container-secrets-env.sh — feature 004 (initializeCommand, step 2; runs on the VM)
#
# Writes the file `docker run --env-file` reads (devcontainer.json runArgs), from the VM's
# ~/.belay-sandbox-env. This is how credentials reach the container WITHOUT entering it any other
# way, each measured:
#   - containerEnv is compiled into ENV instructions in the generated Dockerfile, so values there are
#     baked into image layers (found in 3 history layers) and echoed on the `docker run` line.
#   - remoteEnv does not reach `ssh` + `docker exec` sessions.
#   - `docker run -e NAME=value` puts the value in argv, where `ps` shows it to every user.
#
# WHY IT RE-EMITS RATHER THAN COPIES. ~/.belay-sandbox-env is shell-sourceable (`KEY='value'`), and
# `--env-file` does NO quote processing, so the shell form would deliver `'value'` with literal
# apostrophes and fail auth in a way that reads like a bad key. This sources the file and writes
# the bare `KEY=value` form.
#
# Rules (data-model.md, Container secrets file): only FORGE_TOKEN and FORGE_ISSUE_TOKEN; bare lines;
# a value containing a newline is skipped (it cannot be represented in an env-file line); mode 600;
# rewritten from empty every time. ANTHROPIC_API_KEY is never written, whatever the source holds:
# Claude Code silently prefers it over a subscription login and bills per token.
#
# Prints variable NAMES and LENGTHS only, never values. Always exits 0: a missing credential must
# never block the container from starting.
set -uo pipefail

SRC="${BELAY_SANDBOX_ENV_FILE:-$HOME/.belay-sandbox-env}"
OUT="${BELAY_CONTAINER_SECRETS_ENV:-$HOME/.belay-devcontainer-secrets.env}"
VARS="FORGE_TOKEN FORGE_ISSUE_TOKEN"

umask 077
: > "$OUT" || { echo "[gen-container-secrets-env] ✗ cannot write $OUT" >&2; exit 0; }
chmod 600 "$OUT" 2>/dev/null || true

if [ -f "$SRC" ]; then
  # shellcheck disable=SC1090
  set -a; . "$SRC"; set +a
else
  echo "[gen-container-secrets-env] ⚠ $SRC not found — writing an EMPTY env file."
  echo "[gen-container-secrets-env]   The container will start WITHOUT forge credentials; see"
  echo "[gen-container-secrets-env]   docs/runbooks/devcontainer.md (the sandbox env file)."
fi

written=0
total=0
missing=""
emitted=""
for v in $VARS; do
  total=$((total + 1))
  eval "val=\${$v:-}"
  if [ -z "$val" ]; then missing="$missing $v"; continue; fi
  # $'\n', not "$(printf '\n')": command substitution strips trailing newlines, so the latter is an
  # EMPTY pattern and `*""*` matches every value (measured upstream: it refused every credential).
  case "$val" in
    *$'\n'*)
      echo "[gen-container-secrets-env] ✗ $v contains a newline — refusing to emit it" >&2
      continue ;;
  esac
  printf '%s=%s\n' "$v" "$val" >> "$OUT"
  written=$((written + 1))
  emitted="$emitted $v"
done

echo "[gen-container-secrets-env] wrote $written/$total credential(s) to $OUT (mode $(stat -c '%a' "$OUT" 2>/dev/null || echo '?'))"
for v in $emitted; do
  eval "val=\${$v:-}"
  echo "  ✓ $v (${#val} chars)"
done
[ -n "$missing" ] && echo "  ⚠ not provisioned:$missing"
exit 0
