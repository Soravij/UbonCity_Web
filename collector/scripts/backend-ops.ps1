param(
  [ValidateSet("ready", "health", "status", "logs", "smoke", "stop", "restart")]
  [string]$Action = "health",
  [int]$Port = 0,
  [string]$HealthUrl = "",
  [int]$Lines = 40
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Port -gt 0) {
  if ($Action -eq "smoke") {
    $env:BACKEND_SMOKE_PORT = [string]$Port
  }
  else {
    $env:PORT = [string]$Port
  }
}

if (-not [string]::IsNullOrWhiteSpace($HealthUrl)) {
  $env:BACKEND_HEALTH_URL = $HealthUrl
}

$scriptMap = @{
  ready  = "backend:ready"
  health = "backend:health"
  status = "backend:status"
  restart = "backend:restart"
  logs   = "backend:logs"
  smoke  = "backend:smoke"
  stop   = "backend:stop"
}

$scriptName = $scriptMap[$Action]
Write-Host ("Running npm script: " + $scriptName)

if ($Action -eq "logs") {
  $env:BACKEND_LOG_LINES = [string]$Lines
}

& npm.cmd run $scriptName
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
