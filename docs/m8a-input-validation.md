# M8-A input validation audit (issue #9)

Scope: every server action, route handler and page that reads `searchParams` or a cookie on
`main` at `94f7322`. "Retained = unavailable" means M2 (#36) or M3 (#40) already made the
surface a fixed denial; it reads no input and this issue does not reimplement it.

Shared helpers: `lib/network-query.ts` (new), `lib/contribution-filters.ts`
(`normalizeScalarParam`, `truncateParam`, new `readBoundedTextParam`), `lib/translations.ts`
(`parseLanguage`). Repeated query parameters: filters use the first value (existing
`normalizeScalarParam` rule); the network API rejects repeats of recognised parameters because it
has no safe first value (unknown parameters are ignored).

## Surfaces

| Surface | Inputs | Validation | Test | Status |
| --- | --- | --- | --- | --- |
| `GET /api/network/graph` | `source`, `limitNodes`/`maxNodes`, `limitEdges`/`maxEdges`, `minConfidence`, `includeLowConfidence`, `cluster`, `nodeType`, `relation` | `source` in file, database, hybrid, auto. Limits must match `^\d{1,6}$`, then clamp to 25..1000 nodes and 50..2500 edges (defaults 300 and 800). `minConfidence` a decimal in 0..1 with at most six fractional digits. `includeLowConfidence` exactly `true` or `false`. Text filters 1..100 chars, no control characters. For recognised parameters, any repeat, NaN, negative, fractional, empty, exponent or unknown value returns 400 naming the parameter; unknown parameters (even repeated) are ignored. Sending both aliases (`limitNodes` with `maxNodes`, `limitEdges` with `maxEdges`) is also 400. `includePrivate` is fixed to false. Failure, including `auto` with no database and no seed file, returns a generic 503, never `error.message`. | `test/m8a-input-validation.test.ts` (parser table, route 400, valid 200, broken file 503 with no path text). Existing: `test/graph-public-projection.test.ts` | validated |
| `GET /api/network/node/[node_id]` | path id, `source` | Id validated as received from Next 15 (already decoded once; no second `decodeURIComponent`, keeping literal percent escapes intact without `URIError`), 1..256 chars, no control characters. `source` as above. Graph failure returns generic 503. Unknown id stays 404. | `test/m8a-input-validation.test.ts` | validated |
| `GET /api/network/edge/[edge_id]` | path id, `source` | Same as node. | `test/m8a-input-validation.test.ts` | validated |
| `POST /api/search` | JSON body `query`, `types`, `limit` | Existing: content type JSON, 8192 byte body cap, strict UTF-8, unknown keys rejected, query at most 300 code points, `types` from `SEARCH_RECORD_KINDS`, `limit` positive integer capped at 20, error body is a fixed message, index failure is a fixed 503. `GET` is 405. | `test/search-contract.test.ts` (validation, byte limit, limit clamp) | validated (no change needed) |
| `/contributions` page | `type`, `org`, `robot`, `status`, `q` | Existing: `type` and `status` allowlists, status never widens visibility, public projection always applied, `take: 200`, query errors logged server side and shown as a fixed notice. Added: `q`, `org`, `robot` limited to 200 code points and no control characters or lone surrogates (a `NUL` would fail in PostgreSQL); invalid returns the existing `filterError`, runs no contribution query and is not echoed back into the form. `truncateParam` now cuts on code point boundaries and drops control characters. | `test/contribution-filters.test.ts`, `test/m8a-input-validation.test.ts` | validated |
| `/database` page (operator only) | `table`, `q` | Operator principal required before any query. `table` normalised then matched against the allowlist, else `sources` (an array value no longer slips through). `q` uses `readBoundedTextParam`; out-of-bounds shows an alert and runs no query. `take: 250` fixed. Errors logged only. | `test/m8a-input-validation.test.ts` (`readBoundedTextParam`). Page render not unit tested, see below | validated, render not run |
| `/inventory` page | `mode` | Only the exact string `operator` combined with a verified operator principal selects the full view. Anything else, including an array, is the public view. No `take`/`skip` input exists. | `test/public-projection.test.ts` (`sanitizeInventoryForPublic`). The `mode` check itself has no dedicated test | validated (strict equality, no change needed) |
| `/robots` page | none (URL parsing of stored video links only) | fixed `take` constants (`ROBOT_LIST_LIMIT` = 200 robots, 1000 source records). No request input. | none needed | validated (no input) |
| `/admin-login` page | `error` | Looked up with `Object.hasOwn` in a fixed map, unknown value shows the generic unavailable message. | `test/operator-surfaces.test.ts` | validated (no change needed) |
| `/admin`, `/admin/cms`, `/admin/submitted-data` | `collection`, `selectedId`, `error` | Operator required. `readSelection` requires an allowlisted collection and a string id of at most 256 chars and 256 bytes with no control characters or lone surrogates. Arrays are `INVALID_SELECTION`. | `test/admin-inspection.test.ts`, `test/admin-inspection-surfaces.test.ts` | validated (no change needed) |
| `lang` cookie (read by 9 pages) | cookie value | Was cast with `as "en" \| "th"`. `lang=constructor` or `__proto__` resolved to `Object.prototype` members in `getTranslation` and made `app/inventory/page.tsx` index an object with an unknown key. Now `parseLanguage` maps anything but `th` to `en` and `getTranslation` uses `Object.hasOwn`. | `test/m8a-input-validation.test.ts` | validated |
| `setLanguage(lang)` action | `en` or `th` | Existing guard returns before reading cookies for any other value. Writes only a fixed-name cookie with a two-value domain. | `test/operator-boundaries.test.ts` (`fr`, `EN`, empty, null, undefined, poison are ignored) | validated (no change needed) |
| `adminLoginAction`, `logoutUser` | form `email`, `password` | Non-strings become empty strings; the auth service rejects email over 254 chars and passwords over 1024 bytes before any KDF or store work; result codes map to a fixed set of redirects. | `test/operator-auth-service.test.ts` (oversized email and password), `test/operator-auth-web.test.ts` | validated (no change needed) |
| `createSubmission`, `updateSubmissionStatus`, `runDataPull`, `loginAsUser`, `registerAndLoginUser`, `upsertSourceRecordAction`, `upsertRobotModelAction`, `upsertContributionAction`, `upsertSubmittedDataAction` | n/a | Fixed `WORKFLOW_UNAVAILABLE`, arguments never read. Proof: poisoned `FormData` and arguments throw if touched and the effect counters stay at zero for anonymous, forged and operator identities. | `test/operator-boundaries.test.ts` | unavailable |
| `app/map/actions.ts` (`analyzeClustersWithGemini`, `reanalyzeClustersWithGemini`, `fetchContributionClusters`) | n/a | Deny or return `[]` with no network, database or provider call. | `test/map-honest.test.ts` | unavailable |
| `GET /api/export` | `table` | Fixed 403 `WORKFLOW_UNAVAILABLE`, whatever credentials or cookies are sent. | `test/public-projection.test.ts` | unavailable |
| `POST /api/ingest/[adapter]` | path adapter | Fixed 403, `params` never awaited. | `test/operator-boundaries.test.ts` | unavailable |

## Behaviour changes

- Network graph API: invalid parameters were silently coerced (NaN to default, empty string to
  the minimum, unknown `source` to `auto`, unparsable `minConfidence` ignored). They now return
  400 `{ "error": "Invalid request parameter: <name>" }`. In-range and out-of-range integers keep
  their old clamp. The only caller in the repo (`NetworkGraphClient`) sends a valid `source` and
  integers, and already treats a non-OK response as an error.
- Network graph API failure: was 200 with an empty graph when `source` was omitted or `auto`,
  with `error.message` copied into `meta.warnings`. `buildNetworkGraph` now throws when neither
  the database nor the seed file is reachable (so the empty result is not cached for 60 seconds
  and node/edge no longer answer 404 for a missing source). All three routes then answer 503
  `{ "error": "Network graph is unavailable." }`, so a server fault is distinguishable from an
  empty result. The detail is logged server side.
- Node and edge APIs: a malformed percent escape no longer throws `URIError`; graph failures no
  longer surface as an unhandled exception.

## Deferred

| Item | Reason |
| --- | --- |
| Rate limiting on the public network and search endpoints | Needs shared storage or edge configuration, not a validation change. Bounded work per request is in place (node cap 1000, edge cap 2500, 60 second graph cache). |
| Response shape agreement with M8-B and M8-C for filter errors | The contributions page keeps the existing `filterError` notice. The network API uses a flat `{ error }` string because that is what the existing client and the 404 path already use. Revisit if M8-C changes the client. |
| Cache key growth in `buildNetworkGraph` | The key includes filter text, but text is now at most 100 characters and the cache holds one entry. |

## Not verified

- No real browser or `next start` run. Route handlers are called directly with `NextRequest` /
  `Request`; pages that read cookies and Prisma (`/contributions`, `/database`, `/inventory`)
  were type checked but not rendered.
- No database-backed run: `DATABASE_URL` in the checks points at an unreachable address.
- Next 15 already percent-decodes dynamic route params before the handler runs, so
  `parseNetworkId` validates the id as received without a second `decodeURIComponent`
  (preserving literal escapes such as `%3A` from `%253A`); live router decoding via `next start`
  was not run here.
