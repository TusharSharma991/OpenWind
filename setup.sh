#!/usr/bin/env bash
set -e

# ── Parse --pat argument ──────────────────────────────────────────────────────
PAT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pat)
      PAT="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$PAT" ]]; then
  echo ""
  echo " ERROR: No PAT provided."
  echo ""
  echo " Usage:  ./setup.sh --pat <token>"
  echo ""
  echo " First run setup.sh in the zitadel/ folder to generate the token:"
  echo ""
  echo "   cd ../zitadel"
  echo "   ./setup.sh"
  echo ""
  exit 1
fi

echo ""
echo " ============================================="
echo "  OpenWind Setup"
echo " ============================================="
echo ""
echo " Starting infrastructure and running bootstrap..."
echo " (First run takes 2-5 minutes)"
echo ""

# Start infra — bootstrap depends_on handles health checks
docker compose up -d postgres pgbouncer redis

# Run bootstrap with the PAT injected as env var
docker compose --profile bootstrap run -e "ZITADEL_SETUP_PAT=${PAT}" --rm bootstrap

# Start / recreate app containers so they pick up .env.local written by bootstrap
echo ""
echo " Starting app containers with fresh credentials..."
docker compose up -d --force-recreate ow-backend ow-frontend

echo ""
echo " ============================================="
echo "  Done!  Open http://localhost:3001"
echo " ============================================="
echo ""
echo "  owAdmin  / OpenWind1234!  (admin)"
echo "  owUser   / OpenWind1234!  (user)"
echo ""
