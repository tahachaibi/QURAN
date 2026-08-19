"""Fetch the Quran-tuned Whisper model in CTranslate2 format.

Tries community pre-converted CT2 repos first (fast, small download); falls
back to downloading tarteel-ai/whisper-base-ar-quran and converting locally
(installs transformers+torch on demand — several GB, one-time).
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "models", "ct2-quran")

# Community CTranslate2 conversions of tarteel-ai/whisper-base-ar-quran.
CT2_CANDIDATES = [
    "OdyAsh/faster-whisper-base-ar-quran",
]
SOURCE_REPO = "tarteel-ai/whisper-base-ar-quran"


def done() -> bool:
    return os.path.exists(os.path.join(OUT, "model.bin"))


def try_pretconverted() -> bool:
    from huggingface_hub import snapshot_download

    for repo in CT2_CANDIDATES:
        try:
            print(f"[model] trying pre-converted {repo} ...")
            snapshot_download(repo_id=repo, local_dir=OUT)
            if done():
                print(f"[model] got pre-converted model from {repo}")
                return True
        except Exception as e:  # noqa: BLE001 — any failure means fallback
            print(f"[model] {repo} unavailable: {e}")
    return False


def convert_from_source() -> None:
    print(f"[model] converting {SOURCE_REPO} locally (one-time, large)...")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "transformers", "torch",
         "--index-url", "https://download.pytorch.org/whl/cpu",
         "--extra-index-url", "https://pypi.org/simple"]
    )
    subprocess.check_call(
        [
            os.path.join(os.path.dirname(sys.executable), "ct2-transformers-converter"),
            "--model", SOURCE_REPO,
            "--output_dir", OUT,
            "--quantization", "int8",
            "--copy_files", "tokenizer.json", "preprocessor_config.json",
        ]
    )


if __name__ == "__main__":
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if done():
        print("[model] already present, nothing to do")
    elif not try_pretconverted():
        convert_from_source()
    if not done():
        sys.exit("[model] FAILED — model.bin not found after setup")
    print(f"[model] ready at {OUT}")
