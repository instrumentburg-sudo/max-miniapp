#!/usr/bin/env bash
# Deploy MAX Mini App to NetAngels (h31.netangels.ru)
# Usage: ./deploy.sh [--api-only | --frontend-only]
set -euo pipefail

SSH_HOST="c50684@h31.netangels.ru"
REMOTE_WEB="/home/c50684/instrumentburg.ru/www/max-app"
REMOTE_API="/home/c50684/instrumentburg.ru/max-api"
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

# ─── API ───
if [[ "$mode" == "all" || "$mode" == "--api-only" ]]; then
  echo "==> Deploying API to $SSH_HOST:$REMOTE_API/"
  ssh "$SSH_HOST" "mkdir -p $REMOTE_API"
  scp api/main.py api/livesklad_client.py api/max_auth.py api/requirements.txt "$SSH_HOST:$REMOTE_API/"

  echo "==> Installing API dependencies..."
  ssh "$SSH_HOST" "cd $REMOTE_API && pip3 install --user -r requirements.txt -q"

  echo "==> Restarting API service..."
  ssh "$SSH_HOST" "systemctl --user restart max-miniapp-api 2>/dev/null || echo 'Service not set up yet — run setup-service.sh first'"
  echo "    API deployed."
fi

echo ""
echo "Done! App: https://instrumentburg.ru/max-app/"
echo "API:  https://instrumentburg.ru/max-api/health"
