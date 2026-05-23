#!/usr/bin/env bash
# Refresh the vendored Flo MCP servers from an upstream Flo checkout.
#
# Usage: ./refresh-vendor.sh [FLO_REPO_PATH]
#   FLO_REPO_PATH defaults to ~/flo-assistant
#
# Re-runs after upstream changes:
#   1. Copy each server's dist/index.js into ./<server>/index.js
#   2. Copy @flo/shared dist/*.js into node_modules/@flo/shared/dist/
#   3. Re-apply the FLO_TOKEN_PATH / FLO_CREDENTIALS_PATH patch to oauth.js
#   4. Run `npm install` for the runtime deps (googleapis, mcp sdk, zod)
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

# 2. Install runtime deps (googleapis, mcp sdk, zod).
( cd "$VENDOR_DIR" && npm install --no-package-lock --no-audit --no-fund --omit=dev --ignore-scripts >/dev/null )
echo "  ✓ node_modules installed"

# 3. Re-vendor @flo/shared compiled output (must happen AFTER npm install,
# since @flo/shared isn't on npm — npm install removes anything not in
# package.json).
mkdir -p "$VENDOR_DIR/node_modules/@flo/shared/dist"
cp "$FLO_REPO/shared/dist/"*.js "$VENDOR_DIR/node_modules/@flo/shared/dist/"
cp "$FLO_REPO/shared/package.json" "$VENDOR_DIR/node_modules/@flo/shared/package.json"
echo "  ✓ @flo/shared vendored"

# 4. Re-apply the env-var override patch to oauth.js.
OAUTH_FILE="$VENDOR_DIR/node_modules/@flo/shared/dist/oauth.js"
if grep -q "ACOS vendor patch" "$OAUTH_FILE"; then
  echo "  ✓ oauth.js already patched"
else
  # Use a Node one-liner so we don't depend on GNU vs BSD sed differences.
  node -e "
    const fs = require('fs');
    const f = '$OAUTH_FILE';
    let s = fs.readFileSync(f, 'utf8');
    const before = \"const TOKEN_PATH = path.join(process.env.HOME || '', '.flo', 'tokens.json');\\nconst CREDENTIALS_PATH = path.join(process.env.HOME || '', '.flo', 'credentials.json');\";
    const after = \"// ACOS vendor patch (plan §6): honor FLO_TOKEN_PATH and FLO_CREDENTIALS_PATH.\\nconst TOKEN_PATH = process.env.FLO_TOKEN_PATH || path.join(process.env.HOME || '', '.flo', 'tokens.json');\\nconst CREDENTIALS_PATH = process.env.FLO_CREDENTIALS_PATH || path.join(process.env.HOME || '', '.flo', 'credentials.json');\";
    if (!s.includes(before)) {
      console.error('Upstream oauth.js no longer matches the expected pattern — patch manually.');
      process.exit(2);
    }
    s = s.replace(before, after);
    fs.writeFileSync(f, s);
  "
  echo "  ✓ oauth.js patched"
fi

echo "==> Vendor refresh complete."
