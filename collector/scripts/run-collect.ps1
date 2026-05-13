param(
  [string]$BaseUrl = "",
  [string]$Email,
  [string]$Password,
  [ValidateSet("google_maps","google_search","manual","facebook","tiktok")]
  [string]$Adapter = "google_maps",
  [string]$Topic = "?????????????????????????",
  [ValidateSet("attractions","activities","hotels","cafes","restaurants","transport","events")]
  [string]$Category = "cafes",
  [string]$Lang = "th",
  [int]$MaxQueries = 5,
  [bool]$AiDiscovery = $true,
  [bool]$AutoImport = $true,
  [double]$Lat = 15.244,
  [double]$Lng = 104.847,
  [int]$Radius = 25000,
  [int]$MaxResultsPerQuery = 10,
  [string]$SourceLabel = "weekly-collect",
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = [Environment]::GetEnvironmentVariable("COLLECTOR_BASE_URL")
}
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = [Environment]::GetEnvironmentVariable("COLLECTOR_TEST_BASE_URL")
}
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = "http://127.0.0.1:5070"
}

if ($Help) {
  Write-Host "Usage:"
  Write-Host "  .\\scripts\\run-collect.ps1"
  Write-Host "  .\\scripts\\run-collect.ps1 -Topic \"???????????\" -Category restaurants"
  Write-Host "  .\\scripts\\run-collect.ps1 -Adapter manual -AiDiscovery:$false"
  Write-Host ""
  Write-Host "Required env:"
  Write-Host "  OPENAI_API_KEY (when -AiDiscovery:$true)"
  Write-Host "  GOOGLE_MAPS_API_KEY (when -Adapter google_maps)"
  Write-Host "  GOOGLE_CUSTOM_SEARCH_JSON_API_KEY + GOOGLE_CUSTOM_SEARCH_ENGINE_ID (when -Adapter google_search)"
  Write-Host "  GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID (legacy aliases still supported)"
  Write-Host "  BACKEND_AUTH_EMAIL or COLLECTOR_API_EMAIL (optional alternative to -Email)"
  Write-Host "  BACKEND_AUTH_PASSWORD or COLLECTOR_API_PASSWORD (optional alternative to -Password)"
  exit 0
}

function Assert-RequiredEnv {
  param(
    [string]$Name,
    [string]$Message
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw $Message
  }
}

try {
  if ([string]::IsNullOrWhiteSpace($Email)) {
    $Email = [Environment]::GetEnvironmentVariable("BACKEND_AUTH_EMAIL")
  }

  if ([string]::IsNullOrWhiteSpace($Email)) {
    $Email = [Environment]::GetEnvironmentVariable("COLLECTOR_API_EMAIL")
  }

  if ([string]::IsNullOrWhiteSpace($Email)) {
    throw "Collector email is required. Provide -Email or set BACKEND_AUTH_EMAIL (or COLLECTOR_API_EMAIL)."
  }

  if ($Adapter -eq "google_maps") {
    Assert-RequiredEnv -Name "GOOGLE_MAPS_API_KEY" -Message "????? GOOGLE_MAPS_API_KEY ?? environment"
  }
  if ($Adapter -eq "google_search") {
    $customApiKey = [Environment]::GetEnvironmentVariable("GOOGLE_CUSTOM_SEARCH_JSON_API_KEY")
    if ([string]::IsNullOrWhiteSpace($customApiKey)) {
      $customApiKey = [Environment]::GetEnvironmentVariable("GOOGLE_SEARCH_API_KEY")
    }
    if ([string]::IsNullOrWhiteSpace($customApiKey)) {
      throw "????? GOOGLE_CUSTOM_SEARCH_JSON_API_KEY ?? environment"
    }

    $customEngineId = [Environment]::GetEnvironmentVariable("GOOGLE_CUSTOM_SEARCH_ENGINE_ID")
    if ([string]::IsNullOrWhiteSpace($customEngineId)) {
      $customEngineId = [Environment]::GetEnvironmentVariable("GOOGLE_SEARCH_ENGINE_ID")
    }
    if ([string]::IsNullOrWhiteSpace($customEngineId)) {
      throw "????? GOOGLE_CUSTOM_SEARCH_ENGINE_ID ?? environment"
    }
  }

  if ($AiDiscovery) {
    Assert-RequiredEnv -Name "OPENAI_API_KEY" -Message "????? OPENAI_API_KEY ?? environment (???????????????? ai_discovery)"
  }

  if ([string]::IsNullOrWhiteSpace($Password)) {
    $Password = [Environment]::GetEnvironmentVariable("BACKEND_AUTH_PASSWORD")
  }

  if ([string]::IsNullOrWhiteSpace($Password)) {
    $Password = [Environment]::GetEnvironmentVariable("COLLECTOR_API_PASSWORD")
  }

  if ([string]::IsNullOrWhiteSpace($Password)) {
    throw "Collector password is required. Provide -Password or set BACKEND_AUTH_PASSWORD (or COLLECTOR_API_PASSWORD)."
  }

  Write-Host "[1/3] Login ???????? token..."
  $loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
  $login = Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
  $headers = @{ Authorization = "Bearer $($login.token)" }

  Write-Host "[2/3] ????????? collect..."
  $collectBody = @{
    adapter = $Adapter
    ai_discovery = $AiDiscovery
    topic = $Topic
    category = $Category
    lang = $Lang
    max_queries = $MaxQueries
    auto_import = $AutoImport
    source_label = $SourceLabel
    payload = @{
      language = $Lang
      region = "th"
      max_results_per_query = $MaxResultsPerQuery
      location = @{ lat = $Lat; lng = $Lng }
      radius = $Radius
    }
  } | ConvertTo-Json -Depth 10

  $result = Invoke-RestMethod -Uri "$BaseUrl/api/collect" -Method POST -Headers $headers -ContentType "application/json" -Body $collectBody

  Write-Host "[3/3] ??????"
  Write-Host "----------------------------------------"
  Write-Host ("batch_uid: " + $result.batch_uid)
  Write-Host ("adapter: " + $result.adapter)
  Write-Host ("raw_count: " + $result.raw_count)
  Write-Host ("imported_count: " + $result.imported_count)
  Write-Host ("auto_import: " + $result.auto_import)
  if ($null -ne $result.ai_queries) {
    Write-Host "ai_queries:"
    $result.ai_queries | ForEach-Object { Write-Host ("- " + $_) }
  }
  Write-Host "----------------------------------------"
  Write-Host "????????????: clean -> ai-draft -> quality -> review -> publish -> stage -> export"
}
catch {
  Write-Host "??????????????: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
