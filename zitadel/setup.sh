#!/usr/bin/env bash
set -e

echo ""
echo " ============================================="
echo "  OpenWind | Zitadel Setup"
echo " ============================================="
echo ""
echo " Step 1/2 | Starting Zitadel..."
echo ""

docker compose up -d

echo ""
echo " Step 2/2 | Generating bootstrap PAT..."
echo " (Waiting for Zitadel to fully initialise — this can take 60-90s on first boot)"
echo ""

docker compose --profile setup run --rm ow-zita-setup

echo ""
