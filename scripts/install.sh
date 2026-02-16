#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="signage-agent"
APP_DIR="/opt/signage/agent"
BIN_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist/signage-agent"
ENV_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"
SERVICE_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config/signage-agent.service"
SERVICE_DEST="/etc/systemd/system/signage-agent.service"

if [[ ! -f "$BIN_SRC" ]]; then
  echo "Missing binary at $BIN_SRC"
  echo "Build first with: bun run build"
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root: sudo ./scripts/install.sh"
  exit 1
fi

install -d -m 0755 "$APP_DIR"
install -m 0755 "$BIN_SRC" "$APP_DIR/signage-agent"

if [[ -f "$ENV_SRC" ]]; then
  install -m 0600 "$ENV_SRC" "$APP_DIR/.env"
else
  echo "Warning: .env not found next to agent project."
  echo "Create $APP_DIR/.env manually before starting service."
fi

install -m 0644 "$SERVICE_SRC" "$SERVICE_DEST"

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl status --no-pager "$SERVICE_NAME" || true

echo "Installed $SERVICE_NAME"
