# Graph Identity and Evidence Semantics (S4)

## Overview & Scope
Resolves [Issue #24](https://github.com/Pongchayanneung/HumanoidTH/issues/24) (Findings D07 and D08) by repairing entity identity and relationship semantics in the ecosystem network graph:
1. **Stable Typed IDs (Finding D07):** Replaced lossy ASCII slugification with Unicode-aware normalization and deterministic SHA-256 hashing. Distinct Thai entity names (e.g. Chulalongkorn University, Kasetsart University, KMUTT FIBO) and distinct long names sharing prefixes are preserved without collisions.
2. **Reviewed Assertions vs Inferred Relationships (Finding D08):** Explicitly separates human-reviewed facts (`is_reviewed: true`, `review_status: "APPROVED"`, `evidence_kind: "reviewed_assertion"`) from automated machine inferences (NLP triplets, perspective themes, substring mentions).
3. **Accurate Relationship Meaning (Finding D08):**
   - Borrowed or loaned inventory is labeled `borrowed_by`, never `owned_by`.
   - Leased inventory is labeled `leased_by`, never `owned_by`.
   - Robot country of origin is labeled `origin_country` ("originates from"), preventing country of origin from being conflated with Thai deployment locations (`located_in`).
4. **Verified Filtering & Detail Panel:** The `onlyReviewed` filter strictly requires verified human review status rather than arbitrary numeric confidence (an unreviewed edge with confidence 0.95 is properly excluded). The detail panel explicitly displays reviewed vs inferred status with traceable evidence excerpts.

## Key Changes
- `lib/network-graph.ts`:
  - Implemented `stableTypedId(type, label)` utilizing `normalize("NFC")`, Unicode character preservation `[^\p{L}\p{M}\p{N}]+`, and an 8-character deterministic SHA-256 hash suffix.
  - Implemented `edgeId(source, relation, target, url)` with deterministic SHA-256 hashing.
  - Added `review_status`, `is_reviewed`, and `evidence_kind` properties to `NetworkNode` and `NetworkEdge`.
  - Updated inventory relation logic to check `ownershipStatus`: `borrowed_by`, `leased_by`, `owned_by`.
  - Updated robot origin country relation to emit `origin_country` instead of `located_in`.
  - Updated NLP triplets, perspective themes, and mention edges to be explicitly marked as `is_reviewed: false` and `evidence_kind: "inferred_relation"`.
  - Added `records?: AtlasRecord[]` to `NetworkGraphOptions` to allow fast, deterministic unit test evaluation.
- `app/network/NetworkGraphClient.tsx`:
  - Updated `filterGraph`: `toggles.onlyReviewed` filters nodes and edges by `is_reviewed || review_status === "APPROVED"` rather than `confidence >= 0.7`.
  - Updated edge detail view: replaced ambiguous "Reviewed or high-confidence" with distinct "Reviewed assertion" / "Inferred relation" localized labels.

## Verification & Test Results
- Unit test suite: `node --import tsx --test test/graph-identity-semantics.test.ts`
  - 6/6 tests passed (100%), 0 failed.
- Public projection suite: `node --import tsx --test test/graph-public-projection.test.ts`
  - 1/1 tests passed.
- Entire repo unit suite: `pnpm test`
  - 252 tests executed: 240 passed, 0 failed, 12 skipped.
- Code hygiene: `pnpm run check:no-mock-data`
  - PASSED with 0 mock data signals.
- TypeScript check: `pnpm run typecheck`
  - PASSED with 0 errors.

## Repaired, Contained, and Deferred Register
- **Repaired:**
  - Finding D07: Entity IDs preserve distinct Thai and long names without collisions.
  - Finding D08: Inferred relationships are separated from reviewed assertions; borrowed inventory and robot country of origin have correct semantic relations; `onlyReviewed` filter requires actual human review.
- **Contained:**
  - Private inventory units remain restricted from unauthenticated graph views under M3 policy.
- **Deferred:**
  - Automated graph layout recalculation on arbitrary dynamic edge additions remains deferred.
