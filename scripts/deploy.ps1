# Deploy bot trên Windows VPS — dừng PM2 trước để tránh EPERM khi prisma generate
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "==> Stopping bot (unlock Prisma DLL)..." -ForegroundColor Cyan
pm2 stop bot 2>$null
pm2 delete bot 2>$null
Start-Sleep -Seconds 2

Write-Host "==> Building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Starting bot..." -ForegroundColor Cyan
pm2 start ecosystem.config.cjs
pm2 save

Write-Host "==> Done. Logs:" -ForegroundColor Green
pm2 logs bot --lines 15 --nostream
