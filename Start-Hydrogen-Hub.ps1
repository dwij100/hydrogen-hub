[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Host 'Docker Desktop is not installed.' -ForegroundColor Red; exit 1 }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Open Docker Desktop and wait for Engine running, then try again.' -ForegroundColor Red; exit 1 }
if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) { Write-Host 'One-time setup has not been completed. Run Setup-Hydrogen-Hub.ps1 first.' -ForegroundColor Red; exit 1 }
if (-not (Test-Path -LiteralPath 'secrets\gurobi.lic' -PathType Leaf)) { Write-Host 'The private secrets\gurobi.lic file is missing.' -ForegroundColor Red; exit 1 }
docker compose up -d
if ($LASTEXITCODE -ne 0) { Write-Host 'Services could not start. Run Setup-Hydrogen-Hub.ps1 or View-Hydrogen-Hub-Logs.ps1.' -ForegroundColor Red; exit 1 }
$portLine = Get-Content -LiteralPath '.env' -ErrorAction SilentlyContinue | Where-Object { $_ -match '^HYDROGEN_HUB_PORT=' } | Select-Object -First 1
$port = if ($portLine) { [int](($portLine -split '=', 2)[1]) } else { 8080 }
$url = "http://localhost:$port"
$deadline = (Get-Date).AddMinutes(3)
do {
    Start-Sleep -Seconds 2
    try { $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5; $ready = $response.StatusCode -eq 200 } catch { $ready = $false }
} until ($ready -or (Get-Date) -gt $deadline)
if (-not $ready) { Write-Host 'The app did not become ready. Run Check-Hydrogen-Hub.ps1 and View-Hydrogen-Hub-Logs.ps1.' -ForegroundColor Red; exit 1 }
try { $health = Invoke-RestMethod -Uri "$url/healthz" -TimeoutSec 20 } catch {
    Write-Host 'The frontend opened, but backend health could not be read. Run Check-Hydrogen-Hub.ps1.' -ForegroundColor Red; exit 1
}
if ($health.status -ne 'ok') {
    Write-Host "The application is not solver-ready: $($health.solver.message)" -ForegroundColor Red
    Write-Host 'Run Check-Hydrogen-Hub.ps1 for every component.' -ForegroundColor Yellow
    exit 1
}
New-Item -ItemType Directory -Force -Path '.runtime' *> $null
$marker = '.runtime\browser-opened.txt'
$openBrowser = $true
if (Test-Path -LiteralPath $marker) {
    $age = (Get-Date) - (Get-Item -LiteralPath $marker).LastWriteTime
    if ($age.TotalSeconds -lt 30) { $openBrowser = $false }
}
Set-Content -LiteralPath $marker -Value (Get-Date).ToString('o')
if ($openBrowser) { Start-Process $url }
Write-Host "Hydrogen Hub is ready at $url" -ForegroundColor Green
