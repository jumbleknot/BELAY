#!/usr/bin/env bash
# .devcontainer/assert-egress-governed.sh — feature 004 (postStartCommand)
#
# On the Docker Sandbox path the host-side sandbox network policy IS the enforcement layer: there
# is no in-VM firewall, by design (research R2). This script does not re-implement egress control;
# it ASSERTS that the policy governs this container, in BOTH directions:
#
#   - a host that is NOT on the allowlist must be refused  (default-deny is in effect)
#   - a host that IS on the allowlist must be reachable    (a severed network is not a security
#     pass: it means the allowlist is not working either)
#
# KNOWN LIMIT. postStartCommand does not run on a Docker-level restart, which is what happens after
# the microVM idle-stops and `--restart=always` brings the container back. So this proves the policy
# at each real start, not continuously. The host-side policy enforces either way.
#
# Probes (overridable): EGRESS_BLOCKED_PROBE (a host, default example.com) and EGRESS_ALLOWED_PROBE
# (a URL, default https://registry.npmjs.org/). Exit 0 = governed as designed; 1 = not.
# Contract: specs/004-devcontainer-sandbox/contracts/cli.md.
set -uo pipefail

BLOCKED_HOST="${EGRESS_BLOCKED_PROBE:-example.com}"
ALLOWED_URL="${EGRESS_ALLOWED_PROBE:-https://registry.npmjs.org/}"
TIMEOUT=10

echo "[assert-egress-governed] verifying the host-side sandbox policy governs this container"

if ! command -v curl >/dev/null 2>&1; then
  echo "[assert-egress-governed] curl absent — cannot verify egress; refusing to claim it is governed" >&2
  exit 1
fi

fail=0

# A real request, judged by curl's EXIT CODE. `nc -z` reports blocked hosts as open, and curl's
# `000` status is a placeholder for a request never made, so neither is evidence.
if curl -sS --max-time "$TIMEOUT" -o /dev/null "https://${BLOCKED_HOST}/" 2>/dev/null; then
  echo "  ✗ ${BLOCKED_HOST} is REACHABLE — egress is NOT governed on this container" >&2
  echo "    The sandbox policy is the only enforcement layer on this path. If it is not applied, this" >&2
  echo "    container has unrestricted outbound access. Check: sbx policy ls <sandbox>" >&2
  fail=1
else
  echo "  ✓ ${BLOCKED_HOST} refused — default-deny is in effect"
fi

if curl -sS --max-time "$TIMEOUT" -o /dev/null "$ALLOWED_URL" 2>/dev/null; then
  echo "  ✓ ${ALLOWED_URL} reachable — the allowlist is applied, not a blanket block"
else
  echo "  ✗ ${ALLOWED_URL} is NOT reachable — egress appears severed rather than filtered" >&2
  echo "    This is not a security pass: it means the allowlist is not working either." >&2
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "[assert-egress-governed] PASS — host-side policy governs this container"
  exit 0
fi
echo "[assert-egress-governed] FAIL — egress posture is not as designed; do not treat this container as sandboxed" >&2
exit 1
