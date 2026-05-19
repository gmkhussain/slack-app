$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path "$root\package.json")) {
  $root = Split-Path -Parent $PSScriptRoot
}
Set-Location $root

# Load PORT from .env
$port = 3010
if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*PORT\s*=\s*(\d+)') { $port = [int]$Matches[1] }
  }
}

Write-Host "Starting slackapp on port $port..."
$dev = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $root -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 4

$ngrokExe = "ngrok"
if (Test-Path "C:\laragon\bin\ngrok\ngrok.exe") {
  $ngrokExe = "C:\laragon\bin\ngrok\ngrok.exe"
  & $ngrokExe version 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { & $ngrokExe update 2>$null }
}

Write-Host "Starting ngrok http $port..."
$ngrok = Start-Process -FilePath $ngrokExe -ArgumentList "http", $port.ToString() -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 3

try {
  $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 5
  $publicUrl = ($tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
  if ($publicUrl) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host " Slack Request URL (paste in Slack app):" -ForegroundColor Green
    Write-Host " $publicUrl/slack/events" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "ngrok dashboard: http://127.0.0.1:4040"
    Write-Host "slackapp PID: $($dev.Id)  |  ngrok PID: $($ngrok.Id)"
    Write-Host "Stop: taskkill /PID $($dev.Id) /PID $($ngrok.Id) /F"
  }
} catch {
  Write-Host "ngrok started — open http://127.0.0.1:4040 for the public URL"
}

Write-Host "Press Enter to stop both processes..."
Read-Host | Out-Null
Stop-Process -Id $dev.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $ngrok.Id -Force -ErrorAction SilentlyContinue
