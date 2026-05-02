# D:\CryptoTrader\scripts\run-demo-api.ps1

param(
    [string]$DbPath = "D:\CryptoTrader\data\fayt_systems_REALISM_COSTS_4H_001.db",
    [int]$Port = 8111,
    [string]$AllowedOrigins = "http://127.0.0.1:5173,http://localhost:5173"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir

Set-Location $root

if (Test-Path ".\.venv\Scripts\Activate.ps1") {
    . .\.venv\Scripts\Activate.ps1
}

$env:PYTHONPATH = Join-Path $root "src"
$env:DEMO_DB_PATH = $DbPath
$env:DEMO_STARTING_EQUITY = "30000"
$env:DEMO_BROKER_NAME = "paper_sim"
$env:DEMO_ALLOWED_ORIGINS = $AllowedOrigins
$env:DEMO_ENABLE_DOCS = "false"
$env:DEMO_WS_PUSH_SECONDS = "2.0"

Write-Host "[demo-api] root              = $root"
Write-Host "[demo-api] PYTHONPATH        = $env:PYTHONPATH"
Write-Host "[demo-api] DEMO_DB_PATH      = $env:DEMO_DB_PATH"
Write-Host "[demo-api] allowed origins   = $env:DEMO_ALLOWED_ORIGINS"
Write-Host "[demo-api] url               = http://127.0.0.1:$Port"

python -m uvicorn cryptotrader.demo.demo_api:app --host 127.0.0.1 --port $Port --reload