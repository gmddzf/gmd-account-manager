@echo off
setlocal
set "APP=%~dp0.runtime\cockpit-tools.exe"

if not exist "%APP%" (
  echo GMD 账号管理 executable not found:
  echo %APP%
  pause
  exit /b 1
)

start "" "%APP%"
exit /b 0
