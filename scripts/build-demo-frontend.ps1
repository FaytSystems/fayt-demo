# D:\CryptoTrader\scripts\build-demo-frontend.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$frontend = Join-Path $root "fayt-demo-dashboard"

Set-Location $frontend

if (-not (Test-Path ".env.local") -and (Test-Path ".env.example")) {
    Copy-Item ".env.example" ".env.local" -Force
}

Write-Host "[demo-frontend] frontend = $frontend"
Write-Host "[demo-frontend] installing dependencies..."
npm install

Write-Host "[demo-frontend] building..."
npm run build

Write-Host "[demo-frontend] build complete: $frontend\dist"