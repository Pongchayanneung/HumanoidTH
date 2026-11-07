"""Minimal embedding server that speaks the same HTTP shape as text-embeddings-inference (TEI).

Use it on a machine where the TEI container is not an option or is too slow, for example a Mac
with Apple Silicon (PyTorch "mps" device) or any CUDA machine without Docker. The Atlas Search
builder and website talk to `POST /embed` with `{"inputs": [...], "normalize": true}` and expect
a JSON array of float arrays back; this server provides exactly that, plus `GET /health`.

STATUS: written on 2026-11-08, syntax-checked only. It has not been run against the model yet.
First run: confirm the returned vector length is 1024 and compare a Thai/English pair (see README.md).

Environment variables
  API_KEY               required bearer token (server refuses to start without one unless ALLOW_NO_KEY=1)
  EMBED_MODEL_ID        default Qwen/Qwen3-Embedding-0.6B
  EMBED_MODEL_REVISION  default 97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3 (pinned commit)
  EMBED_MAX_TOKENS      default 512 (longer inputs are truncated, like TEI --auto-truncate)
  HOST / PORT           default 127.0.0.1 / 8080
"""
import os
import sys
import threading

import torch
import uvicorn
from fastapi import Body, FastAPI, Header, HTTPException
from sentence_transformers import SentenceTransformer

MODEL_ID = os.environ.get("EMBED_MODEL_ID", "Qwen/Qwen3-Embedding-0.6B")
REVISION = os.environ.get("EMBED_MODEL_REVISION", "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3")
API_KEY = os.environ.get("API_KEY", "")
MAX_TOKENS = int(os.environ.get("EMBED_MAX_TOKENS", "512"))
MAX_CLIENT_BATCH = 64  # matches the TEI flag used elsewhere (--max-client-batch-size 64)
COMPUTE_BATCH = int(os.environ.get("EMBED_COMPUTE_BATCH", "16"))

if not API_KEY and os.environ.get("ALLOW_NO_KEY") != "1":
    sys.exit("API_KEY is required (set ALLOW_NO_KEY=1 only for a loopback-only experiment).")

if torch.cuda.is_available():
    DEVICE = "cuda"
elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
    DEVICE = "mps"
else:
    DEVICE = "cpu"

# Qwen3-Embedding is a last-token-pooling model: the model card requires left padding.
model = SentenceTransformer(
    MODEL_ID,
    revision=REVISION,
    device=DEVICE,
    model_kwargs={"torch_dtype": torch.float16} if DEVICE == "cuda" else {},
    tokenizer_kwargs={"padding_side": "left"},
)
model.max_seq_length = MAX_TOKENS
lock = threading.Lock()  # one batch at a time on the accelerator

app = FastAPI()


def check_key(authorization: str) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "revision": REVISION, "device": DEVICE}


@app.post("/embed")
def embed(payload: dict = Body(...), authorization: str = Header(default="")):
    check_key(authorization)
    inputs = payload.get("inputs")
    if isinstance(inputs, str):
        inputs = [inputs]
    if not isinstance(inputs, list) or not inputs or not all(isinstance(item, str) for item in inputs):
        raise HTTPException(status_code=422, detail="inputs must be a non-empty list of strings")
    if len(inputs) > MAX_CLIENT_BATCH:
        raise HTTPException(status_code=413, detail=f"at most {MAX_CLIENT_BATCH} inputs per request")
    with lock:
        vectors = model.encode(
            inputs,
            batch_size=COMPUTE_BATCH,
            normalize_embeddings=bool(payload.get("normalize", True)),
            convert_to_numpy=True,
            show_progress_bar=False,
        )
    return vectors.astype("float32").tolist()


if __name__ == "__main__":
    print(f"Serving {MODEL_ID}@{REVISION[:7]} on {DEVICE}", flush=True)
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8080")), log_level="warning")
