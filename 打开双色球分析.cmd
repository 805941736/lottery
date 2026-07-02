@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0app\launch.html"
start "ssq-local-server" /min "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\ssq-local-server.ps1" -Port 8765