$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:AI_PROJECT_ROOT = $root

function Set-EnvFromDotEnvValue {
  param(
    [string]$Name,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return
  }

  $current = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($current)) {
    return
  }

  $trimmed = [string]$Value
  $trimmed = $trimmed.Trim()
  if (
    ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) -or
    ($trimmed.StartsWith("'") -and $trimmed.EndsWith("'"))
  ) {
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
  }

  if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
    [Environment]::SetEnvironmentVariable($Name, $trimmed, "Process")
  }
}

function Import-AskEnvFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return
  }

  Get-Content $Path | ForEach-Object {
    $line = [string]$_
    if ([string]::IsNullOrWhiteSpace($line)) { return }
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("#")) { return }
    $parts = $trimmed -split "=", 2
    if ($parts.Length -ne 2) { return }
    $name = $parts[0].Trim()
    $value = $parts[1]
    if ($name -in @("OPENAI_API_KEY_ASK", "OPENAI_API_KEY", "OPENAI_MODEL_ASK", "OPENAI_MODEL")) {
      Set-EnvFromDotEnvValue -Name $name -Value $value
    }
  }
}

Import-AskEnvFile (Join-Path $root "backend\.env")
Import-AskEnvFile (Join-Path $root "collector\.env")
Import-AskEnvFile (Join-Path $root ".env")

node (Join-Path $root "backend\scripts\ask.js") @args
