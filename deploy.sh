#!/usr/bin/env bash
# Deploy MAX Mini App to NetAngels (h31.netangels.ru)
# Usage: ./deploy.sh [--api-only | --frontend-only]
set -euo pipefail

SSH_HOST="c50684@h31.netangels.ru"
REMOTE_WEB="/home/c50684/instrumentburg.ru/www/max-app"
REMOTE_API="/home/c50684/instrumentburg.ru/www/max-api"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

mode="${1:-all}"

# ─── Frontend ───
if [[ "$mode" == "all" || "$mode" == "--frontend-only" ]]; then
  echo "==> Building frontend..."
  cd "$LOCAL_DIR"
  npm run build

  echo "==> Deploying frontend to $SSH_HOST:$REMOTE_WEB/"
  ssh "$SSH_HOST" "mkdir -p $REMOTE_WEB"
  scp -r dist/* "$SSH_HOST:$REMOTE_WEB/"
  echo "    Frontend deployed."
fi

# ─── PHP API ───
if [[ "$mode" == "all" || "$mode" == "--api-only" ]]; then
  echo "==> Deploying PHP API to $SSH_HOST:$REMOTE_API/"
  ssh "$SSH_HOST" "mkdir -p $REMOTE_API"
  scp api-php/index.php api-php/.htaccess "$SSH_HOST:$REMOTE_API/"
  echo "    PHP API deployed."

  echo "==> Verifying API health..."
  sleep 1
  curl -sf https://instrumentburg.ru/max-api/health && echo "" || echo "WARNING: health check failed"
fi

echo ""
echo "Done! App: https://instrumentburg.ru/max-app/"
echo "API:  https://instrumentburg.ru/max-api/health"
