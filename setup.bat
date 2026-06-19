@echo off
setlocal EnableDelayedExpansion

:: ── Parse --pat argument ──────────────────────────────────────────────────────
set PAT=
:parse
if "%~1"=="" goto :done_parse
if /i "%~1"=="--pat" (
  set "PAT=%~2"
  shift
  shift
  goto :parse
)
shift
goto :parse
:done_parse

if "%PAT%"=="" (
  echo.
  echo  ERROR: No PAT provided.
  echo.
  echo  Usage:  setup.bat --pat ^<token^>
  echo.
  echo  First run setup.bat in the zitadel\ folder to generate the token:
  echo.
  echo    cd ..\zitadel
  echo    setup.bat
  echo.
  exit /b 1
)

echo.
echo  =============================================
echo   OpenWind Setup
echo  =============================================
echo.
echo  Starting infrastructure and running bootstrap...
echo  (First run takes 2-5 minutes)
echo.

:: Ensure .env.local exists as a file so Docker does not create it as a directory
if not exist ".env.local" type nul > ".env.local"

:: Start infra (postgres, pgbouncer, redis) — bootstrap depends_on handles health
docker compose up -d postgres pgbouncer redis
if %errorlevel% neq 0 (
  echo.
  echo  ERROR: Failed to start infrastructure containers.
  exit /b 1
)

:: Run bootstrap with the PAT injected as env var
docker compose --profile bootstrap run -e "ZITADEL_SETUP_PAT=%PAT%" --rm bootstrap
if %errorlevel% neq 0 (
  echo.
  echo  ERROR: Bootstrap failed. Check the output above for details.
  exit /b 1
)

:: Start / recreate app containers so they pick up .env.local written by bootstrap
echo.
echo  Starting app containers with fresh credentials...
docker compose up -d --force-recreate ow-backend ow-frontend
if %errorlevel% neq 0 (
  echo.
  echo  WARNING: Could not start app containers automatically.
  echo  Run manually:  docker compose up -d ow-backend ow-frontend
)

echo.
echo  =============================================
echo   Done!  Open http://localhost:3001
echo  =============================================
echo.
echo   owAdmin   / OpenWind1234!   (admin)
echo   owUser    / OpenWind1234!   (user)
echo.
