# Atlas Search contract (F1)

`lib/search/types.ts` extends the F3 contract without changing its exported names or corpus. The corpus is atlas-wide and limited to eligible public records. The planned feature has its own six-hour allocation; this scaffold does not replace that plan.

## Request and response

`POST /api/search` accepts JSON up to 8 KiB: `query` is required, trimmed and limited to 300 Unicode code points; `types` optionally filters the seven record kinds; `limit` is an optional positive integer, defaults to 10 and is capped at 20. Zero, negative and non-integer limits are invalid. Blank queries request browse results. Invalid requests receive HTTP 400 with `error.code = "invalid_request"`. GET returns 405.

Results are grouped by content kind. A result has a typed reference, title, URL and evidence. Each response evidence item has `evidenceKind`: `source` for text from a record or `derived` for constructed text. The scaffold labels its title match text and constructed perspective and relationship titles as derived. Keyword matches may provide literal ranges. Range endpoints are UTF-16 offsets into the exact returned evidence text, with an exclusive end. Semantic-only matches must supply evidence without literal ranges; browse results have no match claim. Response types omit vectors, tokens, ranking scores and provider errors. Coverage reports indexed and eligible counts; release metadata reports ID and generation time. Modes are `browse`, `keyword`, `hybrid` and `unavailable`; warnings are `degraded_semantic`, `partial_vector_coverage`, `stale_index` and `unavailable`.

## Implemented and declared

The injectable loader supports a small fixture-backed literal keyword or browse scaffold. The deployed route currently has no loader and returns HTTP 503 with an `unavailable` response. It does not read the F3 corpus or query the database. No current-record revalidation is performed in the fixture path, so it must not be wired to public data until eligibility and freshness checks are in place. Loader errors also return unavailable without exposing their details.

Hybrid retrieval, semantic matching, production ranking, source-identity deduplication and current-record checks remain for sibling issues. The initial ranking policy declares keyword mode with no semantic cutoff or model profile. Model, publication, release and ranking-policy contracts are declared for future releases. No semantic coverage or cross-language retrieval is claimed by this scaffold.

## Open decision: stable IDs

F3 seed exports use `source:seed-N` array-index identifiers, while database records use cuids. `SourceRecord.url`, `Entity.canonicalKey` and `RobotModel.canonicalName` are existing stable key candidates. The team must decide the cross-export identity and migration policy; F1 does not choose one or alter F3 IDs.
