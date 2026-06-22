# setup.ps1 — Full OpenWind setup orchestrator (called by setup.bat / setup.sh)
# Creates ../zitadel/ at runtime, pulls the official Zitadel image, generates a
# PAT, then runs the OpenWind bootstrap — all in one shot.
#
# Usage (via wrapper scripts in repo root):
#   Windows:   setup.bat
#   Linux/Mac: ./setup.sh

param()
$ErrorActionPreference = 'Stop'

# ── Paths ─────────────────────────────────────────────────────────────────────
$owDir     = (Split-Path $PSScriptRoot -Parent)          # repo root
$zitaDir   = (Join-Path (Split-Path $owDir -Parent) 'zitadel')
$outputDir = (Join-Path $zitaDir 'output')
$patFile   = (Join-Path $outputDir 'pat.txt')
$genPatSrc = (Join-Path $owDir 'scripts\gen-pat.mjs')

function Banner($msg) { Write-Host "`n  $msg" -ForegroundColor Cyan }
function Ok($msg)     { Write-Host "  [+] $msg" -ForegroundColor Green }
function Info($msg)   { Write-Host "  --> $msg" -ForegroundColor DarkGray }
function Fail($msg)   { Write-Host "`n  [!] $msg`n" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  =============================================" -ForegroundColor Cyan
Write-Host "   OpenWind Setup" -ForegroundColor Cyan
Write-Host "  =============================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Create ../zitadel/ if it doesn't exist ───────────────────────────
Banner "Step 1/4  Setting up Zitadel identity provider"

if (-not (Test-Path $zitaDir)) {
    New-Item -ItemType Directory -Force $zitaDir | Out-Null
    New-Item -ItemType Directory -Force $outputDir | Out-Null
    Ok "Created $zitaDir"
} else {
    Info "Zitadel directory already exists — skipping creation"
}

# Write docker-compose.yml for Zitadel.
# Single-quoted here-string avoids PowerShell parsing YAML list items as unary operators.
# __GEN_PAT_SRC__ and __OUTPUT_DIR__ are replaced with actual paths after the string is built.
$composeYml = @'
name: zitadel

services:

  zitadel-db:
    container_name: zitadel-db
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: zitadel
      POSTGRES_PASSWORD: zitadel_dev_password
      POSTGRES_DB: zitadel
    volumes:
      - zitadel_db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zitadel -d zitadel"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
    networks:
      - internal

  zitadel:
    container_name: zitadel
    image: ghcr.io/zitadel/zitadel:v4.15.1
    restart: unless-stopped
    command: start-from-init --masterkey "MasterkeyNeedsToHave32Characters" --tlsMode disabled
    environment:
      ZITADEL_DATABASE_POSTGRES_HOST: zitadel-db
      ZITADEL_DATABASE_POSTGRES_PORT: 5432
      ZITADEL_DATABASE_POSTGRES_DATABASE: zitadel
      ZITADEL_DATABASE_POSTGRES_USER_USERNAME: zitadel
      ZITADEL_DATABASE_POSTGRES_USER_PASSWORD: zitadel_dev_password
      ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE: disable
      ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME: zitadel
      ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD: zitadel_dev_password
      ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE: disable
      ZITADEL_EXTERNALSECURE: "false"
      ZITADEL_EXTERNALPORT: "8080"
      ZITADEL_EXTERNALDOMAIN: "localhost"
      ZITADEL_FIRSTINSTANCE_ORG_HUMAN_USERNAME: owZitadelAdmin@openwind.local
      ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD: Admin1234!
      ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORDCHANGEREQUIRED: "false"
      ZITADEL_DEFAULTINSTANCE_LOGINPOLICY_FORCEMFA: "false"
      ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED: "false"
      ZITADEL_DEFAULTINSTANCE_FEATURES_TOKENEXCHANGE: "true"
    ports:
      - "8080:8080"
    depends_on:
      zitadel-db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "/app/zitadel", "ready"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 60s
    networks:
      - internal
      - openwind_zitadel

  ow-zita-setup:
    container_name: ow-zita-setup
    profiles: [setup]
    image: node:22-alpine
    working_dir: /app
    volumes:
      - __GEN_PAT_SRC__:/app/scripts/gen-pat.mjs:ro
      - __OUTPUT_DIR__:/app/output
    command: node /app/scripts/gen-pat.mjs
    environment:
      ZITADEL_EXTERNALDOMAIN: "localhost"
    networks:
      - openwind_zitadel
    depends_on:
      zitadel:
        condition: service_started
    restart: "no"

networks:
  internal:
    internal: true
  openwind_zitadel:
    name: openwind_zitadel

volumes:
  zitadel_db_data:
'@

# Replace placeholders with actual Windows paths (forward slashes for Docker)
$genPatSrcFwd = $genPatSrc -replace '\\', '/'
$outputDirFwd = $outputDir -replace '\\', '/'
$composeYml = $composeYml -replace '__GEN_PAT_SRC__', $genPatSrcFwd -replace '__OUTPUT_DIR__', $outputDirFwd

$composePath = Join-Path $zitaDir 'docker-compose.yml'
Set-Content -Path $composePath -Value $composeYml -Encoding utf8
Ok "docker-compose.yml written to $zitaDir"

# ── Step 2: Start Zitadel + generate PAT ────────────────────────────────────
Banner "Step 2/4  Starting Zitadel and generating bootstrap PAT"
Info "(First boot takes 60-90s while Zitadel initialises)"
Write-Host ""

Push-Location $zitaDir
try {
    docker compose up -d
    if ($LASTEXITCODE -ne 0) { Fail "Failed to start Zitadel containers" }

    # Remove stale PAT file from a previous run
    if (Test-Path $patFile) { Remove-Item $patFile -Force }

    docker compose --profile setup run --rm ow-zita-setup
    if ($LASTEXITCODE -ne 0) { Fail "PAT generation failed — check: docker compose logs zitadel" }
} finally {
    Pop-Location
}

# Read PAT written by gen-pat.mjs
if (-not (Test-Path $patFile)) { Fail "PAT file not found at $patFile — gen-pat.mjs did not complete" }
$pat = (Get-Content $patFile -Raw).Trim()
if ([string]::IsNullOrEmpty($pat)) { Fail "PAT file is empty" }

# Remove PAT file immediately — it was only needed to bridge containers
Remove-Item $patFile -Force
Ok "PAT received (in memory — not stored on disk)"
Write-Host ""

# ── Step 3: Run OpenWind bootstrap ──────────────────────────────────────────
Banner "Step 3/4  Running OpenWind bootstrap"
Info "(Migrations, seed data, Zitadel OIDC config, demo users)"
Write-Host ""

Set-Location $owDir

# Ensure .env.local exists as a file before docker volume-mounts it
if (-not (Test-Path '.env.local' -PathType Leaf)) {
    New-Item -ItemType File '.env.local' | Out-Null
}

docker compose up -d postgres pgbouncer redis
if ($LASTEXITCODE -ne 0) { Fail "Failed to start infrastructure containers" }

docker compose --profile bootstrap run -e "ZITADEL_SETUP_PAT=$pat" --rm bootstrap
if ($LASTEXITCODE -ne 0) { Fail "Bootstrap failed — check the output above" }

# Clear PAT from env — bootstrap has converted it to key JSON in .env.local
$pat = ''

# ── Step 4: Start app containers ─────────────────────────────────────────────
Banner "Step 4/4  Starting app containers"

docker compose up -d --force-recreate ow-backend ow-frontend
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!] Could not start app containers automatically." -ForegroundColor Yellow
    Write-Host "      Run manually: docker compose up -d ow-backend ow-frontend" -ForegroundColor Yellow
}

Ok "App containers started"

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  =============================================" -ForegroundColor Green
Write-Host "   Done!  Open http://localhost:3001" -ForegroundColor Green
Write-Host "  =============================================" -ForegroundColor Green
Write-Host ""
Write-Host "   owAdmin / OpenWind1234!   (admin)" -ForegroundColor White
Write-Host "   owUser  / OpenWind1234!   (user)" -ForegroundColor White
Write-Host ""
