@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell.exe -NoExit -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-temp-preview.ps1" -StartLocal
