#!/usr/bin/env bash
# One-time: convert tarteel-ai/whisper-base-ar-quran to whisper.cpp ggml
# format (quantized q8_0) for ON-DEVICE recognition in the app.
# Output: server/models/ggml-quran.bin  (~85MB)
# Run: bash server/convert-ggml.sh
set -e
cd "$(dirname "$0")"

OUT="models/ggml-quran.bin"
if [ -f "$OUT" ]; then
  echo "== $OUT already exists, nothing to do =="
  exit 0
fi

if [ ! -x .venv/bin/python ]; then
  echo "Run 'bash server/setup.sh' first."
  exit 1
fi

echo "== Installing conversion tools (torch CPU — large, one-time) =="
.venv/bin/pip install -q transformers "torch" --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple

echo "== Downloading original Tarteel checkpoint =="
.venv/bin/python - << 'EOF'
from huggingface_hub import snapshot_download
snapshot_download("tarteel-ai/whisper-base-ar-quran", local_dir="models/hf-src")
print("checkpoint ready")
EOF

echo "== Fetching whisper.cpp (converter + quantizer) =="
if [ ! -d /tmp/whisper.cpp ]; then
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp
fi
if [ ! -d /tmp/openai-whisper ]; then
  git clone --depth 1 https://github.com/openai/whisper /tmp/openai-whisper
fi

echo "== Converting to ggml (f16) =="
.venv/bin/python /tmp/whisper.cpp/models/convert-h5-to-ggml.py \
  models/hf-src /tmp/openai-whisper models

F16=models/ggml-model.bin
[ -f "$F16" ] || { echo "conversion failed — $F16 missing"; exit 1; }

echo "== Building quantizer =="
# Newer whisper.cpp names the tool whisper-quantize; older ones quantize.
cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON >/dev/null || true
cmake --build /tmp/whisper.cpp/build -j --target whisper-quantize >/dev/null 2>&1 \
  || cmake --build /tmp/whisper.cpp/build -j --target quantize >/dev/null 2>&1 \
  || true

QUANTIZE=$(find /tmp/whisper.cpp/build \( -name whisper-quantize -o -name quantize \) -type f -perm -u+x | head -1)
if [ -n "$QUANTIZE" ]; then
  echo "== Quantizing to q8_0 =="
  "$QUANTIZE" "$F16" "$OUT" q8_0
  rm -f "$F16"
else
  echo "== Quantizer build failed — shipping f16 (bigger but works) =="
  mv "$F16" "$OUT"
fi

ls -lh "$OUT"
echo "== Done. The app downloads this via the dev server on first Precise use. =="
