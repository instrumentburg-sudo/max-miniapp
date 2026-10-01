#!/usr/bin/env bash
# Deploy MAX Mini App to NetAngels (h31.netangels.ru)
# Usage: ./deploy.sh [--api-only | --frontend-only | --cabinet-artifact | --backup-only | --handoff-only | --restore ARCHIVE]
set -euo pipefail

SSH_HOST="c50684@h31.netangels.ru"
REMOTE_ROOT="/home/c50684/instrumentburg.ru"
REMOTE_WEB="$REMOTE_ROOT/www/max-app"
REMOTE_API="$REMOTE_ROOT/www/max-api"
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
case "$mode" in all|--frontend-only|--api-only|--backup-only|--handoff-only|--restore) ;; *) echo "Unknown mode: $mode" >&2; exit 2 ;; esac

cd "$LOCAL_DIR"

# Build before any remote work. A failed build must not modify production.
if [[ "$mode" == "all" || "$mode" == "--frontend-only" ]]; then
  echo "==> Building frontend..."
  cd "$LOCAL_DIR"
  VITE_BASE_PATH=/max-app/ npm run build
fi

restore_archive="${2:-}"
archive_pattern='^/home/c50684/instrumentburg[.]ru/max-deploy-backups/snapshot-[A-Za-z0-9-]+[.]tar[.]gz$'
if [[ "$mode" == "--restore" && ! "$restore_archive" =~ $archive_pattern ]]; then
  echo 'Pass the exact BACKUP_ARCHIVE path printed by a successful deployment backup' >&2
  exit 2
fi

# Mandatory for every remote-write mode, even API-only and rollback. Archive BOTH
# live trees including dotfiles and server-only handlers; verify before any scp.
echo "==> Backing up and verifying complete current max-app + max-api..."
backup_output="$(ssh "$SSH_HOST" bash -s -- "$REMOTE_ROOT" backup < "$LOCAL_DIR/scripts/max-snapshot.sh")"
printf '%s\n' "$backup_output"
backup_archive="$(sed -n 's/^BACKUP_ARCHIVE=//p' <<< "$backup_output")"
[[ "$backup_archive" =~ $archive_pattern ]] || { echo 'Remote backup returned an invalid path' >&2; exit 1; }
echo "Restore command: ./deploy.sh --restore '$backup_archive'"

if [[ "$mode" == "--backup-only" ]]; then exit 0; fi
if [[ "$mode" == "--restore" ]]; then
  ssh "$SSH_HOST" bash -s -- "$REMOTE_ROOT" restore "$restore_archive" < "$LOCAL_DIR/scripts/max-snapshot.sh"
  exit 0
fi
if [[ "$mode" == "--handoff-only" ]]; then
  # Patch the CURRENT server PHP in place; never replace its dirty handlers here.
  ssh "$SSH_HOST" php /dev/stdin "$REMOTE_ROOT" "$backup_archive" < "$LOCAL_DIR/scripts/max-handoff.php"
  exit 0
fi

# ─── Frontend ───
if [[ "$mode" == "all" || "$mode" == "--frontend-only" ]]; then
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
