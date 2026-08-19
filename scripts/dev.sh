#!/usr/bin/env bash
# One-command dev server for Codespaces:
# - Cloudflare quick tunnel for Metro (port 8081)
# - If server/.venv exists (bash server/setup.sh): starts the Quran ASR
#   server (port 8000) + its own tunnel, and injects its URL into the app
#   via EXPO_PUBLIC_ASR_URL so the 🎯 Precise engine toggle appears.
# Ctrl+C stops everything.
set -e
cd "$(dirname "$0")/.."

if [ ! -x "$HOME/cloudflared" ]; then
  echo "Downloading cloudflared..."
  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O "$HOME/cloudflared"
  chmod +x "$HOME/cloudflared"
fi

PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

tunnel_url() { # $1=logfile — wait for a trycloudflare URL to appear
  local url=""
  for _ in $(seq 1 30); do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$1" | head -1 || true)
    [ -n "$url" ] && break
    sleep 1
  done
  echo "$url"
}

# ── Metro tunnel ────────────────────────────────────────────────────────────
METRO_LOG=/tmp/cloudflared-metro.log
rm -f "$METRO_LOG"
"$HOME/cloudflared" tunnel --url http://localhost:8081 >"$METRO_LOG" 2>&1 &
PIDS+=($!)
echo "Waiting for Metro tunnel URL..."
METRO_URL=$(tunnel_url "$METRO_LOG")
[ -z "$METRO_URL" ] && { echo "Metro tunnel failed:"; cat "$METRO_LOG"; exit 1; }

# ── Quran ASR server (optional — needs server/setup.sh once) ───────────────
ASR_URL=""
if [ -x server/.venv/bin/python ]; then
  echo "Starting Quran ASR server (Tarteel Whisper)..."
  ASR_LOG=/tmp/quran-asr.log
  (cd server && .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 >"$ASR_LOG" 2>&1) &
  PIDS+=($!)
  CF_ASR_LOG=/tmp/cloudflared-asr.log
  rm -f "$CF_ASR_LOG"
  "$HOME/cloudflared" tunnel --url http://localhost:8000 >"$CF_ASR_LOG" 2>&1 &
  PIDS+=($!)
  ASR_URL=$(tunnel_url "$CF_ASR_LOG")
  if [ -n "$ASR_URL" ]; then
    echo "Waiting for the ASR model to load..."
    for _ in $(seq 1 60); do
      if grep -q "model ready" "$ASR_LOG" 2>/dev/null; then break; fi
      sleep 2
    done
  fi
else
  echo "(No ASR server set up — run 'bash server/setup.sh' once to enable 🎯 Precise mode)"
fi

echo ""
echo "=============================================="
echo "  Metro:  $METRO_URL"
[ -n "$ASR_URL" ] && echo "  ASR:    $ASR_URL  (🎯 Precise mode enabled)"
echo "  Scan the QR code below with your phone."
echo "=============================================="
echo ""

EXPO_PUBLIC_ASR_URL="$ASR_URL" EXPO_PACKAGER_PROXY_URL="$METRO_URL" npx expo start
