#!/usr/bin/env bash
# Setup systemd user service for MAX Mini App API on NetAngels
# Run this ONCE on the server after first deploy
set -euo pipefail

REMOTE_API="/home/c50684/instrumentburg.ru/max-api"
SERVICE_DIR="$HOME/.config/systemd/user"

mkdir -p "$SERVICE_DIR"

cat > "$SERVICE_DIR/max-miniapp-api.service" << 'EOF'
[Unit]
Description=MAX Mini App API (FastAPI)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/c50684/instrumentburg.ru/max-api
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=5
Environment=LIVESKLAD_LOGIN=%LIVESKLAD_LOGIN%
Environment=LIVESKLAD_PASSWORD=%LIVESKLAD_PASSWORD%
Environment=TELEGRAM_BOT_TOKEN=%TELEGRAM_BOT_TOKEN%
Environment=TELEGRAM_IB_TASKS_CHAT_ID=-5208079994

[Install]
WantedBy=default.target
EOF

echo "Service file created at $SERVICE_DIR/max-miniapp-api.service"
echo ""
echo "IMPORTANT: Edit the service file and replace %LIVESKLAD_LOGIN%, etc. with real values"
echo "Then run:"
echo "  systemctl --user daemon-reload"
echo "  systemctl --user enable max-miniapp-api"
echo "  systemctl --user start max-miniapp-api"
echo "  systemctl --user status max-miniapp-api"
echo ""
echo "Also enable lingering so it runs without login:"
echo "  sudo loginctl enable-linger c50684"
