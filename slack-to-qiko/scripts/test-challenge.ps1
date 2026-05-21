# Local checks after _start.bat (health + optional challenge POST)
param([string]$Port = "3010")

$Port = "$Port".Trim()
if (-not $Port) { $Port = "3010" }

Write-Host "Checking port $Port..."

try {
  $health = Invoke-WebRequest -Uri "http://localhost:$Port/health" -UseBasicParsing -TimeoutSec 5
  Write-Host "[OK] App running - health $($health.StatusCode)" -ForegroundColor Green
} catch {
  Write-Host "[FAIL] App not ready on port $Port - wait for qiko-slackapp window, or check for errors." -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}

$body = '{"type":"url_verification","challenge":"test_challenge_12345"}'
try {
  $r = Invoke-WebRequest -Uri "http://localhost:$Port/slack/events" -Method POST -ContentType "application/json" -Body $body -UseBasicParsing
  if ($r.Content -eq "test_challenge_12345") {
    Write-Host "[OK] Slack Verify format OK (plain text challenge)" -ForegroundColor Green
  } else {
    Write-Host "[WARN] Expected plain text challenge, got: $($r.Content)" -ForegroundColor Yellow
  }
} catch {
  Write-Host "[INFO] POST test: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host "Slack: use Retry in api.slack.com (not browser GET)." -ForegroundColor Cyan
