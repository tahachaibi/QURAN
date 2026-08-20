"""Quran recitation ASR server — Tarteel's open-sourced Whisper fine-tune.

Runs the tarteel-ai/whisper-base-ar-quran model (converted to CTranslate2
for fast CPU inference via faster-whisper). The app records short audio
chunks and POSTs them here; the transcript feeds the same alignment engine
used with the on-device recognizer.

Endpoints:
  GET  /health      -> {"ok": true, "model": "..."}
  POST /transcribe  -> multipart form: file=<audio chunk>, hint=<expected text>
                       returns {"text": "..."}

The optional `hint` (the next expected words of the recitation) is passed as
Whisper's initial_prompt, biasing decoding toward the verse being recited.
"""
import os
import tempfile
import time

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

MODEL_DIR = os.environ.get(
    "MODEL_DIR",
    os.path.join(os.path.dirname(__file__), "models", "ct2-quran"),
)

app = FastAPI(title="quran-asr")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

print(f"[quran-asr] loading model from {MODEL_DIR} ...")
model = WhisperModel(MODEL_DIR, device="cpu", compute_type="int8")
print("[quran-asr] model ready")


@app.get("/health")
def health():
    return {"ok": True, "model": os.path.basename(MODEL_DIR)}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), hint: str = Form("")):
    suffix = os.path.splitext(file.filename or "chunk.m4a")[1] or ".m4a"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name
    try:
        t0 = time.time()
        segments, info = model.transcribe(
            path,
            language="ar",
            task="transcribe",
            beam_size=2,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=hint or None,
            # VAD off: recitation elongations (madd) look like silence to VAD
            # and get chopped, garbling the transcript.
            vad_filter=False,
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        dt = time.time() - t0
        print(
            f"[asr] {info.duration:.1f}s audio -> {dt:.1f}s infer | "
            f"hint={'y' if hint else 'n'} | {text}",
            flush=True,
        )
        return {"text": text}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
