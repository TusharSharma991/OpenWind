#!/usr/bin/env bash
# bootstrap.sh — OpenWind developer setup (macOS / Linux)
#
# Usage:
#   bash bootstrap.sh
#
# Requirements: Node.js 22+, pnpm 9+, Docker Desktop (running)

set -euo pipefail

# Ensure we are in the repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "✗  Node.js not found. Install Node.js 22+ from https://nodejs.org"
  exit 1
fi

# Check pnpm
if ! command -v pnpm &> /dev/null; then
  echo "✗  pnpm not found. Install: npm install -g pnpm"
  exit 1
fi

# Install tsx if not present (needed to run the bootstrap script)
if ! command -v tsx &> /dev/null; then
  echo "→  Installing tsx..."
  npm install -g tsx
fi

# Hand off to the TypeScript bootstrap script
exec pnpm exec tsx scripts/bootstrap.ts "$@"
