#!/usr/bin/env bash
# Fix the ggml header of models/ggml-quran.bin in place.
#
# whisper.cpp's convert-h5-to-ggml.py writes config.json's "max_length"
# (a TEXT-GENERATION setting, 1024 in the Tarteel checkpoint) as n_text_ctx,
# but the real decoder context of a Whisper base model is 448 — so every
# whisper.cpp refuses the file:
#   tensor 'decoder.positional_embedding' has wrong size in model file
#   shape: [512, 448, 1], expected: [512, 1024, 1]
# The weights are fine; only the 4-byte n_text_ctx field (offset 24) is wrong.
# Run: bash server/fix-ggml-header.sh
set -e
cd "$(dirname "$0")"

MODEL="models/ggml-quran.bin"
[ -f "$MODEL" ] || { echo "missing $MODEL — run: bash server/convert-ggml.sh"; exit 1; }

python3 - "$MODEL" << 'EOF'
import struct, sys

path = sys.argv[1]
with open(path, "r+b") as f:
    magic = f.read(4)
    assert magic == b"lmgg", f"not a ggml file (magic {magic!r})"
    f.seek(24)  # magic + 5 int32 hparams -> n_text_ctx
    (val,) = struct.unpack("<i", f.read(4))
    print(f"n_text_ctx in header: {val}")
    if val == 448:
        print("already correct — nothing to do")
    elif val == 1024:
        f.seek(24)
        f.write(struct.pack("<i", 448))
        print("patched to 448")
    else:
        sys.exit(f"unexpected n_text_ctx {val} — refusing to touch the file")
EOF

echo "== Done. Verify with: bash server/test-ggml.sh =="
