# D:\CryptoTrader\scripts\use-repeatability-validated-demo-db.ps1

param(
    [string]$SourceDb = "D:\CryptoTrader\data\timescale_certified_95symbols_60m_highvol_REPEATABILITY_VALIDATED_20260428_085541.db",
    [string]$DemoDb = "D:\CryptoTrader\data\fayt_public_demo_live.db"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================================"
Write-Host " FaytSystems Public Demo DB Selector"
Write-Host "============================================================"
Write-Host "[source] $SourceDb"
Write-Host "[demo]   $DemoDb"
Write-Host "============================================================"

if (-not (Test-Path $SourceDb)) {
    throw "Source DB not found: $SourceDb"
}

$demoDir = Split-Path -Parent $DemoDb

if (-not (Test-Path $demoDir)) {
    New-Item -ItemType Directory -Path $demoDir -Force | Out-Null
}

if (Test-Path $DemoDb) {
    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backup = "$DemoDb.backup_$stamp"
    Write-Host "[backup] Existing demo DB -> $backup"
    Copy-Item $DemoDb $backup -Force
}

Write-Host "[copy] Creating public demo working DB..."
Copy-Item $SourceDb $DemoDb -Force

Write-Host ""
Write-Host "[ok] Demo DB ready:"
Write-Host $DemoDb
Write-Host ""
Write-Host "Use this for API:"
Write-Host '$env:DEMO_DB_PATH = "'$DemoDb'"'
Write-Host ""
Write-Host "Use this for runner:"
Write-Host '$env:DB_PATH = "'$DemoDb'"'
Write-Host '$env:LIVE_DB_PATH = "'$DemoDb'"'
Write-Host '$env:RESEARCH_DB_PATH = "'$DemoDb'"'
Write-Host "============================================================"