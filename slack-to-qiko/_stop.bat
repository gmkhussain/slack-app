@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "ENV_FILE=.env"
if not exist ".env" if exist "..\.env" set "ENV_FILE=..\.env"
set "PORT=3010"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
    if /i "%%a"=="PORT" (
        for /f "tokens=* delims= " %%p in ("%%b") do set "PORT=%%p"
    )
)

echo Stopping ngrok...
taskkill /IM ngrok.exe /F >nul 2>&1

echo Stopping processes on port %PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
    echo   PID %%p
    taskkill /PID %%p /F >nul 2>&1
)

echo Done. Close slack-to-qiko / qiko-ngrok windows if still open.
timeout /t 2 /nobreak >nul
