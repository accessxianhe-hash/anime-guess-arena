#!/usr/bin/env bash
set -euo pipefail

# Install or update ECS auto-sync runtime files from repository sources.
# Run this on the ECS host.

REPO_APP_DIR="${REPO_APP_DIR:-/opt/anime-guess-arena/app}"
TARGET_BIN_DIR="${TARGET_BIN_DIR:-/opt/anime-guess-arena/bin}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

SCRIPT_SRC="$REPO_APP_DIR/scripts/server-sync/deploy-from-github.sh"
SERVICE_SRC="$REPO_APP_DIR/scripts/server-sync/anime-sync-deploy.service"
TIMER_SRC="$REPO_APP_DIR/scripts/server-sync/anime-sync-deploy.timer"

SCRIPT_DST="$TARGET_BIN_DIR/deploy-from-github.sh"
SERVICE_DST="$SYSTEMD_DIR/anime-sync-deploy.service"
TIMER_DST="$SYSTEMD_DIR/anime-sync-deploy.timer"

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

if [ ! -f "$SCRIPT_SRC" ] || [ ! -f "$SERVICE_SRC" ] || [ ! -f "$TIMER_SRC" ]; then
  echo "Missing source files under $REPO_APP_DIR/scripts/server-sync"
  exit 1
fi

install -d -m 755 "$TARGET_BIN_DIR"
install -m 755 "$SCRIPT_SRC" "$SCRIPT_DST"
install -m 644 "$SERVICE_SRC" "$SERVICE_DST"
install -m 644 "$TIMER_SRC" "$TIMER_DST"

systemctl daemon-reload
systemctl enable --now anime-sync-deploy.timer
systemctl start anime-sync-deploy.service

systemctl status anime-sync-deploy.timer --no-pager -l
systemctl status anime-sync-deploy.service --no-pager -l || true

echo "Install finished."
