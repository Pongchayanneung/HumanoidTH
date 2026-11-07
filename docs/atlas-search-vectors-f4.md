# Atlas Search Resumable Vector Releases Specification (F4)

**Package:** Feature Package F4 — Issue #16  
**Assignee:** Suk-Nsr  
**Milestone:** Atlas Search — 6 hours  
**Status:** Completed  
**Artifacts Generated:**
- `lib/search/vector-types.ts`: Type definitions for model profiles, semantic coverage, batch checkpoints, vector release manifest, active pointer, and completion forecasts
- `lib/search/vector-io.ts`: Binary little-endian Float32 vector encoding/reading, L2 normalization, cosine similarity, release validation without row sampling, active release pointer, and Hour 3 forecasting
- `lib/search/vector-builder.ts`: Resumable vector release builder with per-batch checkpointing, atomic versioned staging, manifest preservation, and promotion
- `scripts/build-vector-release.ts`: CLI script for vector release packaging (`pnpm run search:vectors`) with a forecast (completed count read from checkpoints, elapsed time from `--elapsed-sec`) and `--mock` mode
- `test/vector-release.test.ts`: Complete unit test suite verifying binary encoding, full-buffer row validation, per-batch checkpoints, profile guards, coverage, and forecast calculation

---

## 1. Vector Format & Storage Contract

1. **Binary Encoding:** Vectors are stored as contiguous little-endian IEEE-754 32-bit floating point numbers (`Float32Array`) in `vectors.f32`.
   - Dimensions: **1,024**
   - Bytes per float: **4 bytes**
   - Bytes per vector: $1,024 \times 4 = 4,096$ bytes ($4\text{ KiB}$)
   - Total file size: Exactly $N \times 4,096$ bytes for $N$ vectors.
2. **Document Mapping (`vectorRow`):**
   - Each entry in `data/search/documents.json` contains a `vectorRow: number | null` field.
   - For vectorized documents, `vectorRow` is the 0-indexed integer offset into `vectors.f32`.
   - Byte offset in `vectors.f32`: $\text{offset} = \text{vectorRow} \times 4,096$.
   - Unvectorized documents (or in keyword-only releases) have `vectorRow: null`.
3. **Ordered Keys Hash (`recordKeysHash`):**
   - SHA-256 hash computed over ordered strings: `${vectorRow}:${typedId}:${contentHash}`.
   - Any insertion, deletion, reordering, or content modification in the vector set invalidates the hash.

---

## 2. Model Profiles & Generator Separation

Model configurations are explicitly pinned and bound to their generator implementation. Mock vectors are strictly segregated from production Qwen embeddings:

| Property | Production Qwen Profile | Deterministic Mock Profile |
| :--- | :--- | :--- |
| **Model ID** | `Qwen/Qwen3-Embedding-0.6B` | `mock/deterministic-hash-128` |
| **Revision** | `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3` (pinned commit) | `mock-v1` |
| **Dimensions** | `1024` | `1024` |
| **Precision** | `float32` | `float32` |
| **Pooling** | `last_token` | `last_token` |
| **Normalization** | `L2 (Euclidean)` | `L2 (Euclidean)` |
| **Provider** | `tei` | `mock` |
| **Profile Hash** | `qwen3-embedding-0.6b-1024-f32-l2-97b0c61-v1` | `mock-deterministic-hash-1024-v1` |

> **Profile change (2026-11-08).** The earlier pin, `Alibaba-NLP/gte-Qwen2-1.5B-instruct`, was never run, and its output size was unverified against the pinned 1,024 dimensions. `Qwen/Qwen3-Embedding-0.6B` was run through a text-embeddings-inference server (CPU image `cpu-1.9`): it returned 1,024-dimension vectors, rejected requests without the API key, and scored cos(Thai query, English paraphrase) = 0.83 against 0.16 for an unrelated query. Queries are sent as `Instruct: <task>\nQuery:<text>`; documents get no prefix. `TeiEmbeddingGenerator` now sends `Authorization: Bearer $EMBEDDING_SERVICE_API_KEY` and refuses any vector whose length differs from the profile.

> [!IMPORTANT]
> `VectorReleaseBuilder` strictly enforces model profile integrity. Attempting to use `DeterministicMockEmbeddingGenerator` with a production model profile (`DEFAULT_MODEL_PROFILE`) fails with a runtime error. Mock checkpoints cannot be reused by a production Qwen run because checkpoint cache matching requires an exact `modelProfileHash` match.

---

## 3. Resumable Checkpoint Architecture

