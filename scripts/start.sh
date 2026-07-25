#!/usr/bin/env bash
set -euo pipefail

# Production start script for the GitHub-release-packaged Consus build.
# Assumes `npm run build` has already produced dist-web/ and dist-server/.
cd "$(dirname "$0")/.."

export PORT="${PORT:-8722}"
export CONSUS_DB_PATH="${CONSUS_DB_PATH:-.pHive/consus.sqlite}"

exec node dist-server/index.js
