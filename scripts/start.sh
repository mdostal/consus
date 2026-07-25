#!/usr/bin/env bash
set -euo pipefail

# Production start script for the GitHub-release-packaged Delphi build.
# Assumes `npm run build` has already produced dist-web/ and dist-server/.
cd "$(dirname "$0")/.."

export PORT="${PORT:-8722}"
export DELPHI_DB_PATH="${DELPHI_DB_PATH:-.pHive/delphi.sqlite}"

exec node dist-server/index.js