To protect against process crashes, timeouts, or GPU disconnections during long indexing runs:
1. **Per-Batch Checkpointing:** Checkpoints are stored in `.cache/search-vector-checkpoints/` incrementally. Each batch of embeddings is written to disk immediately after generation before subsequent batches begin.
2. **Profile & Content Hash Binding:** Each checkpoint entry records `typedId`, `contentHash`, `vectorRow`, and the float array under a profile-specific checkpoint key.
3. **Batch numbering:** a resumed run continues numbering from the highest existing checkpoint for the profile, so earlier checkpoint files are never overwritten.
4. **Resumption Policy:**
   - On rebuild, existing checkpoints are examined.
   - If `modelProfileHash` matches current profile AND `contentHash` matches the current document, the cached vector is reused immediately without re-embedding.
   - If model profile changes or document text changes, the stale checkpoint is discarded and recomputed.
5. **Server Boundary:** Checkpoints are stored under `.cache/` (gitignored) and are never committed to git or exposed to browser bundles.

---

## 4. Atomic Versioned Staging & Release Validation

Before any vector release is activated:
1. **Versioned Staging Directory:** Files are staged in an isolated versioned staging directory (`.cache/search-vector-staging/stage-<releaseId>-<timestamp>/`).
2. **Full-Buffer Release Validation:** The release validator checks:
   - `file_size_alignment`: Buffer size strictly matches $N \times 1,024 \times 4$ bytes.
   - `finite_values`: **Every single vector row** in the buffer is checked (no sampling). Rejects any `NaN`, `+Infinity`, `-Infinity`.
   - `nonzero_norms`: Rejects zero-magnitude vectors across all rows.
   - `l2_normalization`: Verifies $\|v\|_2 \approx 1.0 \pm 0.05$ across all rows.
   - `ordered_typed_key_mapping`: Ensures `vectorRow` indices are contiguous, unique, and strictly match document count.
   - `manifest_file_checksums`: Verifies that every staged file on disk matches the byte length and SHA-256 recorded in the manifest.
3. **Atomic Promotion & Active Pointer:**
   - Files (`documents.json`, `manifest.json`, `vectors.f32` when present, `probe-128.json` when present) are copied into a versioned release folder (`data/search/releases/<releaseId>/`).
   - The release folder is validated against its own manifest checksums before `active-release.json` is written. If that fails the build throws and the pointer is not written.
   - Active files (`documents.json`, `vectors.f32`, `manifest.json`) are promoted to `data/search/`.
   - An `active-release.json` pointer is written as the single atomic switch boundary. If any check fails during staging, staging aborts and active files remain untouched.
4. **Manifest Preservation:** The vector builder reads existing base F3 manifest data, preserving `counts`, `emptyKinds`, and `policy` configurations.

---

## 5. Semantic Coverage Modes

Atlas Search supports three explicit coverage tiers:
- **`absent` (Keyword-Only):**
  - `vectorCount: 0`, `vectors.f32` is empty or omitted, all `vectorRow` values are `null`.
  - Declares search mode as pure keyword.
- **`partial` (Partial Semantic Slice):**
  - Some documents vectorized ($0 < \text{vectorCount} < \text{totalDocuments}$).
  - Manifest records incomplete coverage percentages by kind (`source`, `robot`, `contribution`, `perspective`, `relationship`).
  - Search UI displays visible warning that semantic coverage is partial.
- **`complete` (Full Semantic Release):**
  - Every eligible public document has a valid vector ($100\%$ coverage).

---

## 6. Hour 3 Completion Forecast (50% Contingency Gate)

Per acceptance check #4:
The `--forecast` mode reads the completed document count from checkpoints on disk (only checkpoints whose `modelProfileHash` matches and whose `typedId` and `contentHash` match the current documents count), or from `--completed <N>`. Elapsed time is never inferred from checkpoint file timestamps, because the span between files excludes the first batch and would overstate throughput. You must supply it with `--elapsed-sec <S>`; without it the command exits with a "not enough data" error. A 50% contingency buffer is then added:
$$\text{Total Forecast Remaining} = \text{Estimated Remaining} \times 1.5$$
$$\text{Forecast Finish} = \text{Elapsed Time} + \text{Total Forecast Remaining}$$

- If $\text{Forecast Finish} \le 4.5\text{ hours}$ (Hour 4½), the forecast prints `ON TRACK` and the team proceeds with full semantic indexing.
- If $\text{Forecast Finish} > 4.5\text{ hours}$, the forecast prints `LATE` and a hint. It changes nothing and does not start a build. The operator then packages the completed vectors as a partial semantic release by running the builder with `--limit <N>`.
