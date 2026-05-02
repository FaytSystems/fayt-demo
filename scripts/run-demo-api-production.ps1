# D:\CryptoTrader\scripts\run-demo-api-production.ps1

param(
    [string]$DbPath = "D:\CryptoTrader\data\fayt_public_demo_live.db",
    [int]$Port = 8111,
    [string]$AllowedOrigins = "https://demo.faytsystems.com"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$src = Join-Path $root "src"

Set-Location $root

if (-not (Test-Path $src)) {
    throw "Source folder not found: $src"
}

if (-not (Test-Path $DbPath)) {
    throw "Public demo DB not found: $DbPath"
}

if (Test-Path ".\.venv\Scripts\Activate.ps1") {
    . .\.venv\Scripts\Activate.ps1
}
else {
    Write-Host "[warn] venv activation script not found. Continuing with current Python environment."
}

$env:PYTHONPATH = $src

# Public read-only API points to the same DB the runner writes.
$env:DEMO_DB_PATH = $DbPath
$env:DEMO_STARTING_EQUITY = "30000"
$env:DEMO_BROKER_NAME = "paper_sim"
$env:DEMO_ALLOWED_ORIGINS = $AllowedOrigins
$env:DEMO_ENABLE_DOCS = "false"
$env:DEMO_WS_PUSH_SECONDS = "2.0"

# Risk projection matrix.
$env:DEMO_PROJECTION_ACCOUNT_SIZES = "1000,5000,10000,25000,100000"
$env:DEMO_PROJECTION_RISK_LEVELS = "1.25,2.5,5,10,25"
$env:DEMO_PROJECTION_FALLBACK_STOP_PCT = "0.01"

Write-Host "============================================================"
Write-Host " FaytSystems Public Read-Only Demo API"
Write-Host "============================================================"
Write-Host "[root]              $root"
Write-Host "[PYTHONPATH]        $env:PYTHONPATH"
Write-Host "[DEMO_DB_PATH]      $env:DEMO_DB_PATH"
Write-Host "[origins]           $env:DEMO_ALLOWED_ORIGINS"
Write-Host "[docs enabled]      $env:DEMO_ENABLE_DOCS"
Write-Host "[local API]         http://127.0.0.1:$Port"
Write-Host "[public API]        https://demo-api.faytsystems.com"
Write-Host "[public site]       https://demo.faytsystems.com"
Write-Host "============================================================"

python -m uvicorn cryptotrader.demo.demo_api:app --host 127.0.0.1 --port $Port