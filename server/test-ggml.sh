#!/usr/bin/env bash
# Verify server/models/ggml-quran.bin loads and transcribes with whisper.cpp
# v1.9.1 — the EXACT version whisper.rn 0.7.2 bundles in the app. If this
# passes, the model file is good and any phone failure is a transfer or
# runtime problem; if it fails here, the conversion itself is incompatible.
# Run: bash server/test-ggml.sh
set -e
cd "$(dirname "$0")"

MODEL="models/ggml-quran.bin"
[ -f "$MODEL" ] || { echo "missing $MODEL — run: bash server/convert-ggml.sh"; exit 1; }

echo "== Model file =="
ls -l "$MODEL"
sha256sum "$MODEL"
echo -n "first bytes (must be 'lmgg'): "
head -c 4 "$MODEL"
echo

W=/tmp/wcpp-191
if [ ! -x "$W/build/bin/whisper-cli" ]; then
  echo "== Building whisper.cpp v1.9.1 (one-time, a few minutes) =="
  [ -d "$W" ] || git clone --depth 1 --branch v1.9.1 \
    https://github.com/ggerganov/whisper.cpp "$W"
  cmake -S "$W" -B "$W/build" -DCMAKE_BUILD_TYPE=Release \
    -DWHISPER_BUILD_TESTS=OFF >/dev/null
  cmake --build "$W/build" -j --target whisper-cli >/dev/null
fi

echo "== Loading + transcribing the bundled sample with v1.9.1 =="
"$W/build/bin/whisper-cli" -m "$MODEL" -f "$W/samples/jfk.wav" -l ar -t 4 2>&1 \
  | grep -E "whisper_|error|failed|\[" | tail -25

echo
echo "== If you see transcribed text above (Arabic-ish output for an English"
echo "== clip is EXPECTED — the model only knows Quranic Arabic), the model"
echo "== file is fully compatible with the app. =="
