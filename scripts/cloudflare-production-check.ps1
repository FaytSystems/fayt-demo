# D:\CryptoTrader\scripts\cloudflare-production-check.ps1

param(
    [string]$ApiBase = "https://demo-api.faytsystems.com",
    [string]$FrontendBase = "https://demo.faytsystems.com"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================================"
Write-Host " FaytSystems Cloudflare Production Check"
Write-Host "============================================================"

Write-Host "[check] frontend = $FrontendBase"
try {
    $frontend = Invoke-WebRequest -Uri $FrontendBase -Method GET -UseBasicParsing -TimeoutSec 20
    Write-Host "[ok] frontend status:" $frontend.StatusCode
}
catch {
    Write-Host "[fail] frontend check failed:" $_.Exception.Message
}

Write-Host "[check] api health = $ApiBase/health"
try {
    $health = Invoke-RestMethod -Uri "$ApiBase/health" -Method GET -TimeoutSec 20
    $health | ConvertTo-Json -Depth 6
}
catch {
    Write-Host "[fail] api health check failed:" $_.Exception.Message
}

Write-Host "[check] api snapshot = $ApiBase/demo/snapshot"
try {
    $snapshot = Invoke-RestMethod -Uri "$ApiBase/demo/snapshot" -Method GET -TimeoutSec 20
    Write-Host "[ok] generated_at:" $snapshot.generated_at
    Write-Host "[ok] total_equity:" $snapshot.status.total_equity
    Write-Host "[ok] open trades:" $snapshot.open_trades.Count
    Write-Host "[ok] closed trades:" $snapshot.closed_trades.Count
    Write-Host "[ok] events:" $snapshot.events.Count
}
catch {
    Write-Host "[fail] api snapshot check failed:" $_.Exception.Message
}

Write-Host "============================================================"