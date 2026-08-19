#!/usr/bin/env bash
# One-time setup for the Quran ASR server (Tarteel Whisper fine-tune).
# Run: bash server/setup.sh
set -e
cd "$(dirname "$0")"

echo "== Creating Python environment =="
python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -q faster-whisper "fastapi" "uvicorn[standard]" python-multipart huggingface_hub

echo "== Fetching Quran-tuned Whisper model =="
.venv/bin/python download_model.py

echo ""
echo "== Done. scripts/dev.sh will now start the ASR server automatically. =="
