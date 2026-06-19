@echo off
setlocal

echo.
echo  =============================================
echo   OpenWind ^| Zitadel Setup
echo  =============================================
echo.
echo  Step 1/2 ^| Starting Zitadel...
echo.

docker compose up -d
if %errorlevel% neq 0 (
  echo.
  echo  ERROR: Failed to start Zitadel containers.
  echo  Check: docker compose logs zitadel
  echo.
  exit /b 1
)

echo.
echo  Step 2/2 ^| Generating bootstrap PAT...
echo  (Waiting for Zitadel to fully initialise — this can take 60-90s on first boot)
echo.

docker compose --profile setup run --rm ow-zita-setup
if %errorlevel% neq 0 (
  echo.
  echo  ERROR: PAT generation failed.
  echo  Check Zitadel logs: docker compose logs zitadel
  echo.
  exit /b 1
)

echo.
