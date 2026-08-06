[CmdletBinding()]
param()
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Hydrogen Hub health check' -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Host 'Docker engine: NOT INSTALLED' -ForegroundColor Red; exit 1 }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Docker engine: NOT RUNNING' -ForegroundColor Red; exit 1 }
Write-Host 'Docker engine: running' -ForegroundColor Green
docker compose ps
$frontendId = docker compose ps -q frontend
$frontendHealth = if ($frontendId) { (docker inspect --format '{{.State.Health.Status}}' $frontendId).Trim() } else { 'missing' }
if ($frontendHealth -eq 'healthy') {
    Write-Host "Frontend container: $frontendHealth" -ForegroundColor Green
} else {
    Write-Host "Frontend container: $frontendHealth" -ForegroundColor Yellow
}
$portLine = Get-Content -LiteralPath '.env' -ErrorAction SilentlyContinue | Where-Object { $_ -match '^HYDROGEN_HUB_PORT=' } | Select-Object -First 1
$port = if ($portLine) { [int](($portLine -split '=', 2)[1]) } else { 8080 }
try {
    $health = Invoke-RestMethod -Uri "http://localhost:$port/healthz" -TimeoutSec 20
    Write-Host "Frontend/API address: http://localhost:$port" -ForegroundColor Green
    Write-Host "API ready: $($health.api.ready) — $($health.api.message)"
    Write-Host "Database ready: $($health.database.ready) — $($health.database.message)"
    Write-Host "Worker ready: $($health.worker.ready) — $($health.worker.message)"
    Write-Host "Storage ready: $($health.storage.ready) — $($health.storage.message)"
    Write-Host "Dataset ready: $($health.dataset.ready) — $($health.dataset.message)"
    Write-Host "Gurobi package: $($health.solver.package_status)"
    Write-Host "Gurobi licence: $($health.solver.licence_status) — $($health.solver.message)"
    Write-Host "Queue: $($health.queue.queued) queued, $($health.queue.active) active"
    if ($health.status -eq 'ok') { Write-Host 'Overall: READY' -ForegroundColor Green; exit 0 }
    Write-Host 'Overall: DEGRADED' -ForegroundColor Yellow; exit 1
} catch {
    Write-Host "Browser/API connection failed at http://localhost:$port" -ForegroundColor Red
    Write-Host 'Run View-Hydrogen-Hub-Logs.ps1 for recent logs.'
    exit 1
}
