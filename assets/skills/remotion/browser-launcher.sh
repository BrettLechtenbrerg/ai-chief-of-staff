#!/bin/bash
# Remotion 4.0.484 adds these switches unconditionally. Preserve native Chrome
# protections instead; no modification to the user's external workspace.
set -eu
args=()
for arg in "$@"; do
  case "$arg" in
    --no-sandbox|--disable-setuid-sandbox|--allow-running-insecure-content|--disable-site-isolation-trials|--disable-ipc-flooding-protection|--enable-unsafe-webgpu|--disable-features=*|--no-proxy-server|--proxy-server=*|--proxy-bypass-list=*) ;;
    *) args+=("$arg") ;;
  esac
done
[[ "${ACOS_VIDEO_PROXY:-}" =~ ^http://127\.0\.0\.1:[0-9]{1,5}$ ]] || exit 64
args+=("--proxy-server=$ACOS_VIDEO_PROXY" '--proxy-bypass-list=<-loopback>')
exec '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' "${args[@]}"
