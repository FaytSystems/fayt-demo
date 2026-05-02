# D:\CryptoTrader\scripts\run-demo-runner-production.ps1

param(
    [string]$DbPath = "D:\CryptoTrader\data\fayt_public_demo_live.db",
    [int]$Cycles = 999999,
    [int]$PollSeconds = 1,
    [int]$MaxNewEntriesPerCycle = 1,
    [string]$Symbols = ""
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

# The runner writes to the same public demo DB the read-only API reads.
$env:DB_PATH = $DbPath
$env:LIVE_DB_PATH = $DbPath
$env:RESEARCH_DB_PATH = $DbPath

$env:BROKER_NAME = "paper_sim"
$env:PAPER_SIM_SUPPORTS_SHORT = "true"

# Public demo should remain paper-only and certified/controlled.
$env:RUNNER_ALLOW_WATCHLIST_ENTRIES = "false"
$env:RUNNER_ALLOW_HOLD_ENTRIES = "false"
$env:RUNNER_ALLOW_SHORT_ENTRIES = "true"

$env:RUNNER_POLL_SECONDS = "$PollSeconds"
$env:MAX_NEW_ENTRIES_PER_CYCLE = "$MaxNewEntriesPerCycle"

# Safer production demo defaults.
$env:RUNNER_DISABLE_BUCKET_COOLDOWN = "false"
$env:RUNNER_SYMBOL_COOLDOWN_MULTIPLIER = "1.0"

if ($Symbols.Trim().Length -gt 0) {
    $env:SYMBOLS = $Symbols
}

Write-Host "============================================================"
Write-Host " FaytSystems Public Demo Paper Runner"
Write-Host "============================================================"
Write-Host "[root]                    $root"
Write-Host "[PYTHONPATH]              $env:PYTHONPATH"
Write-Host "[DB_PATH]                 $env:DB_PATH"
Write-Host "[LIVE_DB_PATH]            $env:LIVE_DB_PATH"
Write-Host "[RESEARCH_DB_PATH]        $env:RESEARCH_DB_PATH"
Write-Host "[BROKER_NAME]             $env:BROKER_NAME"
Write-Host "[PAPER_SIM_SUPPORTS_SHORT] $env:PAPER_SIM_SUPPORTS_SHORT"
Write-Host "[watchlist entries]       $env:RUNNER_ALLOW_WATCHLIST_ENTRIES"
Write-Host "[hold entries]            $env:RUNNER_ALLOW_HOLD_ENTRIES"
Write-Host "[short entries]           $env:RUNNER_ALLOW_SHORT_ENTRIES"
Write-Host "[poll seconds]            $env:RUNNER_POLL_SECONDS"
Write-Host "[max new entries/cycle]   $env:MAX_NEW_ENTRIES_PER_CYCLE"
Write-Host "[cycles]                  $Cycles"
if ($env:SYMBOLS) {
    Write-Host "[symbols]                 $env:SYMBOLS"
}
Write-Host "============================================================"

python -u -m cryptotrader run-paper --cycles $Cycles