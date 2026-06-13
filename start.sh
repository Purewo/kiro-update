#!/bin/sh
# Start kiro-web in foreground.
# Defaults to safe high ports (29080/29081) so they don't conflict with local
# Electron Manager / kiro-go on standard ports.
set -e
cd "$(dirname "$0")/server"
export PROXY_PORT="${PROXY_PORT:-29080}"
export ADMIN_PORT="${ADMIN_PORT:-29081}"
export PROXY_HOST="${PROXY_HOST:-127.0.0.1}"
export ADMIN_HOST="${ADMIN_HOST:-127.0.0.1}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"
export KIRO_DATA_DIR="${KIRO_DATA_DIR:-$(cd .. && pwd)/.local-data}"
# Default outbound proxy for AWS Kiro backend.
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:17893}"
export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:17893}"
echo "==============================="
echo " Kiro Web"
echo "  Admin UI:    http://${ADMIN_HOST}:${ADMIN_PORT}"
echo "  Reverse Proxy: http://${PROXY_HOST}:${PROXY_PORT}"
echo "  Data dir:    ${KIRO_DATA_DIR}"
echo "  Admin pass:  ${ADMIN_PASSWORD}"
echo "==============================="
exec npm run start
