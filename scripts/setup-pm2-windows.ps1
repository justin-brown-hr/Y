# Windows PM2 setup for Yodobashi checkout
# Run in PowerShell (as Administrator for auto-start on boot):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\setup-pm2-windows.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "==> Building..." -ForegroundColor Cyan
npm run build

Write-Host "==> Installing PM2..." -ForegroundColor Cyan
npm install -g pm2

if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

Write-Host "==> Starting app..." -ForegroundColor Cyan
pm2 delete yodobashi-checkout 2>$null
pm2 start ecosystem.config.cjs
pm2 save

Write-Host ""
Write-Host "Running. Useful commands:" -ForegroundColor Green
Write-Host "  pm2 status"
Write-Host "  pm2 logs yodobashi-checkout"
Write-Host "  pm2 restart yodobashi-checkout"
Write-Host ""
Write-Host "NOTE: pm2 startup does NOT work on Windows." -ForegroundColor Yellow
Write-Host "For auto-start after reboot, run this script as Administrator" -ForegroundColor Yellow
Write-Host "or see CLIENT-HANDOFF.md section 'Windows VPS'." -ForegroundColor Yellow

$installStartup = Read-Host "Install Windows auto-start now? (y/N)"
if ($installStartup -eq "y" -or $installStartup -eq "Y") {
    Write-Host "==> Installing pm2-windows-startup..." -ForegroundColor Cyan
    npm install -g pm2-windows-startup
    pm2-startup install
    pm2 save
    Write-Host "Auto-start installed. Reboot to verify." -ForegroundColor Green
}
