@echo off
title Yodobashi Checkout - Install
cd /d "%~dp0"

echo === Yodobashi Checkout - Windows Install ===
echo.

where node >nul 2>&1 || (
  echo ERROR: Node.js not found. Install Node 20+ from https://nodejs.org
  pause
  exit /b 1
)

echo Installing npm packages...
call npm install
if errorlevel 1 goto fail

echo Installing Chromium for browser login...
call npx playwright install chromium
if errorlevel 1 goto fail

echo Building...
call npm run build
if errorlevel 1 goto fail

if not exist .env (
  copy .env.example .env
  echo Created .env - please edit API_TOKEN, ACCOUNTS, PROXIES, DISCORD_WEBHOOK_URL
)

echo.
echo === Install complete ===
echo 1. Edit .env with your settings
echo 2. Run test-login.bat to verify login
echo 3. Run start-windows.bat or pm2 start ecosystem.config.cjs
echo.
pause
exit /b 0

:fail
echo Install failed.
pause
exit /b 1
