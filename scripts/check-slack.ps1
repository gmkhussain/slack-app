# Quick diagnostics: local app, ngrok, recent Slack POSTs
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path "$root\.env")) { $root = Split-Path -Parent $PSScriptRoot }
Set-Location $root

$port = 3010
Get-Content ".env" | ForEach-Object {
  if ($_ -match '^\s*PORT\s*=\s*(\d+)') { $port = [int]$Matches[1] }
}

Write-Host "=== Qiko Slack diagnostics ===" -ForegroundColor Cyan
Write-Host "PORT from .env: $port"

try {
  $health = Invoke-WebRequest "http://localhost:$port/slack/events" -UseBasicParsing -TimeoutSec 3
  Write-Host "[OK] Local app: $($health.StatusCode) - $($health.Content.Substring(0, [Math]::Min(60, $health.Content.Length)))" -ForegroundColor Green
} catch {
  Write-Host "[FAIL] Local app not on port $port - run _start.bat" -ForegroundColor Red
}

try {
  $tunnels = (Invoke-RestMethod "http://127.0.0.1:4040/api/tunnels").tunnels
  $https = $tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1
  if ($https) {
    $url = $https.public_url
    $addr = $https.config.addr
    Write-Host "[OK] ngrok: $url -> $addr" -ForegroundColor Green
    Write-Host ""
    Write-Host "Paste in Slack -> Event Subscriptions -> Request URL:" -ForegroundColor Yellow
    Write-Host "  $url/slack/events"
    if ($addr -notmatch ":$port`$") {
      Write-Host "[WARN] ngrok port does not match PORT=$port" -ForegroundColor Red
    }
    try {
      $ng = Invoke-WebRequest "$url/slack/events" -Headers @{"ngrok-skip-browser-warning"="1"} -UseBasicParsing -TimeoutSec 10
      Write-Host "[OK] Public URL reachable: $($ng.StatusCode)" -ForegroundColor Green
    } catch {
      Write-Host "[FAIL] Public URL not reachable from this machine" -ForegroundColor Red
    }
  }
} catch {
  Write-Host "[FAIL] ngrok not running (http://127.0.0.1:4040)" -ForegroundColor Red
}

try {
  $reqs = (Invoke-RestMethod "http://127.0.0.1:4040/api/requests/http?limit=20").requests
  $slackPosts = $reqs | Where-Object { $_.request.method -eq "POST" -and $_.request.uri -match "slack/events" }
  if ($slackPosts.Count -eq 0) {
    Write-Host ""
    Write-Host "[FAIL] No POST /slack/events from Slack in ngrok log." -ForegroundColor Red
    Write-Host "  -> Event Subscriptions OFF or Request URL not saved/verified"
    Write-Host "  -> Or Socket Mode still ON in Slack app settings"
  } else {
    Write-Host ""
    Write-Host "[OK] Recent Slack POSTs: $($slackPosts.Count)" -ForegroundColor Green
    $slackPosts | Select-Object -First 5 | ForEach-Object {
      Write-Host "  $($_.start) $($_.response.status) $($_.request.uri)"
    }
  }
} catch { }

Write-Host ""
Write-Host "OAuth scopes are NOT enough. Also check:" -ForegroundColor Yellow
Write-Host "  1. Event Subscriptions: ON"
Write-Host "  2. Bot events subscribed: app_mention (and message.im for DMs)"
Write-Host "  3. Socket Mode: OFF"
Write-Host "  4. Reinstall app to workspace after changes"
Write-Host "  5. /invite @LinkstarBot in channel"
Write-Host "  6. Use @LinkstarBot hello (real mention, not just the name)"
