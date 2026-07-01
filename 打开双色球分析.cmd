@echo off
setlocal
cd /d "%~dp0"
start "ssq-local-server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ssq-local-server.ps1" -Port 0 -Open