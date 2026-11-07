# Atlas Search contract (F1)

`lib/search/types.ts` extends the F3 contract without changing its exported names or corpus. The corpus is atlas-wide and limited to eligible public records. The planned feature has its own six-hour allocation; this scaffold does not replace that plan.

## Request and response

`POST /api/search` accepts JSON up to 8 KiB: `query` is required, trimmed and limited to 300 Unicode code points; `types` optionally filters the seven record kinds; `limit` is an optional positive integer, defaults to 10 and is capped at 20. Zero, negative and non-integer limits are invalid. Blank queries request browse results. Invalid requests receive HTTP 400 with `error.code = "invalid_request"`. GET returns 405.

Results are grouped by canonical identity, not by kind. A group has a `groupKey` and typed members. Members of different kinds (for example a source and its linked perspective) share a group when they have the same external URL or an explicit parent-source association (`parentTypedId`); the key is that URL in `canonicalizeUrl` form, or the parent's key. A record with no URL and no parent stays a singleton keyed by its typed id; empty URLs and similar titles never merge records. `limit` counts groups, not records: once the limit is reached, later members of groups already admitted are still returned so no evidence is dropped. With a `types` filter only members of the selected kinds appear. In keyword results only members whose evidence matches appear. Group membership adds no score or duplicate-count boost.

Robot models use their typed ID as the group key. A link from a contribution to a robot is a model association and does not affect the contribution's search group.

A result has a typed reference, a public `contentType`, title, URL and evidence. `contentType` is one of `paper`, `repository`, `video`, `news_web`, `source` (generic or unknown source), `robot`, `contribution`, `perspective`, `inventory`, `relationship` or `entity`. For sources it is derived from `metadata.platform` (`openalex` is a paper, `github` a repository, `youtube` a video) and, failing that, from the URL host (OpenAlex, DOI and arXiv are papers; GitHub is a repository; YouTube is a video). Any other source with a URL or platform is `news_web`; a source with neither stays `source`. Other kinds use their record kind.

Each response evidence item has `evidenceKind`, set from the underlying field: `derived` only for text the exporter constructs (perspective theme titles, field `perspective_theme` or `perspectiveTheme`, and relationship statements, field `relation`), and `source` for everything else, including a genuine perspective excerpt that happens to equal the generated title. A title match prefers stored title evidence when the record supplies it. Only when none does, the API adds a title candidate: labelled `Title` (`source`) for kinds whose titles are stored, and `Constructed title` (`derived`) for perspectives and relationships. Keyword matches may provide literal ranges. Range endpoints are UTF-16 offsets into the exact returned evidence text, with an exclusive end. Semantic-only matches must supply evidence without literal ranges; browse results have no match claim. Response types omit vectors, tokens, ranking scores and provider errors. Coverage reports indexed and eligible counts; release metadata reports ID and generation time.

`mode` is the retrieval mode: `keyword`, `hybrid` or `unavailable`. `view` is how the response is shown: `results` for a query with match claims, `browse` for a blank query without them. The fixture scaffold reports `mode: "keyword"` with `view: "browse"` for blank queries, matching the declared keyword ranking policy; an unavailable response keeps `view` from the request. Warnings are `degraded_semantic`, `partial_vector_coverage`, `stale_index` and `unavailable`.

## Implemented and declared

The injectable loader supports a small fixture-backed literal keyword or browse scaffold. The deployed route currently has no loader and returns HTTP 503 with an `unavailable` response. It does not read the F3 corpus or query the database. No current-record revalidation is performed in the fixture path, so it must not be wired to public data until eligibility and freshness checks are in place. Loader errors also return unavailable without exposing their details.

Ranking, best-member group scoring and an opt-in semantic/hybrid branch are implemented by F5 (see `docs/atlas-search-ranking-f5.md`); the deployed route still supplies no vectors. Current-record checks remain for sibling issues. The initial ranking policy declares keyword mode with no semantic cutoff or model profile. Model, publication, release and ranking-policy contracts are declared for future releases. No semantic coverage or cross-language retrieval is claimed by this scaffold.

## Open decision: stable IDs

F3 seed exports use `source:seed-N` array-index identifiers, while database records use cuids. `SourceRecord.url`, `Entity.canonicalKey` and `RobotModel.canonicalName` are existing stable key candidates. The team must decide the cross-export identity and migration policy; F1 does not choose one or alter F3 IDs.
