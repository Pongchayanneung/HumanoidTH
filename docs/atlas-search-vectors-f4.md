# Atlas Search Resumable Vector Releases Specification (F4)

**Package:** Feature Package F4 — Issue #16  
**Assignee:** Suk-Nsr  
**Milestone:** Atlas Search — 6 hours  
**Status:** Completed  
**Artifacts Generated:**
- `lib/search/vector-types.ts`: Type definitions for model profiles, semantic coverage, batch checkpoints, vector release manifest, and completion forecasts
- `lib/search/vector-io.ts`: Binary little-endian Float32 vector encoding/reading, L2 normalization, cosine similarity, release validation, and Hour 3 forecasting
- `lib/search/vector-builder.ts`: Resumable vector release builder with batch checkpointing, atomic staging, and promotion
- `scripts/build-vector-release.ts`: CLI script for vector release packaging (`pnpm run search:vectors`)
- `test/vector-release.test.ts`: Complete unit test suite verifying binary encoding, normalization, validation, checkpoints, coverage, and forecast calculation

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

## 2. Model Profile & Normalization

Model configuration is pinned to ensure deterministic compatibility between corpus indexing and online query inference:

| Property | Value | Description |
| :--- | :--- | :--- |
| **Model ID** | `Alibaba-NLP/gte-Qwen2-1.5B-instruct` | Multilingual Thai/English dense embedding backbone |
| **Revision** | `main` | Pinned model weights |
| **Dimensions** | `1024` | Pinned output dimension |
| **Precision** | `float32` | Standard 32-bit floating point |
| **Pooling** | `last_token` | Instruction-aware representation |
| **Normalization** | `L2 (Euclidean)` | All vectors normalized to unit length ($\|v\|_2 \approx 1.0$) |
| **Profile Hash** | `qwen2-gte-1024-f32-l2-v1` | Deterministic configuration hash |

---

## 3. Resumable Checkpoint Architecture

To protect against process crashes, timeouts, or GPU disconnections during long indexing runs:
1. **Checkpoint Granularity:** Checkpoints are stored in `.cache/search-vector-checkpoints/` per batch.
2. **Profile & Content Hash Binding:** Each checkpoint entry records `typedId`, `contentHash`, `vectorRow`, and the float array.
3. **Resumption Policy:**
   - On rebuild, existing checkpoints are examined.
   - If `modelProfileHash` matches current profile AND `contentHash` matches the current document, the cached vector is reused immediately without re-embedding.
   - If model profile changes or document text changes, the stale checkpoint is discarded and recomputed.
4. **Server Boundary:** Checkpoints are stored under `.cache/` (gitignored) and are never committed to git or exposed to browser bundles.

---

## 4. Atomic Staging & Release Validation

Before any vector release is activated:
1. **Staging Directory:** Files are staged in `.cache/search-vector-staging/` (`documents.json`, `vectors.f32`, `manifest.json`).
2. **Automated Release Validation:** The release validator checks:
   - `file_size_alignment`: Buffer size strictly matches $N \times 1,024 \times 4$ bytes.
   - `finite_values`: All floats are finite numbers (rejects `NaN`, `+Infinity`, `-Infinity`).
   - `nonzero_norms`: Rejects zero-magnitude vectors.
   - `l2_normalization`: Verifies $\|v\|_2 \approx 1.0 \pm 0.05$.
   - `ordered_typed_key_mapping`: Ensures `vectorRow` indices are contiguous, unique, and strictly match document count.
3. **Atomic Promotion:** Only when all checks pass are files copied to `data/search/`. If any check fails, promotion aborts.

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
At elapsed hour 3, remaining work is measured and a 50% contingency buffer is added:
$$\text{Total Forecast Remaining} = \text{Estimated Remaining} \times 1.5$$
$$\text{Forecast Finish} = \text{Elapsed Time} + \text{Total Forecast Remaining}$$

- If $\text{Forecast Finish} \le 4.5\text{ hours}$ (Hour 4½), the team proceeds with full semantic indexing.
- If $\text{Forecast Finish} > 4.5\text{ hours}$, the build immediately triggers the fallback policy: packaging the completed vectors as a **partial semantic release** and freezing lexical search to guarantee release on time.
