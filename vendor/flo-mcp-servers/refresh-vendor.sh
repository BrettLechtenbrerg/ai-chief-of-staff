#!/usr/bin/env bash
# Refresh the vendored Flo MCP servers from an upstream Flo checkout.
#
# Usage: ./refresh-vendor.sh [FLO_REPO_PATH]
#   FLO_REPO_PATH defaults to ~/flo-assistant
#
# Re-runs after reviewed upstream changes:
#   1. Copy each server's dist/index.js into ./<server>/index.js
#   2. Preserve the tracked, security-patched ./shared package
#   3. Reinstall exact runtime dependencies from package-lock.json
#
# Upstream shared changes must be reviewed and ported manually; this script never
# overwrites ACOS's OAuth-path and private-proposal-storage patches.
#
# Idempotent — safe to re-run.

set -euo pipefail

FLO_REPO="${1:-$HOME/flo-assistant}"
VENDOR_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$FLO_REPO" ]; then
  echo "Error: FLO_REPO not found at $FLO_REPO" >&2
  exit 1
fi

echo "==> Vendoring from $FLO_REPO to $VENDOR_DIR"

# 1. Copy each server's compiled output.
for srv in gmail calendar docs bookmarks; do
  src="$FLO_REPO/servers/$srv/dist/index.js"
  dst="$VENDOR_DIR/$srv/index.js"
  if [ ! -f "$src" ]; then
    echo "Error: $src missing — run \`tsc\` in $FLO_REPO/servers/$srv first" >&2
    exit 1
  fi
  cp "$src" "$dst"
  echo "  ✓ $srv/index.js"
done

# 2. Install the exact locked runtime graph. The local @flo/shared dependency
# comes from ./shared, so npm ci reproduces the ACOS patches in node_modules.
( cd "$VENDOR_DIR" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null )
echo "  ✓ locked node_modules installed"

# 3. Fail closed if either security patch disappeared.
OAUTH_FILE="$VENDOR_DIR/node_modules/@flo/shared/dist/oauth.js"
PROPOSAL_FILE="$VENDOR_DIR/node_modules/@flo/shared/dist/proposal-cache.js"
grep -q "ACOS vendor patch" "$OAUTH_FILE" || {
  echo "Error: tracked FLO_TOKEN_PATH/FLO_CREDENTIALS_PATH patch is missing" >&2
  exit 2
}
grep -q "FLO_PROPOSALS_PATH" "$PROPOSAL_FILE" || {
  echo "Error: tracked private proposal path patch is missing" >&2
  exit 2
}
grep -q "0o600" "$PROPOSAL_FILE" || {
  echo "Error: tracked private proposal permission patch is missing" >&2
  exit 2
}
echo "  ✓ tracked @flo/shared security patches verified"

if ! diff -qr "$FLO_REPO/shared/dist" "$VENDOR_DIR/shared/dist" >/dev/null 2>&1; then
  echo "  ! Upstream shared output differs; review and port changes manually into ./shared/dist"
fi

echo "==> Vendor refresh complete."
