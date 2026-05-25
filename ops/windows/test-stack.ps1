param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "status",
  [string]$RuntimeRoot = "",
  [string]$CloudflaredConfig = "C:\cloudflared\config.yml",
  [string]$TunnelName = "uboncity-test"
)

$ErrorActionPreference = "Stop"

function Resolve-RuntimeRoot {
  param([string]$ExplicitRoot)

  if (-not [string]::IsNullOrWhiteSpace($ExplicitRoot)) {
    return (Resolve-Path $ExplicitRoot).Path
  }

  $scriptRoot = Split-Path -Parent $PSScriptRoot
  return (Resolve-Path (Join-Path $scriptRoot "..")).Path
}

function Ensure-Directory {
  param([string]$PathValue)
  New-Item -ItemType Directory -Force -Path $PathValue | Out-Null
}

function Read-PidInfo {
  param([string]$PidFile)
  if (-not (Test-Path $PidFile)) {
    return $null
  }
  return Get-Content $PidFile -Raw | ConvertFrom-Json
}

function Remove-PidFile {
  param([string]$PidFile)
  if (Test-Path $PidFile) {
    Remove-Item -Force $PidFile
  }
}

function Test-ProcessAlive {
  param([int]$ProcessId)
  if ($ProcessId -le 0) {
    return $false
  }
  try {
    Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Start-ManagedProcess {
  param(
    [string]$Name,
    [string]$WorkDir,
    [string]$Command,
    [string]$PidFile,
    [string]$StdoutFile,
    [string]$StderrFile
  )

  $existing = Read-PidInfo -PidFile $PidFile
  if ($null -ne $existing -and (Test-ProcessAlive -ProcessId ([int]$existing.pid))) {
    Write-Host ("[{0}] already running with pid {1}" -f $Name, $existing.pid)
    return
  }

  Remove-PidFile -PidFile $PidFile
  Ensure-Directory -PathValue (Split-Path -Parent $PidFile)
  Ensure-Directory -PathValue (Split-Path -Parent $StdoutFile)
  Ensure-Directory -PathValue (Split-Path -Parent $StderrFile)

  $proc = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-Command", $Command) `
    -WorkingDirectory $WorkDir `
    -RedirectStandardOutput $StdoutFile `
    -RedirectStandardError $StderrFile `
    -WindowStyle Hidden `
    -PassThru

  [pscustomobject]@{
    pid = $proc.Id
    name = $Name
    workdir = $WorkDir
    command = $Command
    started_at = (Get-Date).ToString("o")
    stdout = $StdoutFile
    stderr = $StderrFile
  } | ConvertTo-Json -Depth 4 | Set-Content $PidFile

  Write-Host ("[{0}] started pid {1}" -f $Name, $proc.Id)
}

function Stop-ManagedProcess {
  param(
    [string]$Name,
    [string]$PidFile
  )

  $pidInfo = Read-PidInfo -PidFile $PidFile
  if ($null -eq $pidInfo) {
    Write-Host ("[{0}] no pid file" -f $Name)
    return
  }

  $pid = [int]$pidInfo.pid
  if (-not (Test-ProcessAlive -ProcessId $pid)) {
    Remove-PidFile -PidFile $PidFile
    Write-Host ("[{0}] stale pid file removed" -f $Name)
    return
  }

  Stop-Process -Id $pid -Force
  Remove-PidFile -PidFile $PidFile
  Write-Host ("[{0}] stopped pid {1}" -f $Name, $pid)
}

function Get-ManagedStatus {
  param(
    [string]$Name,
    [string]$PidFile,
    [string]$HealthUrl = ""
  )

  $pidInfo = Read-PidInfo -PidFile $PidFile
  $processId = if ($null -ne $pidInfo) { [int]$pidInfo.pid } else { 0 }
  $alive = Test-ProcessAlive -ProcessId $processId
  $health = $null

  if ($alive -and -not [string]::IsNullOrWhiteSpace($HealthUrl)) {
    try {
      $resp = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
      $health = $resp
    } catch {
      $health = @{ ok = $false; error = $_.Exception.Message }
    }
  }

  return [pscustomobject]@{
    name = $Name
    pid = $processId
    alive = $alive
    health = $health
  }
}

$root = Resolve-RuntimeRoot -ExplicitRoot $RuntimeRoot
$runtimeDir = Join-Path $root "runtime\test-stack"
$pidDir = Join-Path $runtimeDir "pids"
$logDir = Join-Path $runtimeDir "logs"

$services = @(
  @{
    Name = "backend"
    WorkDir = Join-Path $root "backend"
    Command = "npm.cmd start"
    PidFile = Join-Path $pidDir "backend.pid.json"
    StdoutFile = Join-Path $logDir "backend.out.log"
    StderrFile = Join-Path $logDir "backend.err.log"
    HealthUrl = "http://127.0.0.1:5000/api/health"
  },
  @{
    Name = "collector"
    WorkDir = Join-Path $root "collector"
    Command = "npm.cmd start"
    PidFile = Join-Path $pidDir "collector.pid.json"
    StdoutFile = Join-Path $logDir "collector.out.log"
    StderrFile = Join-Path $logDir "collector.err.log"
    HealthUrl = "http://127.0.0.1:5070/api/health"
  },
  @{
    Name = "frontend"
    WorkDir = Join-Path $root "frontend"
    Command = "npm.cmd run dev -- --hostname 127.0.0.1 --port 3000"
    PidFile = Join-Path $pidDir "frontend.pid.json"
    StdoutFile = Join-Path $logDir "frontend.out.log"
    StderrFile = Join-Path $logDir "frontend.err.log"
    HealthUrl = "http://127.0.0.1:3000"
  },
  @{
    Name = "admin"
    WorkDir = Join-Path $root "admin"
    Command = "npm.cmd run dev -- --host 127.0.0.1 --port 5173"
    PidFile = Join-Path $pidDir "admin.pid.json"
    StdoutFile = Join-Path $logDir "admin.out.log"
    StderrFile = Join-Path $logDir "admin.err.log"
    HealthUrl = "http://127.0.0.1:5173"
  },
  @{
    Name = "cloudflared"
    WorkDir = $root
    Command = ('cloudflared tunnel --config "{0}" --protocol http2 --edge-ip-version 4 run --dns-resolver-addrs 1.1.1.1:53 --dns-resolver-addrs 8.8.8.8:53 {1}' -f $CloudflaredConfig, $TunnelName)
    PidFile = Join-Path $pidDir "cloudflared.pid.json"
    StdoutFile = Join-Path $logDir "cloudflared.out.log"
    StderrFile = Join-Path $logDir "cloudflared.err.log"
    HealthUrl = ""
  }
)

switch ($Action) {
  "start" {
    foreach ($service in $services) {
      Start-ManagedProcess `
        -Name $service.Name `
        -WorkDir $service.WorkDir `
        -Command $service.Command `
        -PidFile $service.PidFile `
        -StdoutFile $service.StdoutFile `
        -StderrFile $service.StderrFile
    }
  }
  "stop" {
    foreach ($service in @($services | Select-Object -Reverse)) {
      Stop-ManagedProcess -Name $service.Name -PidFile $service.PidFile
    }
  }
  "status" {
    $statuses = foreach ($service in $services) {
      Get-ManagedStatus -Name $service.Name -PidFile $service.PidFile -HealthUrl $service.HealthUrl
    }
    $statuses | ConvertTo-Json -Depth 6
  }
}
