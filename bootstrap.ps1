# bootstrap.ps1 — OpenWind developer setup (Windows)
#
# Usage (PowerShell):
#   .\bootstrap.ps1
#
# Requirements: Node.js 22+, pnpm 9+, Docker Desktop (running)

$ErrorActionPreference = "Stop"

# Move to repo root
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js not found. Install Node.js 22+ from https://nodejs.org"
    exit 1
}

# Check pnpm
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm not found. Install: npm install -g pnpm"
    exit 1
}

# Check Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker not found. Install Docker Desktop from https://docker.com"
    exit 1
}

# Hand off to the TypeScript bootstrap script
& pnpm exec tsx scripts/bootstrap.ts @args
