# Atlas Search ranking (F5)

Issue #17. Keyword, semantic and hybrid ranking with result grouping, wired into `lib/search/api.ts` behind the F1 contract (request and response shapes are unchanged).

## What is implemented

`lib/search/ranking.ts` holds pure functions with no network, no model call and no I/O. `lib/search/api.ts` calls them.

- **Thai-aware tokenization.** `wordSegments` uses `Intl.Segmenter("th", { granularity: "word" })` on the original string. Each segment keeps UTF-16 offsets into the original text; only the per-segment match key is NFKC and case folded. Thai sara am (U+0E33) is recomposed before segmentation and in match keys, so a request typed in decomposed form (U+0E4D U+0E32) still matches. Evidence text and literal ranges therefore always refer to the original string. The query is segmented the same way, so indexed text and requests share one tokenization.
- **Query preparation.** `prepareQuery` returns the meaningful words, an `embeddingText` copy (NFKC, collapsed whitespace, case folded) and `hasNegation`. Function words (English and Thai) and negation words are excluded from lexical eligibility only. The embedding copy keeps the full request, negation included.
- **Keyword ranking.** A record qualifies when a meaningful query word appears in text it can display (title or stored evidence). Export metadata that is not shown as evidence (author, platform and similar) is not searched, so every match can be inspected by the user. Score is `(4 * title words + 1 * body words) / query words`, with weights from `FROZEN_SEMANTIC_POLICY.lexicalWeights`. An exact full title or name match (all words equal, in order) ranks above every other score. Ties keep index order. Literal ranges are the matched segments (adjacent matches separated by whitespace merge into one range).
- **Types first.** `types` filters documents before keyword scoring, the semantic branch, the 50-candidate cap and the group limit. Group identity still reads the whole index, so a perspective keeps its parent source's `groupKey` even when the source is not selected. Unselected members never qualify, score or supply evidence. The same holds for `options.isEligible(doc)`, an optional synchronous survival check applied together with the type filter. It is the seam for current-record eligibility; the async database revalidation itself is not wired here.
- **Browse.** A blank, generic-only (`the of and`, `ที่ และ`), negation-only or punctuation-only request returns `mode: "keyword"`, `view: "browse"` with no match claim, in index order.
- **Grouping.** F1 identity rules (URL, parent source, typed singleton, robots keep their own key), with the URL put through `canonicalizeUrl` (trailing slash, fragment, `utm_*` and click-id parameters, host case) so variants of one address share a group. Group order follows the best surviving member's rank. There is no duplicate-count boost. `limit` counts groups and later members of admitted groups are kept.
- **Semantic retrieval.** `semanticRank` is exact cosine over vectors the caller passes in. It is `unavailable` for a profile that is not compatible with the policy (including the mock profile), a query vector of the wrong size, or when no candidate has a compatible vector. Admission uses the policy cutoff (0.62).
- **Hybrid.** `fuseRankings` sums `1 / (60 + rank)` over the top 50 of each branch. Exact title matches keep priority over the fused order. Keyword matches, then semantic matches, beyond the cap follow, so group-mates are not lost.
- **API wiring.** `createSearchPost(loadIndex, { embedQuery?, policy?, isEligible? })`. The index may carry `vectors: { profile, rows }`. Only when both `embedQuery` and `vectors` are supplied does the semantic branch run. The deployed route supplies neither, so it still declares keyword mode and returns 503 with no index. Warnings: `partial_vector_coverage` when some selected records lack a compatible vector, `degraded_semantic` when semantic was configured but unusable (incompatible profile, no usable vectors, embedding error or null). An empty selection makes no embedding call. An embedding error is never echoed. Responses carry `methods` and evidence only, never scores, similarities, vectors or RRF values.

## Relatedness, not satisfaction

Results are related records with their original evidence. A request such as "humanoid robots without cameras" returns records that mention cameras as well as records that do not. The ranking does not evaluate the Boolean condition, does not exclude records that mention the negated term, and makes no suitability claim. The user reads the evidence to see the gap.

## What is NOT implemented or verified

- **No real-vector semantic run.** All semantic tests use synthetic unit vectors. No embedding model was run, no real vector release was queried, and no semantic quality is claimed.
- **The 0.62 cutoff is provisional and uncalibrated** (`calibrationStatus: "provisional_uncalibrated"`). It is honoured, not endorsed. Final hybrid admission needs F8's frozen, profile-compatible semantic policy, calibrated on the dev split with the real model and confirmed on the reserved split.
- RRF `k`, lexical weights and the candidate cap are the pinned design values, not tuned.
- The semantic branch runs with the pinned policy as given, including the provisional cutoff, whenever a caller injects `embedQuery` and compatible vectors. Nothing in this module treats that as calibrated; gating production use on a calibrated policy is F8/F6 work.
- Fuzzy matching (one edit for Latin words of five or more letters) is not implemented; Thai fuzzy expansion is deferred by the design.
- No stemming. Thai matching is by ICU dictionary word, so a query word that the segmenter splits differently in another context may miss.
- The 2.5 second inference deadline and the 200 current-record checks belong to the caller and to revalidation (F6); neither is enforced here, and no current-record revalidation runs in this path.
- The route has no production index loader and no embedding provider wired.

## Tests

`test/search-ranking.test.ts` (new) plus the unchanged `test/search-contract.test.ts`, `test/search-grouping.test.ts` and `test/search-response-types.test.ts`. Run with `DATABASE_URL=postgresql://x:y@127.0.0.1:1/x ./node_modules/.bin/tsx --test test/*.test.ts`.
