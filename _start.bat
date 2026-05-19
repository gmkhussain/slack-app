@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist ".env" (
    echo ERROR: .env not found. Copy .env.example to .env and fill in Slack + Qiko values.
    pause
    exit /b 1
)

REM Read PORT from .env (default 3010)
set "PORT=3010"
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="PORT" (
        for /f "tokens=* delims= " %%p in ("%%b") do set "PORT=%%p"
    )
)

if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

REM ngrok: project bin, Laragon, then PATH
set "NGROK_EXE="
if exist ".ngrok-bin\ngrok.exe" set "NGROK_EXE=%~dp0.ngrok-bin\ngrok.exe"
if not defined NGROK_EXE if exist "C:\laragon\bin\ngrok\ngrok.exe" set "NGROK_EXE=C:\laragon\bin\ngrok\ngrok.exe"
if not defined NGROK_EXE (
    for /f "delims=" %%g in ('where ngrok 2^>nul') do (
        if not defined NGROK_EXE set "NGROK_EXE=%%g"
    )
)

if not defined NGROK_EXE (
    echo ERROR: ngrok.exe not found.
    echo   - Put ngrok in .ngrok-bin\ngrok.exe  ^(download from https://ngrok.com/download^)
    echo   - Or install Laragon ngrok, or add ngrok to PATH
    pause
    exit /b 1
)

echo Freeing port %PORT% if already in use...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
    taskkill /PID %%p /F >nul 2>&1
)
taskkill /IM ngrok.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting Qiko Slack app on port %PORT%...
start "qiko-slackapp" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo Waiting for server (npm run check + start may take ~15s)...
timeout /t 12 /nobreak >nul

echo Starting ngrok http %PORT%...
start "qiko-ngrok" cmd /k "cd /d ""%~dp0"" && ""%NGROK_EXE%"" http %PORT%"

echo Waiting for ngrok...
timeout /t 5 /nobreak >nul

echo.
echo === Ready ===
echo Local app:  http://localhost:%PORT%
echo Health:     http://localhost:%PORT%/health
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test-challenge.ps1" -Port "%PORT%"
echo.
powershell -NoProfile -Command "try { $port='%PORT%'; $t = (Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels').tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1; if ($t) { $u = $t.public_url; $addr = $t.config.addr; Write-Host ('ngrok:         ' + $u); Write-Host ('Slack events:  ' + $u + '/slack/events'); Write-Host ('ngrok target:  ' + $addr); if ($addr -notmatch (':' + $port + '$')) { Write-Host ''; Write-Host 'WARNING: ngrok port may not match app PORT!' -ForegroundColor Yellow } } else { Write-Host 'ngrok URL: open http://127.0.0.1:4040 or check qiko-ngrok window' } } catch { Write-Host 'ngrok URL: check qiko-ngrok window (API 4040 not ready yet)' }"
echo.
echo === Slack URL verification ===
echo 1. Copy "Slack events" URL into Event Subscriptions - Request URL
echo 2. SLACK_SIGNING_SECRET in .env MUST match Slack app - Basic Information - Signing Secret
echo 3. Click Retry ONLY while qiko-slackapp + qiko-ngrok windows are running
echo 4. If Verify still fails: use _start-cloudflared.bat instead of ngrok (free ngrok warning page)
echo.
echo Socket Mode OFF. Subscribe bot event: app_mention. Channel: /invite @LinkstarBot
echo.
echo Stop: run _stop.bat or close both cmd windows.
pause
