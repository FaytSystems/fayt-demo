# D:\CryptoTrader\scripts\build-demo-frontend-production.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$frontend = Join-Path $root "fayt-demo-dashboard"

if (-not (Test-Path $frontend)) {
    throw "Frontend folder not found: $frontend"
}

Set-Location $frontend

$env:VITE_APP_TITLE = "Fayt Systems Demo"
$env:VITE_DEMO_API_BASE = "https://demo-api.faytsystems.com"
$env:VITE_DEMO_WS_BASE = "wss://demo-api.faytsystems.com"

Write-Host "============================================================"
Write-Host " FaytSystems Demo Frontend Production Build"
Write-Host "============================================================"
Write-Host "[frontend] folder      = $frontend"
Write-Host "[frontend] api base    = $env:VITE_DEMO_API_BASE"
Write-Host "[frontend] ws base     = $env:VITE_DEMO_WS_BASE"
Write-Host "[frontend] output      = $frontend\dist"
Write-Host "============================================================"

npm install
npm run build