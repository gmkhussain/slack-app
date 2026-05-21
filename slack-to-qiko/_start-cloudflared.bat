@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "ENV_FILE=.env"
if not exist ".env" if exist "..\.env" set "ENV_FILE=..\.env"
if not exist "%ENV_FILE%" (
    echo ERROR: .env not found.
    pause
    exit /b 1
)

set "PORT=3010"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
    if /i "%%a"=="PORT" for /f "tokens=* delims= " %%p in ("%%b") do set "PORT=%%p"
)

where cloudflared >nul 2>&1
if errorlevel 1 (
    echo Installing cloudflared...
    winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo ERROR: Install manually: winget install Cloudflare.cloudflared
        pause
        exit /b 1
    )
)

echo Stopping old node/ngrok on port %PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
taskkill /IM ngrok.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting Qiko Slack app on port %PORT%...
start "slack-to-qiko" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo Waiting for server...
timeout /t 12 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test-challenge.ps1" -Port "%PORT%"

echo Starting Cloudflare tunnel (recommended for Slack Verify)...
start "qiko-tunnel" cmd /k "cloudflared tunnel --url http://localhost:%PORT%"

echo.
echo === Next steps ===
echo 1. In qiko-tunnel window copy URL like https://xxxx.trycloudflare.com
echo 2. Slack - Event Subscriptions - Request URL:
echo    https://xxxx.trycloudflare.com/slack/events
echo 3. Click Retry (keep slack-to-qiko + qiko-tunnel open)
echo 4. After Verified: fix SLACK_SIGNING_SECRET, set SLACK_SKIP_SIGNATURE_VERIFY=false
echo.
pause
