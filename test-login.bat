@echo off
title Yodobashi Checkout - Login Test
cd /d "%~dp0"

if not exist dist\index.js (
  echo Run install-windows.bat first
  pause
  exit /b 1
)

echo Testing Yodobashi login only...
echo Uses ACCOUNTS and PROXIES from .env
echo.
call npx tsx scripts/test-login.ts
echo.
pause
