#!/usr/bin/env bash
# Stages a self-contained copy of the compiled Consus server + built web SPA
# into src-tauri/resources/consus/, bundled into the .app via
# tauri.conf.json's bundle.resources -- so the installed app never depends
# on the git checkout's own path still existing.
#
# Real structural difference from Heimdall's own build-resources.sh (the
# precedent this was ported from): Heimdall's build is a single `tsc`
# output directory that serves its own dashboard. Consus's `npm run build`
# produces TWO artifacts -- dist-server/ (tsc) and dist-web/ (vite build,
# `npm run build:web`) -- and server/index.ts resolves its WEB_ROOT
# relative to dist-server/index.js's own compiled location:
#   join(dirname(fileURLToPath(import.meta.url)), "../dist-web")
# So dist-web/ MUST be staged as dist-server/'s sibling inside the resource
# dir, or the packaged app's sidecar comes up "healthy" (the health check
# only touches /health + sqlite, never dist-web/) while silently serving a
# blank/404 UI.
#
# Runtime deps are installed via a clean `npm ci --omit=dev` INSIDE the
# staging directory (never the live checkout's own node_modules) so the
# developer's own devDependencies (vitest, tsx, typescript itself) are
# never touched and never ship in the app -- same discipline Heimdall's
# script already documents and enforces.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."  # repo root (app/src-tauri/../..)
REPO_ROOT="$(pwd)"
STAGE="$REPO_ROOT/app/src-tauri/resources/consus"

echo "building consus (dist-server + dist-web)..."
npm run build

rm -rf "$STAGE"
mkdir -p "$STAGE"

cp -R "$REPO_ROOT/dist-server" "$STAGE/dist-server"
cp -R "$REPO_ROOT/dist-web" "$STAGE/dist-web"
cp "$REPO_ROOT/package.json" "$STAGE/package.json"
cp "$REPO_ROOT/package-lock.json" "$STAGE/package-lock.json"

echo "installing production dependencies into staged copy..."
(cd "$STAGE" && npm ci --omit=dev)
rm -f "$STAGE/package-lock.json"

echo "staged Consus build -> $STAGE"
