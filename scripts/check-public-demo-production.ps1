# D:\CryptoTrader\scripts\check-public-demo-production.ps1

param(
    [string]$LocalApiBase = "http://127.0.0.1:8111",
    [string]$PublicApiBase = "https://demo-api.faytsystems.com",
    [string]$PublicSite = "https://demo.faytsystems.com"
)

$ErrorActionPreference = "Continue"

Write-Host "============================================================"
Write-Host " FaytSystems Public Demo Production Check"
Write-Host "============================================================"

Write-Host ""
Write-Host "[local] API health:"
try {
    Invoke-RestMethod "$LocalApiBase/health" | ConvertTo-Json -Depth 8
}
catch {
    Write-Host "[fail] Local API health failed:" $_.Exception.Message
}

Write-Host ""
Write-Host "[local] Demo status:"
try {
    Invoke-RestMethod "$LocalApiBase/demo/status" | ConvertTo-Json -Depth 8
}
catch {
    Write-Host "[fail] Local demo status failed:" $_.Exception.Message
}

Write-Host ""
Write-Host "[local] Risk projection meta:"
try {
    $projection = Invoke-RestMethod "$LocalApiBase/demo/risk-projection"
    $projection.meta | ConvertTo-Json -Depth 8
}
catch {
    Write-Host "[fail] Local risk projection failed:" $_.Exception.Message
}

Write-Host ""
Write-Host "[public] API health:"
try {
    Invoke-RestMethod "$PublicApiBase/health" | ConvertTo-Json -Depth 8
}
catch {
    Write-Host "[fail] Public API health failed:" $_.Exception.Message
}

Write-Host ""
Write-Host "[public] Site:"
try {
    $site = Invoke-WebRequest $PublicSite -UseBasicParsing -TimeoutSec 20
    Write-Host "[ok] Site status:" $site.StatusCode
}
catch {
    Write-Host "[fail] Public site failed:" $_.Exception.Message
}

Write-Host ""
Write-Host "============================================================"