#!/usr/bin/env bash
# One-command dev server for Codespaces:
# starts a Cloudflare quick tunnel, extracts its URL, and launches Metro
# with EXPO_PACKAGER_PROXY_URL pointed at it. Ctrl+C stops both.
set -e
cd "$(dirname "$0")/.."

if [ ! -x "$HOME/cloudflared" ]; then
  echo "Downloading cloudflared..."
  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O "$HOME/cloudflared"
  chmod +x "$HOME/cloudflared"
fi

LOG=/tmp/cloudflared.log
rm -f "$LOG"
"$HOME/cloudflared" tunnel --url http://localhost:8081 >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null' EXIT

echo "Waiting for tunnel URL..."
URL=""
for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Tunnel failed to start — log follows:"
  cat "$LOG"
  exit 1
fi

echo ""
echo "=============================================="
echo "  Tunnel ready: $URL"
echo "  Scan the QR code below with your phone."
echo "=============================================="
echo ""

EXPO_PACKAGER_PROXY_URL="$URL" npx expo start
