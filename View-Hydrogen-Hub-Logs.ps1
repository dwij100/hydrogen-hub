[CmdletBinding()]
param([int]$Lines = 200)
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
$output = docker compose logs --tail $Lines --no-color backend worker frontend 2>&1 | Out-String
$redacted = $output `
    -replace '(?i)(WLSACCESSID|WLSSECRET|LICENSEID|PASSWORD|SECRET|TOKEN)\s*[=:]\s*\S+', '$1=[REDACTED]' `
    -replace '(?i)(Authorization:\s*Bearer\s+)\S+', '$1[REDACTED]'
Write-Host $redacted
