# D:\CryptoTrader\scripts\run-cloudflare-tunnel-production.ps1

param(
    [string]$ConfigPath = "D:\CryptoTrader\cloudflared\demo-api.yml"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    throw "cloudflared was not found in PATH. Install Cloudflare Tunnel first."
}

if (-not (Test-Path $ConfigPath)) {
    throw "Cloudflare tunnel config not found: $ConfigPath"
}

Write-Host "============================================================"
Write-Host " FaytSystems Cloudflare Tunnel"
Write-Host "============================================================"
Write-Host "[config]     $ConfigPath"
Write-Host "[public]     https://demo-api.faytsystems.com"
Write-Host "[local API]  http://127.0.0.1:8111"
Write-Host "============================================================"

cloudflared tunnel --config $ConfigPath run