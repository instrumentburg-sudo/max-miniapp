#!/usr/bin/env bash
# Deploy MAX Mini App to NetAngels (h31.netangels.ru)
# Usage: ./deploy.sh [--api-only | --frontend-only | --cabinet-artifact]
set -euo pipefail

SSH_HOST="c50684@h31.netangels.ru"
REMOTE_WEB="/home/c50684/instrumentburg.ru/www/max-app"
REMOTE_API="/home/c50684/instrumentburg.ru/www/max-api"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

mode="${1:-all}"

# Local artifact only. The self-service deploy copies it after monorepo rollout.
if [[ "$mode" == "--cabinet-artifact" ]]; then
  cd "$LOCAL_DIR"
  VITE_BASE_PATH=/cabinet/ npm run build
  cp deploy/cabinet.htaccess dist-cabinet/.htaccess
  git rev-parse HEAD > dist-cabinet/.build-sha
  node --input-type=module -e 'import fs from "node:fs"; fs.writeFileSync("dist-cabinet/version.json", JSON.stringify({sha:fs.readFileSync("dist-cabinet/.build-sha","utf8").trim(),base:"/cabinet/"})+"\n")'
  rm dist-cabinet/.build-sha
  echo "Cabinet artifact: $LOCAL_DIR/dist-cabinet"
  exit 0
fi
case "$mode" in all|--frontend-only|--api-only) ;; *) echo "Unknown mode: $mode" >&2; exit 2 ;; esac

# ─── Frontend ───
if [[ "$mode" == "all" || "$mode" == "--frontend-only" ]]; then
  echo "==> Building frontend..."
  cd "$LOCAL_DIR"
  VITE_BASE_PATH=/max-app/ npm run build

  echo "==> Deploying frontend to $SSH_HOST:$REMOTE_WEB/"
  ssh "$SSH_HOST" "mkdir -p $REMOTE_WEB"
  scp -r dist/* "$SSH_HOST:$REMOTE_WEB/"
  # .htaccess не попадает в dist (Vite его не собирает) и не матчится dist/*,
  # поэтому выкладываем отдельно. Без него ломается SPA-фолбэк на /link,
  # /orders и кеш-политика: index.html залипает в WebView со старым бандлом.
  scp deploy/max-app.htaccess "$SSH_HOST:$REMOTE_WEB/.htaccess"
  echo "    Frontend deployed."
fi

# ─── PHP API ───
if [[ "$mode" == "all" || "$mode" == "--api-only" ]]; then
  echo "==> Deploying PHP API to $SSH_HOST:$REMOTE_API/"
  ssh "$SSH_HOST" "mkdir -p $REMOTE_API"
  scp api-php/index.php api-php/.htaccess api-php/max-ru-ca.pem "$SSH_HOST:$REMOTE_API/"
  echo "    PHP API deployed."

  echo "==> Verifying API health..."
  sleep 1
  curl -sf https://instrumentburg.ru/max-api/health && echo "" || echo "WARNING: health check failed"
fi

echo ""
echo "Done! App: https://instrumentburg.ru/max-app/"
echo "API:  https://instrumentburg.ru/max-api/health"
