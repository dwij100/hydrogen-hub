[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Stop-WithError([string]$Message) {
    Write-Host "ERROR: $Message" -ForegroundColor Red
    Write-Host 'No licence contents or credentials have been displayed.' -ForegroundColor DarkGray
    exit 1
}

Write-Host 'Hydrogen Hub one-time setup' -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-WithError 'Docker was not found. Install Docker Desktop, restart Windows if requested, then run this script again.'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Docker Desktop is installed but its engine is not running. Open Docker Desktop and wait for Engine running.' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Docker Compose is unavailable. Update Docker Desktop and try again.' }

$required = @('docker-compose.yml', 'frontend.Dockerfile', 'backend\Dockerfile', 'backend\solver\HSC_operational.py')
foreach ($file in $required) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Stop-WithError "Required project file is missing: $file" }
}
if (-not (Test-Path -LiteralPath 'secrets\gurobi.lic' -PathType Leaf)) {
    Stop-WithError 'Missing secrets\gurobi.lic. Put your full private Gurobi licence there with that exact filename.'
}
if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Host 'Created .env from safe local defaults.' -ForegroundColor Green
}
New-Item -ItemType Directory -Force -Path '.runtime', 'backups' *> $null

$portLine = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^HYDROGEN_HUB_PORT=' } | Select-Object -First 1
$port = if ($portLine) { [int](($portLine -split '=', 2)[1]) } else { 8080 }
$existingHealth = $null
try { $existingHealth = Invoke-RestMethod -Uri "http://localhost:$port/healthz" -TimeoutSec 5 } catch { }
if ($existingHealth -and ($existingHealth.queue.active -gt 0 -or $existingHealth.queue.queued -gt 0)) {
    Stop-WithError 'An optimization is queued or active. Let it finish or cancel it in the app before rerunning setup.'
}
$existingFrontend = docker compose ps -q frontend
if (-not $existingFrontend) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { Stop-WithError "Local port $port is already occupied. Close the other application or change HYDROGEN_HUB_PORT in .env." }
}

Write-Host 'Building the frontend, API, worker and solver image. The first build can take several minutes...' -ForegroundColor Yellow
docker compose build --pull
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Docker image build failed. Run View-Hydrogen-Hub-Logs.ps1 after services start, or review the build error above.' }

Write-Host 'Running backend integrity, adapter, queue, contract, serialization, and model-build tests...' -ForegroundColor Yellow
docker compose run --rm --no-deps backend pytest -q -p no:cacheprovider backend/tests
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Backend verification failed. The services were not started; review the test error above.' }

Write-Host 'Running the licensed feasible-scenario smoke solve...' -ForegroundColor Yellow
docker compose run --rm --no-deps backend python -m backend.app.services.smoke_test
if ($LASTEXITCODE -ne 0) { Stop-WithError 'The licensed smoke solve failed. The services were not upgraded; review the printed run-log path above.' }

Write-Host 'Starting persistent services...' -ForegroundColor Yellow
docker compose up -d
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Docker could not start the services.' }

$deadline = (Get-Date).AddMinutes(5)
do {
    Start-Sleep -Seconds 3
    $backendId = docker compose ps -q backend
    $workerId = docker compose ps -q worker
    $frontendId = docker compose ps -q frontend
    $backendHealth = if ($backendId) { (docker inspect --format '{{.State.Health.Status}}' $backendId).Trim() } else { 'missing' }
    $workerHealth = if ($workerId) { (docker inspect --format '{{.State.Health.Status}}' $workerId).Trim() } else { 'missing' }
    $frontendHealth = if ($frontendId) { (docker inspect --format '{{.State.Health.Status}}' $frontendId).Trim() } else { 'missing' }
    Write-Host "Backend=$backendHealth Worker=$workerHealth Frontend=$frontendHealth"
} until (($backendHealth -eq 'healthy' -and $workerHealth -eq 'healthy' -and $frontendHealth -eq 'healthy') -or (Get-Date) -gt $deadline)

if ($backendHealth -ne 'healthy' -or $workerHealth -ne 'healthy' -or $frontendHealth -ne 'healthy') {
    docker compose ps
    Stop-WithError 'One or more services did not become healthy. Run View-Hydrogen-Hub-Logs.ps1.'
}

try { $health = Invoke-RestMethod -Uri "http://localhost:$port/healthz" -TimeoutSec 30 } catch {
    Stop-WithError "The containers are running, but http://localhost:$port/healthz did not respond."
}
Write-Host "API: $($health.api.ready) | Database: $($health.database.ready) | Worker: $($health.worker.ready)" -ForegroundColor Cyan
Write-Host "Dataset: $($health.dataset.ready) | Gurobi package: $($health.solver.package_status) | Licence: $($health.solver.licence_status)" -ForegroundColor Cyan
if (-not $health.solver.ready) { Stop-WithError $health.solver.message }
if ($health.status -ne 'ok') { Stop-WithError 'Setup finished, but readiness remains degraded. Run Check-Hydrogen-Hub.ps1.' }

Write-Host ''
Write-Host 'SETUP COMPLETE' -ForegroundColor Green
Write-Host 'From now on, double-click Start Hydrogen Hub.bat. Do not rerun setup for each optimization.' -ForegroundColor Green
Write-Host "Application address: http://localhost:$port"
