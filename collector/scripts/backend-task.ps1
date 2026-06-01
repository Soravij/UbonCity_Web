param(
  [ValidateSet("install", "status", "remove", "run")]
  [string]$Action = "status",
  [string]$TaskName = "UbonCityCollectorBackend",
  [int]$Port = 0,
  [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"

$scriptPath = $MyInvocation.MyCommand.Path
$scriptDir = Split-Path -Parent $scriptPath
$root = Split-Path -Parent $scriptDir
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runValueName = $TaskName

function Get-NodeExecutable {
  param([string]$ExplicitPath)

  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (-not (Test-Path $ExplicitPath)) {
      throw "node executable not found at $ExplicitPath"
    }
    return (Resolve-Path $ExplicitPath).Path
  }

  $cmd = Get-Command node -ErrorAction Stop
  return $cmd.Source
}

function Build-RunCommand {
  param(
    [string]$ResolvedNodePath,
    [int]$ResolvedPort
  )

  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $scriptPath + '"'),
    "-Action", "run",
    "-NodePath", ('"' + $ResolvedNodePath + '"')
  )

  if ($ResolvedPort -gt 0) {
    $args += @("-Port", [string]$ResolvedPort)
  }

  return ('"' + (Join-Path $PSHOME "powershell.exe") + '" ' + ($args -join " "))
}

function Get-RunEntry {
  try {
    return (Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction Stop).$runValueName
  } catch {
    return $null
  }
}

function Should-FallbackToRegistryRun {
  param([string]$ErrorMessage)

  $msg = [string]$ErrorMessage
  if ([string]::IsNullOrWhiteSpace($msg)) {
    return $false
  }

  $normalized = $msg.ToLowerInvariant()
  if ($normalized.Contains("access is denied")) { return $true }
  if ($normalized.Contains("access denied")) { return $true }
  if ($normalized.Contains("0x80070005")) { return $true }
  if ($normalized.Contains("unauthorized")) { return $true }
  if ($normalized.Contains("requires elevation")) { return $true }
  if ($normalized.Contains("new-scheduledtaskaction") -and $normalized.Contains("not recognized")) { return $true }
  if ($normalized.Contains("register-scheduledtask") -and $normalized.Contains("not recognized")) { return $true }
  if ($normalized.Contains("scheduledtasks")) { return $true }
  return $false
}

if ($Action -eq "run") {
  Set-Location $root
  if ($Port -gt 0) {
    $env:PORT = [string]$Port
  }
  $resolvedNode = Get-NodeExecutable -ExplicitPath $NodePath
  & $resolvedNode (Join-Path $root "scripts\backend-ready.mjs")
  exit $LASTEXITCODE
}

if ($Action -eq "install") {
  $resolvedNode = Get-NodeExecutable -ExplicitPath $NodePath
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $runCommand = Build-RunCommand -ResolvedNodePath $resolvedNode -ResolvedPort $Port
  $taskArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $scriptPath + '"'),
    "-Action", "run",
    "-NodePath", ('"' + $resolvedNode + '"')
  )
  if ($Port -gt 0) {
    $taskArguments += @("-Port", [string]$Port)
  }

  try {
    $taskAction = New-ScheduledTaskAction -Execute (Join-Path $PSHOME "powershell.exe") -Argument ($taskArguments -join " ")
    $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
    $taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
    Write-Host ("Installed scheduled task: " + $TaskName + " for user " + $currentUser)
  } catch {
    $reason = [string]$_.Exception.Message
    if (Should-FallbackToRegistryRun -ErrorMessage $reason) {
      try {
        New-ItemProperty -Path $runKeyPath -Name $runValueName -Value $runCommand -PropertyType String -Force | Out-Null
        Write-Host ("Scheduled Task install unavailable; installed HKCU Run auto-start instead: " + $runValueName)
        Write-Host ("Fallback reason: " + $reason)
      } catch {
        $registryReason = [string]$_.Exception.Message
        throw ("Scheduled Task install failed, and HKCU Run fallback was also unavailable: " + $registryReason)
      }
    } else {
      throw ("Scheduled Task install failed and no fallback was applied: " + $reason)
    }
  }
  exit 0
}

if ($Action -eq "remove") {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host ("Removed scheduled task: " + $TaskName)
  }

  $runEntry = Get-RunEntry
  if ($null -ne $runEntry) {
    Remove-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction SilentlyContinue
    Write-Host ("Removed HKCU Run auto-start: " + $runValueName)
  }

  if (-not $task -and $null -eq $runEntry) {
    Write-Host ("Auto-start not installed: " + $TaskName)
  }
  exit 0
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
  [PSCustomObject]@{
    Mode           = "scheduled_task"
    TaskName       = $task.TaskName
    State          = $task.State
    LastRunTime    = $taskInfo.LastRunTime
    LastTaskResult = $taskInfo.LastTaskResult
    NextRunTime    = $taskInfo.NextRunTime
  } | ConvertTo-Json -Depth 4
  exit 0
}

$runEntry = Get-RunEntry
if ($null -ne $runEntry) {
  [PSCustomObject]@{
    Mode    = "registry_run"
    Name    = $runValueName
    Command = $runEntry
  } | ConvertTo-Json -Depth 4
  exit 0
}

Write-Host ("Auto-start not installed: " + $TaskName)
exit 0
