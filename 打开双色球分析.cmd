@echo off
setlocal
cd /d "%~dp0"
start "ssq-local-server" /min "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\ssq-local-server.ps1" -Port 0 -Open