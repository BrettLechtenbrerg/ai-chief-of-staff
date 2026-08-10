#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDER_IMAGE="electronuserland/builder@sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/acos-win-build.XXXXXX")"
ISOLATED_PROJECT="$WORK_DIR/project"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "[dist-win] Docker Desktop is required and must be running." >&2
  exit 1
fi

mkdir -p "$ISOLATED_PROJECT"
echo "[dist-win] Copying a clean source snapshot to an isolated workspace..."
rsync -a \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'release/' \
  --exclude '*.log' \
  "$ROOT_DIR/" "$ISOLATED_PROJECT/"

mkdir -p "$HOME/.cache/electron" "$HOME/.cache/electron-builder"
echo "[dist-win] Building Windows x64 without mounting the repository or host node_modules..."
docker run --rm \
  --mount "type=bind,src=$ISOLATED_PROJECT,dst=/project" \
  --mount "type=bind,src=$HOME/.cache/electron,dst=/root/.cache/electron" \
  --mount "type=bind,src=$HOME/.cache/electron-builder,dst=/root/.cache/electron-builder" \
  --workdir /project \
  "$BUILDER_IMAGE" \
  /bin/bash -lc 'npm ci && npm run build && npx electron-builder --win --x64 --config.win.forceCodeSigning=false'

mkdir -p "$ROOT_DIR/release"
rsync -a "$ISOLATED_PROJECT/release/" "$ROOT_DIR/release/"

# The isolated container cannot contaminate host dependencies. Rebuild anyway so
# the repository is explicitly left on the installed Electron ABI release gate.
echo "[dist-win] Rebuilding host native modules for Electron..."
npm --prefix "$ROOT_DIR" run rebuild:native

echo "[dist-win] Complete. Windows x64 artifacts copied to $ROOT_DIR/release"
