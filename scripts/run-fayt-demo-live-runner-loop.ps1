param(
    [string]$ProjectRoot = "D:\CryptoTrader",
    [int]$SleepSeconds = 8,
    [int]$CyclesPerPulse = 3
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot

$PythonExe = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (!(Test-Path $PythonExe)) { $PythonExe = "python" }

$env:PYTHONPATH = Join-Path $ProjectRoot "src"
$env:PUBLIC_DEMO_DB_PATH = Join-Path $ProjectRoot "data\fayt_public_demo_live.db"
$env:DEMO_DB_PATH = $env:PUBLIC_DEMO_DB_PATH
$env:DB_PATH = $env:PUBLIC_DEMO_DB_PATH
$env:LIVE_DB_PATH = $env:PUBLIC_DEMO_DB_PATH
$env:RESEARCH_DB_PATH = $env:PUBLIC_DEMO_DB_PATH

$env:BROKER_NAME = "paper_sim"
$env:PAPER_SIM_SUPPORTS_SHORT = "true"

$env:W_MASTER_300_GATE_ENABLED = "1"
$env:W_MASTER_300_GATE_MODE = "paper"
$env:W_MASTER_300_POLICY_DB = Join-Path $ProjectRoot "data\w_master_300_signal_family_walkforward_policy_v1.db"
$env:W_MASTER_300_AUDIT_DB = Join-Path $ProjectRoot "data\w_master_300_live_signal_policy_audit_v1.db"
$env:W_MASTER_300_FAIL_CLOSED = "1"
$env:W_MASTER_300_RUNTIME_TIMEFRAME = "60m"
$env:W_MASTER_300_RUNTIME_BARS_DB = "W:\CryptoTrader_Archive\research_top100_l2.db"

Remove-Item Env:\W_MASTER_300_RUNTIME_ATOMS -ErrorAction SilentlyContinue
Remove-Item Env:\W_MASTER_300_ATOMS -ErrorAction SilentlyContinue

Write-Host "Starting Fayt demo live-runner SIG300 loop. Ctrl+C to stop."
Write-Host "Demo DB: $env:PUBLIC_DEMO_DB_PATH"
Write-Host "SIG300 Audit DB: $env:W_MASTER_300_AUDIT_DB"
Write-Host "Bars DB: $env:W_MASTER_300_RUNTIME_BARS_DB"

while ($true) {
    & $PythonExe -m cryptotrader.runtime.runner_24x7
    & $PythonExe (Join-Path $ProjectRoot "tools\sync_w_master_300_public_demo_decisions.py") `
        --audit-db $env:W_MASTER_300_AUDIT_DB `
        --demo-db $env:PUBLIC_DEMO_DB_PATH
    Start-Sleep -Seconds $SleepSeconds
}
