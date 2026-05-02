# D:\CryptoTrader\fayt-demo-dashboard\scripts\build-production-local.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendRoot = Split-Path -Parent $scriptDir

Set-Location $frontendRoot

$env:VITE_APP_TITLE = "Fayt Systems Demo"
$env:VITE_DEMO_API_BASE = "https://demo-api.faytsystems.com"
$env:VITE_DEMO_WS_BASE = "wss://demo-api.faytsystems.com"

Write-Host "============================================================"
Write-Host " FaytSystems Local Production Frontend Build"
Write-Host "============================================================"
Write-Host "[frontend] root     = $frontendRoot"
Write-Host "[frontend] title    = $env:VITE_APP_TITLE"
Write-Host "[frontend] api base = $env:VITE_DEMO_API_BASE"
Write-Host "[frontend] ws base  = $env:VITE_DEMO_WS_BASE"
Write-Host "============================================================"

npm install
npm run build

Write-Host "============================================================"
Write-Host "[ok] Build complete:"
Write-Host "$frontendRoot\dist"
Write-Host "============================================================"