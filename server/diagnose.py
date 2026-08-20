"""Decisive model-quality test.

Transcribes reference recitation (Alafasy, Al-Fatiha, from the same CDN the
app streams audio from) with the local model. Clean output => model is fine
and the phone's audio is the problem. Garbled output => the model is not the
real Tarteel fine-tune; re-run setup with FORCE_CONVERT=1.

Also transcribes /tmp/last-chunk.m4a (the app's most recent chunk, saved by
main.py) when present, to compare phone audio against reference audio.

Run: server/.venv/bin/python server/diagnose.py
"""
import os
import urllib.request

from faster_whisper import WhisperModel

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(HERE, "models", "ct2-quran")

print("== model files ==")
for f in sorted(os.listdir(MODEL_DIR)):
    size = os.path.getsize(os.path.join(MODEL_DIR, f))
    print(f"  {f}  {size/1e6:.1f}MB")

model = WhisperModel(MODEL_DIR, device="cpu", compute_type="int8")

CASES = [
    (1, "بسم الله الرحمن الرحيم"),
    (2, "الحمد لله رب العالمين"),
    (3, "الرحمن الرحيم"),
    (4, "مالك يوم الدين"),
]

print("\n== reference recitation (Alafasy) ==")
for n, expected in CASES:
    path = f"/tmp/diag-{n}.mp3"
    if not os.path.exists(path):
        urllib.request.urlretrieve(
            f"https://cdn.islamic.network/quran/audio/128/ar.alafasy/{n}.mp3",
            path,
        )
    segments, info = model.transcribe(path, language="ar", beam_size=2)
    text = " ".join(s.text.strip() for s in segments).strip()
    print(f"  expected: {expected}")
    print(f"  got:      {text}   ({info.duration:.1f}s)\n")

chunk = "/tmp/last-chunk.m4a"
if os.path.exists(chunk):
    print("== last phone chunk ==")
    print(f"  size: {os.path.getsize(chunk)/1024:.0f}KB")
    segments, info = model.transcribe(chunk, language="ar", beam_size=2)
    text = " ".join(s.text.strip() for s in segments).strip()
    print(f"  got: {text}   ({info.duration:.1f}s)")
else:
    print("== no /tmp/last-chunk.m4a yet (recite once in Precise mode first) ==")
