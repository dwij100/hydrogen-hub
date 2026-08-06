[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
docker compose stop
if ($LASTEXITCODE -ne 0) { Write-Host 'Some services could not be stopped. Check Docker Desktop.' -ForegroundColor Red; exit 1 }
Write-Host 'Hydrogen Hub stopped. Completed runs and results remain in the persistent Docker volume.' -ForegroundColor Green
