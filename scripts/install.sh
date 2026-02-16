#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="signage-agent"
APP_DIR="/opt/signage/agent"
BIN_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist/signage-agent"
ENV_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"
SERVICE_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config/signage-agent.service"
SERVICE_DEST="/etc/systemd/system/signage-agent.service"
TARGET_USER="${SUDO_USER:-pi}"
TARGET_GROUP="$(id -gn "$TARGET_USER" 2>/dev/null || true)"
MEDIA_DIR="/opt/signage/media"

if [[ -z "$TARGET_GROUP" ]]; then
  echo "Could not resolve group for user: $TARGET_USER"
  exit 1
fi

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

  MEDIA_DIR_FROM_ENV="$(sed -nE 's/^[[:space:]]*MEDIA_DIR[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\1/p' "$ENV_SRC" | tail -n1)"
  if [[ -n "${MEDIA_DIR_FROM_ENV:-}" ]]; then
    MEDIA_DIR_FROM_ENV="${MEDIA_DIR_FROM_ENV%\"}"
    MEDIA_DIR_FROM_ENV="${MEDIA_DIR_FROM_ENV#\"}"
    MEDIA_DIR_FROM_ENV="${MEDIA_DIR_FROM_ENV%\'}"
    MEDIA_DIR_FROM_ENV="${MEDIA_DIR_FROM_ENV#\'}"
    if [[ -n "$MEDIA_DIR_FROM_ENV" ]]; then
      MEDIA_DIR="$MEDIA_DIR_FROM_ENV"
    fi
  fi
else
  echo "Warning: .env not found next to agent project."
  echo "Create $APP_DIR/.env manually before starting service."
fi

chown -R "$TARGET_USER:$TARGET_GROUP" "$APP_DIR"
if [[ "$MEDIA_DIR" != /* ]]; then
  MEDIA_DIR="$APP_DIR/$MEDIA_DIR"
fi
install -d -m 0755 "$MEDIA_DIR"
chown -R "$TARGET_USER:$TARGET_GROUP" "$MEDIA_DIR"

sed \
  -e "s/__SERVICE_USER__/$TARGET_USER/g" \
  -e "s/__SERVICE_GROUP__/$TARGET_GROUP/g" \
  "$SERVICE_SRC" > "$SERVICE_DEST"
chmod 0644 "$SERVICE_DEST"

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl status --no-pager "$SERVICE_NAME" || true

echo "Installed $SERVICE_NAME"
