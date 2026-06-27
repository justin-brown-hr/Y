@echo off
title Yodobashi Checkout
cd /d "%~dp0"

if not exist dist\index.js (
  echo Run install-windows.bat first
  pause
  exit /b 1
)

echo Starting server...
echo Dashboard: http://localhost:3004/
echo.
node dist\index.js
