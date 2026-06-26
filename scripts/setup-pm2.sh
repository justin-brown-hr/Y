#!/usr/bin/env bash
# Install PM2 and start Yodobashi checkout as a background service.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building..."
npm run build

echo "==> Installing PM2 (global)..."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

mkdir -p logs

echo "==> Starting with PM2..."
pm2 delete yodobashi-checkout 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "Done. Commands:"
echo "  pm2 status"
echo "  pm2 logs yodobashi-checkout"
echo "  pm2 restart yodobashi-checkout"
echo ""
echo "Enable boot on startup:"
echo "  pm2 startup"
echo "  (run the command it prints, then: pm2 save)"
