@echo off
setlocal
cd /d "%~dp0"
set "PORT=8737"
start "ssq-local-server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssq-local-server.ps1" -Port %PORT%
start "" "http://127.0.0.1:%PORT%/ssq-analysis.html"