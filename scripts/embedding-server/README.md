# Embedding server (TEI-compatible) for Apple Silicon or CUDA machines

Atlas Search needs a server that turns text into 1,024-dimension Qwen3-Embedding-0.6B vectors. The
preferred server is the Hugging Face text-embeddings-inference (TEI) container. Where that is not an
option (a Mac has no Apple-GPU TEI image) or is too slow (the CPU image took minutes per 32 documents),
`server.py` serves the same HTTP shape with PyTorch on `mps`, `cuda` or CPU.

**Status:** syntax-checked on 2026-11-08, not yet run against the model. Treat the first run as a test.

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/embedding-server/requirements.txt
export API_KEY="$(openssl rand -hex 24)"      # keep it; the builder and website need the same value
python scripts/embedding-server/server.py      # prints the device it chose (mps / cuda / cpu)
```

The first start downloads the model (about 1.2 GB). Bind stays on `127.0.0.1`; expose it only through an
authenticated tunnel if the website runs elsewhere.

## Check it (do this before building anything)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8080/embed -H 'Content-Type: application/json' -d '{"inputs":["test"]}'   # expect 401
curl -s -X POST localhost:8080/embed -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"inputs":["test"],"normalize":true}' | python3 -c 'import sys,json; print(len(json.load(sys.stdin)[0]))'   # expect 1024
```

Then compare a Thai query and its English paraphrase against an unrelated query, each sent as
`Instruct: <task>\nQuery:<text>` (see `lib/search/query-embedder.ts`). The Thai/English pair should score far
above the unrelated one (the TEI CPU run gave 0.83 against 0.16). If the vector length is not 1024, stop.

## Build the vector release

```bash
export EMBEDDING_SERVICE_URL=http://127.0.0.1:8080
export EMBEDDING_SERVICE_API_KEY="$API_KEY"
pnpm run search:vectors            # resumable; checkpoints in .cache/search-vector-checkpoints
pnpm run search:vectors -- --validate
```

Do not commit the generated release (`data/search/releases/`, `active-release.json`, `vectors.f32`) or any key.
