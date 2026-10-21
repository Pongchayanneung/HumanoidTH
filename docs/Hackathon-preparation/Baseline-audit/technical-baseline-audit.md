# HumanoidTH technical architecture baseline audit

Reviewed 20 October 2026 (Asia/Bangkok). Source baseline: `research/HumanoidTH`, commit `bef80bdfe895f9403af910951fa251c9baacad2b`, dated 5 July 2026. The checkout was clean at inspection. The coordinating auditor checked the public remote HEAD that day and confirmed it matched this commit. The deployed application's revision remains unknown.

This independent audit covers architecture, security boundaries, server APIs/actions, persistence, deployment, reliability and verification. Repairs remain proposed. The separate [design and dataflow audit](design-data-flow-baseline-audit.md) covers product behavior, research-data meaning, evidence provenance and the user journey. Source links identify the reviewed lines at the pinned baseline revision.

## Assessment

The app is a usable exploration prototype with a coherent Prisma schema, several real ingestion adapters and substantial visualization work. Its security model cannot support trusted multiuser operation: a visitor can choose an administrator role, administrator access trusts an unsigned boolean cookie, and privileged actions write data without checking permission. Public queries can also read sensitive data outside the administrator UI. The source confirms these defects. This audit did not log in, modify a database or exploit a live service.

Other risks include long tasks running inside web requests, seed imports that overwrite human decisions, derived records replaced through separate writes, and setup instructions that disagree with the configured database connection. Passing TypeScript and three classifier tests leaves these behaviors unchecked.

### Evidence and severity conventions

- **Source-confirmed:** Control flow or configuration is directly visible. A failure scenario describes its consequence under the stated preconditions; it is not a claim that production was exploited.
- **Reproduced, isolated:** A pure local diagnostic exercised code without database or network access.
- **Untested runtime risk:** The code establishes a concern but deployment configuration, timing, scale or external behavior was not exercised.
- **Critical:** A normal untrusted visitor can obtain administrative authority through the application's intended surface. **High:** Material confidentiality/integrity loss or likely operational failure under a concrete condition. **Medium:** Bounded exposure, reliability or maintainability problems requiring particular inputs or scale.

| ID | Priority | Finding | Evidence / confidence |
| --- | --- | --- | --- |
| T01 | Critical | Identity and administrator authority are client controlled | Source-confirmed / high |
| T02 | High | Privileged actions lack their own authorization boundary | Source-confirmed / high; alternate-path transport not exercised |
| T03 | High | Public queries bypass row and field confidentiality | Source-confirmed / high; production record contents unknown |
| T04 | High | Public map reads/actions can send private data and trigger expensive shared work | Source-confirmed / high; external calls not executed |
| T05 | High | Deployment instructions prescribe a database URL transport the configured client does not implement | Configuration mismatch confirmed / high; connection failure not reproduced |
| T06 | High | Ingestion runs synchronously without durable execution or bounded recovery | Source-confirmed / high; timeout/load impact unmeasured |
| T07 | High | Reclassification and editorial updates leave inconsistent or stale derived records | Source-confirmed / high; database scenarios not executed |
| T08 | High | Normal development startup can reimport and overwrite reviewed data | Source-confirmed / high; watcher not run |
| T09 | Medium | Runtime validation does not enforce the intended input contracts | Source-confirmed and URL diagnostic reproduced / high |
| T10 | High | AI failure and cache handling can persist unsupported results indefinitely | Source-confirmed / high; model availability not freshly checked |
| T11 | Medium | CSV export lacks spreadsheet-safe text handling and bounded execution | Source-confirmed / high; spreadsheet execution not tested |
| T12 | Medium | Failure reporting and cache invalidation are inconsistent | Source-confirmed / high |
| T13 | Medium | Verification and deployment tooling do not cover the active trust boundaries | Source-confirmed / high; portability failures not executed |

## Architecture and trust boundaries

The active application is a Next.js 15 App Router monolith. React server components query PostgreSQL through a shared generated Prisma client. The installed locked packages inspected locally were Next.js `15.5.20`, Prisma CLI/client `6.19.3`, and `@prisma/adapter-pg` `7.8.0`. The manifest allows compatible-version ranges; the committed `pnpm-lock.yaml` records the exact versions needed to reproduce this setup. The [manifest](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/package.json#L9) defines separate generation/build, ingestion, seeding, unit-test and development commands.

The main paths are:

1. **Browser → server components:** Public atlas pages read the same database used by the CMS. Visibility filtering is implemented independently in individual pages and is frequently absent.
2. **Browser → server actions:** [`app/actions.ts`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L1) combines login/session management, submissions, reviews, data pulls and CMS writes. [`app/map/actions.ts`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L1) combines public map reads, paid-model work and shared cache writes.
3. **HTTP API → adapters/database:** Ingestion and export routes are covered by middleware Basic authentication; graph routes are public. Ingestion fetches fixed provider APIs, enriches hostname/IP geography, classifies records and persists them sequentially.
4. **Server → external processors:** Adapters call OpenAlex, GitHub, GDELT and YouTube; model classification and map clustering call Gemini; [`lib/geo.ts:35–58`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/geo.ts#L35) calls an IP-geolocation service over HTTP. These are separate egress and availability boundaries.
5. **Operator/local file → database:** Seed commands and the development watcher import a root JSON corpus directly into production-shaped tables. The graph has a second data path reading a JSON file, with automatic fallback/hybrid modes and a process-local cache.
6. **Deployment → database:** Vercel builds generate a client and build Next.js. Schema application and seeding are manual deployment steps. PostgreSQL migrations are checked in.

The repository also retains a separate Python/FastAPI/SQLite implementation in `src/humanoid_atlas`, with its own CLI, schema, adapters and tests. The Vercel configuration selects Next.js; there is no evidence that the Python app is part of the active deployed request path. Tests for the Python application cannot establish security or workflow correctness of Next.js.

## Prioritized findings

### T01: Client-controlled identity and administrator authority

- **What it is:** People can choose an administrator role or claim another email without proving who they are.
- **Impact:** Someone could gain control of the app or access another person's submission history.
- **Why fix it:** Accounts and administrator powers need to belong only to verified, authorized people.

**Critical · high confidence · source-confirmed.**

**Evidence:** [`app/profile/page.tsx:65–100`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/profile/page.tsx#L65) exposes a role selector including administrator and a quick administrator login. [`app/actions.ts:135–156`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L135) and [`159–192`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L159) upsert a user by caller-supplied email, persist the supplied role, and set plain identity/role cookies. [`middleware.ts:18–25`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/middleware.ts#L18) accepts `admin_session` when its value is the string `true`, without a signature or server-side session lookup. The cookie setters specify only `path`, without explicit `httpOnly`, `secure`, expiry or revocation handling. [`app/profile/page.tsx:25–34`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/profile/page.tsx#L25) uses the email cookie to retrieve that account's submissions.

**Failure scenario and impact:** An anonymous visitor uses the public role selector to obtain a persistent ADMIN record and administrator cookie, or supplies the accepted cookie value directly. Choosing someone else's known email can replace that account's name/role and reveal its linked submission history. Authentication and role separation fail in the underlying handlers, so removing the simulator buttons alone would leave the defect open.

[`app/actions.ts:209–222`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L209) and [`middleware.ts:29–38`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/middleware.ts#L29) also contain static credential fallbacks when environment settings are absent. Their values are deliberately omitted here. Missing configuration does not fail closed; the example placeholder password is not rejected by this code.

**Adjustment:** Replace simulation login with verified identity and a session the server can verify. Assign roles through an authenticated administrative workflow. Remove production simulation actions and static credential fallbacks, validate required configuration at startup, and invalidate existing simulated sessions. Rotate any deployed credential that reused a tracked fallback. Set appropriate cookie security attributes and define how sessions expire or are revoked.

**Acceptance:** In an isolated environment, anonymous registration cannot assign privileged roles or alter another account; a forged/expired/revoked cookie fails; changing an email field does not change the authenticated subject; missing administrator configuration blocks privileged access. Test the handler behavior as well as the visible form.

### T02: Privileged server actions do not authorize the operation

- **What it is:** The functions that change records do not check whether the caller is allowed to make that change.
- **Impact:** A protected page alone may not stop an unauthorized request from changing data.
- **Why fix it:** Each change needs its own permission check, even when called outside the usual screen.

**High · high confidence · source-confirmed; direct action transport bypass not reproduced.**

**Evidence:** [`app/actions.ts:90–93`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L90) updates review status without an actor check; [`95–129`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L95) runs provider pulls without one; CMS actions at [`237–274`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L237), [`276–313`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L276), [`315–351`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L315) and [`353–379`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L353) write arbitrary supplied record IDs without checking identity, role or ownership. The only route middleware matcher is [`middleware.ts:54–56`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/middleware.ts#L54). The public map mutation is separately exposed through [`app/map/page.tsx`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/page.tsx#L7).

**Failure scenario and impact:** A caller who gains authority through T01 can edit the research corpus and review state. After login is repaired, page middleware would still leave permission checks dependent on the calling route and how it exposes action references. A future public form or refactor could expose a privileged action that writes data without checking the caller. The missing checks are confirmed in source; anonymous HTTP access to every exported function was not demonstrated in the deployed build.

**Adjustment:** Verify the caller inside each privileged action/API or its shared service. Check permission for both the operation and the specific record before any query with side effects. Keep web and API authentication consistent. Record who changed what and why; `updatedAt` alone provides no review history or audit log.

**Acceptance:** Exercise each mutation directly as anonymous, ordinary user, researcher and authorized administrator; denied calls must produce no database/provider/cache effect. Include action-reference reuse and alternate calling routes in isolated integration tests. Authorized changes must have an attributable audit event.

### T03: Public reads bypass confidentiality controls

- **What it is:** Some public pages and data views read fields or records intended for internal use.
- **Impact:** Private notes, contact details, or equipment information could appear to visitors.
- **Why fix it:** Privacy must apply everywhere the data appears, including graphs and downloads.

**High · high confidence · source-confirmed; no private production data was retrieved.**

**Evidence:** [`app/inventory/page.tsx:37–50`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/inventory/page.tsx#L37) defaults to operator mode and queries every inventory row; [`162–190`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/inventory/page.tsx#L162) renders exact locations, serials and custodians unless a caller opts into public display mode. [`app/database/page.tsx:46–65`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/database/page.tsx#L46) queries inventory and submissions without an authorization filter; [`92–93`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/database/page.tsx#L92) derives columns from all returned fields and [`163–180`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/database/page.tsx#L163) prints previews. Truncating each displayed field to 48 characters still discloses data. These pages are outside the middleware matcher.

[`app/profile/page.tsx:25–26`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/profile/page.tsx#L25) and [`173–193`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/profile/page.tsx#L173) publicly list recent users' names, email addresses and roles. [`app/contributions/page.tsx:50–80`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/contributions/page.tsx#L50) does not constrain visibility. Graph loading includes all contributions and submissions; [`lib/network-graph.ts:373–398`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L373) drops contribution visibility, and [`460–485`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L460) retains unapproved submission notes/review excerpts. Its private-node filter excludes nodes only if `includePrivate === false` at [`831–841`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L831), while the public API allows caller control at [`app/api/network/graph/route.ts:21`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/network/graph/route.ts#L21). Private inventory is partly redacted in the graph, but that is not a general confidentiality policy.

**Failure scenario and impact:** Someone adds private inventory or a pending submission for internal work, and another public view exposes it despite a secured administrator console. The graph may reveal submission titles/notes and private contribution descriptions before review. Existing sensitive records and the approved public/private policy are unknown, so the amount of actual exposure cannot be stated.

**Adjustment:** Define which fields public queries may return and which visibility/review conditions records must meet. Require verified operator access to internal pages. Public callers must never choose whether to include private data. Apply the same policy to graph/detail endpoints, analytics, maps, exports and metadata. Keep participant/account directories private unless publication is explicitly intended and consented.

**Acceptance:** Seed synthetic public/private/pending fixtures in a disposable database. Crawl anonymous HTML, React server payloads, graph/detail JSON and public exports; no private fixture marker may appear. Authorized operator paths must still work. Test privacy through every projection, not only a display toggle.

### T04: Public map requests can send internal data and start costly work

- **What it is:** Opening or refreshing the map can start AI work using internal data.
- **Impact:** Private information could leave the app, and repeated requests could waste API budget.
- **Why fix it:** External data sharing and costly work need clear permission, limits, and controlled inputs.

**High · high confidence · source-confirmed; external processing and load impact untested.**

**Evidence:** [`app/map/page.tsx:72–85`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/page.tsx#L72) calls `fetchContributionClusters` while rendering a public GET. On a cache miss it calls the model at [`app/map/actions.ts:249–265`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L249). [`84–121`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L84) queries all contributions, robot models and inventory without visibility filters or limits. [`141–155`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L141) sends inventory custodian/owner, location and notes in the model prompt. [`269–292`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L269) exposes reanalysis/shared-cache mutation without authorization, throttling, locking or deduplication.

**Failure scenario and impact:** An anonymous visitor opens a cold map, causing internal inventory data to be sent to an external model whenever a real key is configured. Repeated reanalysis or concurrent cold requests can duplicate full-corpus work, API charges and cache races. Growth increases request payload and token cost without a budget check. No current billing, consent configuration or production API calls were inspected.

**Adjustment:** Public GETs should read an approved cache only. Require permission to queue an analysis job with a defined budget, and send only approved public fields to the model. Use a single-flight/distributed lock to prevent duplicate jobs, limit corpus size and tokens, and explicitly approve data sent outside the app. Store public and internal results separately.

**Acceptance:** A cold anonymous map GET makes no model request and sends no private fixture data. Unauthorized reanalysis is rejected before queries/calls. Concurrent authorized requests produce one job; oversized inputs and quota exhaustion produce a clear bounded failure. Inspect a stubbed outbound request to prove minimization.

### T05: Database setup instructions do not match the configured client

- **What it is:** The setup guide gives one kind of database address, while the app uses a connection method designed for another.
- **Impact:** Someone following the guide could build the app successfully but find that database features fail.
- **Why fix it:** A reliable setup guide must match the connection method that is actually tested.

**High · high confidence for configuration mismatch; runtime failure not reproduced.**

**Evidence:** [`.env.example:1`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/.env.example#L1) and [`docs/vercel-deploy.md:7–16`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/docs/vercel-deploy.md#L7) prescribe a `prisma+postgres` Accelerate-style URL. [`lib/prisma.ts:6–17`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/prisma.ts#L6) passes `DATABASE_URL` to `PrismaPg`, and [`lib/seed-importer.ts:58–66`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L58) uses the same direct PostgreSQL driver adapter. No Accelerate extension/client transport is configured in these paths. The adapter's installed primary source accepts a string and converts it to a PostgreSQL pool `connectionString`; passing a string itself is valid.

**Failure scenario and impact:** An operator follows the documented URL format while the runtime expects a direct PostgreSQL driver connection. Database-backed pages, seeding or ingestion can then fail on their first query. Type generation/build/typecheck do not test connectivity. The deployment may use a working direct URL; its current connection was not tested.

**Adjustment:** Choose one supported runtime transport and document it consistently. For `PrismaPg`, require a direct/pooler PostgreSQL connection URL and validate the allowed scheme; alternatively configure the intended proxy/Accelerate client correctly. Specify separate migration/direct URLs where necessary, TLS expectations, pool size and serverless connection budget. Align Prisma package versions deliberately, then verify together.

**Acceptance:** From a fresh disposable PostgreSQL environment and a production-like runtime, apply committed migrations and run a read/write transaction through the actual shared client. Invalid URL schemes must fail with an actionable startup/configuration error. Verify the chosen hosted transport separately before deployment.

**Compatibility limit:** The v6 client/v7 adapter mix passed the fresh typecheck. Runtime compatibility remains unverified because this audit did not connect either client to a database or benchmark connection pools.

**Configuration checks added after comparing fork studies:** [`lib/prisma.ts:6–17`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/prisma.ts#L6) checks the URL and constructs the shared client as soon as the module is imported. If configuration is absent, an import can fail before a page reaches its later query-error handling. Constructing the client is not proof that a database connection has succeeded. A lazy factory, as explored by the haketag fork, can change when this happens; it does not fix an incompatible connection URL. Separately, `postinstall` loads Prisma configuration before the README's environment-setup step; T13 now records this clean-install ordering defect.

**Additional acceptance:** Test configuration loading, client import, schema generation and an actual database query separately. Document which steps require a URL and which require a running database. Missing runtime configuration must have a clear error; installation/schema generation must either work without live database access or state their prerequisites before the install command.

### T06: Long ingestion tasks depend on a web request staying alive

- **What it is:** A web request must stay alive while a whole batch of sources is downloaded, analyzed, and saved.
- **Impact:** A timeout or restart could leave half-finished data and jobs that never report completion.
- **Why fix it:** Long tasks need recoverable progress so retries do not repeat work or hide partial failures.

**High · high confidence · source-confirmed design risk; duration and load failure unmeasured.**

**Evidence:** [`app/api/ingest/[adapter]/route.ts:7–22`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/ingest/%5Badapter%5D/route.ts#L7) directly awaits an adapter; [`app/actions.ts:104–129`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L104) records RUNNING and awaits the same work. [`lib/ingest/save.ts:11–34`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/save.ts#L11) processes each record serially, with geography plus optional model calls before persistence. Provider fetches in [`lib/ingest/adapters.ts:22–125`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/adapters.ts#L22) and Gemini fetches in [`lib/classifiers.ts:138–190`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/classifiers.ts#L138) have no application deadline, retry/backoff or cancellation. IP-geolocation HTTP alone has a 2.5-second timeout; DNS lookup has no explicit deadline. REST ingestion does not create `SourcePullJob` at all.

**Failure scenario and impact:** A provider stalls or a batch exceeds the host's request limit after earlier rows have committed. If the host kills the process before its catch/final update, jobs can remain RUNNING; REST ingestion leaves no job record at all. Retrying repeats model and geography work without a reliable way to resume or count progress. Concurrent requests can spend the same quotas independently. Host-specific timeout values were not assumed or tested.

**Adjustment:** Use durable jobs with idempotency keys, bounded batches, saved progress/checkpoints and a retry policy. Route REST and UI requests through the same service and job history. Set limits for provider/DNS/model time, per-user and global concurrency, daily API budget and database resource use. Record partial and complete success separately.

**Acceptance:** Stub hangs, 429s, transient errors and process interruption; jobs must become retryable/terminal rather than stay RUNNING indefinitely. A retry resumes safely, reports exact created/updated/skipped counts, and does not duplicate paid work unnecessarily. Demonstrate bounded concurrency under a small controlled load.

### T07: Source and derived-record updates lack a shared atomic version

- **What it is:** Source records and their generated summaries or relationships are updated separately, without a shared version.
- **Impact:** An edit or failure can leave old claims attached to changed or rejected evidence.
- **Why fix it:** Readers need a consistent set of current facts, and reviewers need protection against lost edits.

**High · high confidence · source-confirmed; fault/concurrency scenarios not run.**

**Evidence:** [`lib/ingest/save.ts:65–128`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/save.ts#L65) upserts a source, then annotation, then triplets with separate calls. Existing annotations/triplets are not removed or superseded when a source changes classification or when model outputs change; annotation uniqueness includes the evidence text. The source update overwrites relevance and metadata. CMS source updates at [`app/actions.ts:246–270`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L246) read metadata separately before writing a full payload, without revision checks. [`app/actions.ts:90–93`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L90) changes submission review status without publication work or reviewer attribution.

**Failure scenario and impact:** Reingesting an accepted source as rejected leaves its old annotations/triplets behind. A crash after saving the source leaves only some derived records. Two reviewers saving stale forms can silently overwrite each other's work. Changing a status to approved does not publish the record and its history in one atomic operation. The companion audit examines approval/publication behavior in detail; the code has no shared service that enforces this transition.

**Adjustment:** Save each analyzed version and its complete derived set in a transaction, or stage a version and activate it atomically. Store human review decisions separately from machine suggestions. Supersede invalid derived records when evidence/classification changes. Check versions before saving edits and keep an append-only history of who changed what and why. When approval should publish a record, perform both in an idempotent service transaction.

**Acceptance:** Inject failure at each write boundary; readers must observe a consistent old or new version. Reclassifying accepted→rejected and changing evidence must remove/supersede obsolete public derivatives. Two edits against the same version must produce a conflict or merge, not silent lost work. Retrying approval must not duplicate published records.

### T08: Development startup can overwrite reviewed database state

- **What it is:** Starting the normal development command also reloads seed data into the configured database.
- **Impact:** It could undo reviewed corrections or rejected records, and restore a seed account's administrator role.
- **Why fix it:** Starting the app should not silently change shared data or user permissions.

**High · high confidence · source-confirmed; no watcher or import executed.**

**Evidence:** [`package.json:10–12`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/package.json#L10) makes `dev` run [`scripts/dev.ts:3–4`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/scripts/dev.ts#L3), which starts both Next.js and the seed watcher. [`scripts/watch-seed.ts:16–27`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/scripts/watch-seed.ts#L16) uses the configured database; [`37–50`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/scripts/watch-seed.ts#L37) imports once immediately, then on file changes. [`lib/seed-importer.ts:153–171`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L153) overwrites source title, excerpt, metadata and relevance with ACCEPTED during updates, irrespective of human review. [`72–75`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L72) restores a seed user's ADMIN role. [`388–397`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L388) creates job rows on each corresponding import rather than upserting them.

**Failure scenario and impact:** A developer starts the normal dev command with a shared/staging database URL. Startup silently reimports the corpus and replaces editorial corrections/rejections; a restart can also restore an intentionally revoked role. Partial imports can interleave with web writes. Running the import manually still overwrites reviewed source fields, even without the watcher.

**Adjustment:** Remove seeding from ordinary app startup. Require an explicit development command against a clearly identified disposable database. Validate and stage imports, preserve manual decisions, record each batch's origin and show a dry-run diff before applying changes. Keep role provisioning separate from recurring corpus synchronization.

**Acceptance:** Starting the app alone performs no writes. Reject or explicitly guard imports aimed at protected environments. In an isolated database, rejecting/correcting a source and demoting a seed account must survive an ordinary restart/reimport. Repeated identical imports must be idempotent and report proposed changes before application.

### T09: Type assertions and normalization substitute for runtime validation

- **What it is:** Several inputs are converted or stored without checking that their values are allowed and sensible.
- **Impact:** Bad links, unsupported statuses, or invalid numbers could enter the system or cause confusing failures.
- **Why fix it:** Invalid input should be rejected clearly before it reaches the database or an external service.

**Medium · high confidence · source-confirmed; URL behavior reproduced locally.**

**Evidence:** [`lib/url.ts:3–27`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/url.ts#L3) returns the original input for non-HTTP schemes and parse failures. A pure diagnostic freshly returned `javascript:alert(1)` and `not a URL` unchanged, while correctly normalizing a valid tracked HTTPS URL. Callers treat any nonempty canonicalized result as a valid URL, e.g. [`app/actions.ts:20–23`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L20), [`237–260`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L237). Submission fields at [`60–82`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L60) lack server-side lengths, type allowlists or URL checks. Enum casts (`as any`/`as SourceType`) and `Number(...)` accept unchecked request values in CMS and ingestion. [`app/api/ingest/[adapter]/route.ts:9–19`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/ingest/%5Badapter%5D/route.ts#L9) has no supported-adapter/finite-positive-integer validation. Adapters apply upper limits but no lower/integer checks. Model JSON is parsed and type-asserted at [`lib/classifiers.ts:203–219`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/classifiers.ts#L203); map JSON is likewise trusted at [`app/map/actions.ts:230–242`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L230).

**Failure scenario and impact:** Malformed requests can trigger generic Prisma/provider errors, store invalid taxonomy strings, unusable links or out-of-range confidence, or waste processing. Valid JSON from a model can still contain invalid scores/coordinates or unsupported claims. The app needs its own validation and evidence checks alongside prompt instructions and provider response schemas.

**Adjustment:** Validate action/API inputs, imports and provider responses against runtime schemas with explicit limits. Reject invalid URL schemes and keep URL validation separate from canonicalization. Check role/status/type transitions, integer ranges, ID existence and string size. Validate model confidence/coordinates and evidence references before publishing outputs. Return safe structured 4xx/validation errors.

**Acceptance:** Table-driven boundary tests cover negative/fractional/NaN limits, unsupported adapters/enums, oversized fields, malformed/non-HTTP URLs, unknown IDs and malformed/out-of-range model output. Invalid input must cause no persistence/provider call. Browser XSS remains unproven: this diagnostic did not test or bypass React/browser protections.

### T10: AI errors can become permanent shared cache content

- **What it is:** When map analysis fails, invented results can be saved in the same place as real results and reused indefinitely.
- **Impact:** Visitors may keep seeing unsupported claims even after the original AI problem is resolved.
- **Why fix it:** A failure must stay visible, and saved results need evidence, a version, and a freshness check.

**High · high confidence · source-confirmed; external model availability not freshly tested.**

**Evidence:** [`app/map/actions.ts:19–81`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L19) defines hardcoded institution/project/count clusters; [`249–265`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L249) returns them on model failure. Reanalysis writes those fallback clusters into the ordinary cache at [`269–286`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L269). Any array stored under the single cache key is returned at [`251–255`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L251), without expiry, schema version, input revision, validation or failed/provisional marker. The Gemini model identifier is hardcoded in both [`lib/classifiers.ts:138`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/classifiers.ts#L138) and [`app/map/actions.ts:174`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L174).

**Failure scenario and impact:** A missing key, provider failure or rejected model request causes reanalysis to replace a real cache with unsupported fallback content. Even after the provider recovers, later reads keep accepting that array indefinitely. When analyses run concurrently, the last write wins. A service failure can therefore leave shared unsupported claims in place. The companion report examines those claims and the map's meaning in detail.

**Adjustment:** Preserve the last validated result with its age and input provenance. Show unavailable/stale status on failure and never write invented data to the production cache. Use cache keys tied to revisions, set an expiry and allow one job to publish at a time. Keep model configuration in one place and record model/prompt/schema versions and failure mode with each result. Check model availability before implementation/deployment. The retirement research from 12 October remains historical; this audit made no fresh API check.

**Acceptance:** Stub key absence, HTTP error, timeout, empty/malformed JSON and out-of-range output. None may publish fallback facts or overwrite good results. A corpus change must invalidate or visibly stale the result; an older concurrent job must not replace a newer version. Provider/model changes must be configurable and observable.

### T11: CSV export permits formula interpretation and loads whole tables

- **What it is:** CSV downloads do not neutralize text that spreadsheets may interpret as formulas, and they load entire tables at once.
- **Impact:** Opening untrusted data could be unsafe in some spreadsheet settings, while large exports could overload the app.
- **Why fix it:** Downloads need safe text handling, appropriate fields, and limits on memory use.

**Medium · high confidence · source-confirmed; no spreadsheet execution or load benchmark.**

**Evidence:** [`app/api/export/route.ts:12–29`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/export/route.ts#L12) loads all rows with no pagination or projection; [`45–63`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/export/route.ts#L45) escapes delimiters/quotes and constructs all CSV text in memory. A text cell beginning `=1+1` passes this escaping logic unchanged; quoting CSV syntax does not itself establish that a spreadsheet treats content as literal text. Submission and CMS inputs can populate exported fields. The route is intended to be administrator-only, but T01 undermines that boundary. It also exports full submission fields, so access and field policy matter independently.

**Failure scenario and impact:** An operator opens an exported file containing attacker-supplied formula-like text in a spreadsheet. Interpretation depends on spreadsheet/import settings, which were not tested. A large table can also create multiple in-memory copies and exceed runtime limits. These are separate bounded export concerns, not a claim of server-side code execution.

**Adjustment:** Offer a documented spreadsheet-safe CSV mode that preserves suspicious values as literal text, use explicit export schemas/redaction, and stream or page bounded snapshots. Authenticate exports through the same verified capability as the UI. Return explicit invalid-table errors rather than silently exporting sources for unknown table names.

**Acceptance:** Fixture cells beginning `=`, `+`, `-`, `@` and relevant whitespace/control characters round-trip as text through the supported spreadsheet workflow; commas/quotes/newlines remain correct. Large fixture exports use bounded memory and preserve stable column/types and visibility policy.

### T12: Operational errors and cache freshness are inconsistent

- **What it is:** Different screens report failures and refresh saved results in different ways.
- **Impact:** A broken connection may look like an empty database, or an old visualization may look current.
- **Why fix it:** Users and operators need to distinguish missing data, service failure, and outdated results.

**Medium · high confidence · source-confirmed; outage behavior not run against a database.**

**Evidence:** Inventory, contribution and raw-browser queries initialize empty arrays and catch failures without an unavailable state: [`app/inventory/page.tsx:45–53`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/inventory/page.tsx#L45), [`app/contributions/page.tsx:64–88`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/contributions/page.tsx#L64), [`app/database/page.tsx:35–90`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/database/page.tsx#L35). In contrast, overview and analytics set `dbOffline` at [`app/page.tsx:113–115`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/page.tsx#L113) and [`app/analytics/page.tsx:258–260`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/analytics/page.tsx#L258). The graph uses explicit provenance/warnings but can return HTTP 200 with an empty fallback envelope on default-source error at [`app/api/network/graph/route.ts:26–44`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/network/graph/route.ts#L26).

[`app/actions.ts:39–57`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L39) revalidates many CMS routes but omits `/map` and `/network`. Graph content has a separate process-local 60-second single-entry cache at [`lib/network-graph.ts:853–860`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L853); map content has no age check (T10). Ingestion job errors are stored/logged, while API errors can expose raw exception messages. There is no shared structured health/error contract in these paths.

**Failure scenario and impact:** A database failure appears as an empty collection, so users/operators cannot tell whether data is missing or the service is down. Successful corrections may leave visualizations stale, and server instances can return different cached graphs. Operators have no durable incident/job view or reliable alert signal beyond logs.

**Adjustment:** Use consistent unavailable/empty/stale/error results. Redact external errors, attach request/job IDs, add read-only health checks and retain job/error history. Tie derived caches to input revisions and invalidate them explicitly; page revalidation alone does not refresh them.

**Acceptance:** Stub database/provider failures on each read surface and verify unavailable states and meaningful status/telemetry; successful empty queries remain distinguishable. A correction/deletion must invalidate or mark each derived view stale across instances. Health checks must not seed, ingest or invoke paid models.

### T13: Tests and deployment tooling miss the critical runtime boundaries

- **What it is:** The default checks cover only a small part of the app, and some setup commands depend on missing files or Windows tools.
- **Impact:** Important permission or privacy defects can survive passing checks, and setup may fail on another machine.
- **Why fix it:** The release checks and setup instructions need to exercise the app's real workflows on supported systems.

**Medium · high confidence · source-confirmed gaps; some tooling risks unexecuted.**

**Evidence:** [`package.json:30`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/package.json#L30) runs only `test/*.test.ts`; [`test/classifiers.test.ts:5–14`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/test/classifiers.test.ts#L5) contains three classifier assertions. Playwright tests exist separately; the smoke test intentionally uses the administrator simulator and checks page headings/statuses at [`tests-node/smoke.spec.ts:3–35`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/tests-node/smoke.spec.ts#L3). The graph suite checks envelope/rendering and source modes, not authorization or privacy. Python protection tests target FastAPI, not Next.js. No tracked CI workflow was found. [`package.json:13–14`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/package.json#L13) and [`vercel.json`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/vercel.json#L1) build without running unit/privacy/security checks. The no-mock check is a text-pattern script and is not a general data-integrity test.

Tooling also embeds Windows commands: [`scripts/dev.ts:3–4`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/scripts/dev.ts#L3) invokes `pnpm.cmd`; [`prisma.config.ts:9–11`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma.config.ts#L9) uses `tsx.CMD`. [`package.json:22`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/package.json#L22) references `scratch/check-network-sources.mjs`, while `scratch/` is ignored and that file is absent from the tracked checkout. [`docs/vercel-deploy.md:34–41`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/docs/vercel-deploy.md#L34) describes Basic Auth for pages and a placeholder-password 503 behavior not implemented by the middleware. The manifest retains a `next lint` script without tracked ESLint configuration; its actual command result was not evaluated here.

**Failure scenario and impact:** A build or default test run can pass while T01–T12 remain. Contributors on Linux or a new machine cannot rely on the same dev/seed/check commands, and operators may believe the documented configuration guard exists. Separate Python and TypeScript implementations/tests also make it easier to fix the inactive stack. Mixed Prisma major versions, open semver ranges and unpinned Python ranges create maintenance/compatibility risks. No current vulnerability advisory scan was performed, so this audit makes no CVE claim.

**Adjustment:** Check the active stack in CI with a lockfile-frozen install, typecheck, unit tests, isolated authorization/privacy/workflow tests and a production build. Use disposable fixtures and block model/network access by default. Make commands portable, remove or fix dead scripts, document the actual auth/DB/migration steps and state which legacy code is supported. Verify dependency upgrades with runtime smoke tests.

**Acceptance:** A fresh supported Windows and Linux checkout can execute documented non-mutating checks. CI rejects deliberate role escalation/private-data leakage and incomplete approval/reclassification. An isolated migrated database validates real Prisma CRUD. Browser tests must not create simulated users or write shared databases. Build success and database/runtime validation must be reported separately.

**Setup and test gaps added after comparing fork studies:**

| Detail | What it is / impact / why fix it | Source and additional acceptance |
| --- | --- | --- |
| Environment setup comes after installation | The README asks a new contributor to install dependencies before creating `.env`, but installation immediately runs a command that requires `DATABASE_URL`. Someone following the guide in a clean shell can get stuck before reaching the configuration step. The documented order must work on a new machine. | [`README.md:60–73`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/README.md#L60), [`package.json:15`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/package.json#L15), [`prisma.config.ts:1–7`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma.config.ts#L1). Move required configuration before installation, or decouple install-time generation from required runtime configuration. Verify a frozen install in a clean supported Windows/Linux environment; do not reuse a shell with hidden prerequisite variables. No new install was run during this comparison. |
| Lint is not a dependable unattended gate | A lint command exists, but no compatible configuration is tracked. A command that waits for setup choices cannot reliably check code in CI. | [`package.json:17`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/package.json#L17) and the tracked source tree. The phowadol audit reports an interactive prompt; that result is theirs, not a fresh local run. Check in a compatible configuration and verify that the command exits without questions: success for valid code, failure for a deliberately invalid isolated fixture. |
| Production graph tests depend on a development-only handle | The browser tests directly use an internal graph object that the app exposes only in development. Testing a production build can therefore fail because the test handle is absent, even when the visible graph works. | [`NetworkGraphClient.tsx:558–560`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/network/NetworkGraphClient.tsx#L558), [`network.spec.ts:90–119`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/tests-node/network.spec.ts#L90), [`136–139`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/tests-node/network.spec.ts#L136), [`164–168`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/tests-node/network.spec.ts#L164), [`playwright.config.ts:24–34`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/playwright.config.ts#L24). Test an isolated production build using observable behavior or deliberate test-only instrumentation. Keep any test-only handle disabled in ordinary deployments. A dev-server pass must not be reported as production coverage. |
| Some README links point to one developer's computer | Several links open a local path on the original author's machine instead of a file in the repository. Other contributors cannot follow them to understand or repair the app. | [`README.md:289`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/README.md#L289), [`333–340`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/README.md#L333). Replace these with repository-relative links and verify every referenced target in a clean checkout. This is a low-priority documentation defect, not an access-control vulnerability. |
| Seed entry points have different behavior | The Windows-specific `tsx.CMD` belongs to Prisma CLI seeding. The package's `db:seed` command directly runs `tsx prisma/seed.ts`; these are different entry points. Treating both as identically broken can lead to the wrong fix or misleading verification. | [`prisma.config.ts:9–11`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma.config.ts#L9), [`package.json:25`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/package.json#L25). Document and verify both intended entry points separately on supported platforms, against a disposable database. Passing one does not establish the other works or that seeding preserves curation. |

The fork comparison added the install-order and production-test details to our original evidence. Lint and portability were already identified and now have more specific acceptance checks; T05 also covers import-time initialization. The original 27 finding IDs remain unchanged so the captured fork-comparison matrix still applies.

## Lessons from the captured fork audits

This section compares saved fork studies with the unchanged baseline. Their repairs still require our acceptance tests. The sources were the [phowadol audit, B1–B9](https://github.com/phowadol0512-debug/HumanoidTH/blob/3d642b0a658d7264fa942fee7dcd421198178d48/docs/hackday/BASELINE_AUDIT.md), its [Hack Day plan](https://github.com/phowadol0512-debug/HumanoidTH/blob/3d642b0a658d7264fa942fee7dcd421198178d48/docs/hackday/HACKDAY_PLAN.md), the [Teeraphat eight-gap audit](https://github.com/Teeraphat2543Inta/HumanoidTH/blob/a3a3b54994b130f6b004aca45acdc8d72c5ef668/docs/hackathon/BASELINE_AUDIT.md), and our saved fork comparison. We read their Markdown from pinned commits in `research/fork-audit/objects.git` and checked relevant baseline code/configuration locally. Installation, lint, browser and exploit-check results remain the fork authors' historical claims; we did not rerun those checks.

The repair branches and historical PR #3 review add these checks to the existing acceptance criteria:

- **T01/T02:** Verify email ownership as well as the cookie signature. Test role demotion, session expiry/revocation and whether denied actions have side effects. Finding a guard string in the source leaves those behaviors unproven.
- **T03/T04:** Approval must not automatically publish internal review notes. Check both database and file/hybrid graph paths and every newly added related-object API against the same public-field policy.
- **T08:** Inspect any reused seed script for delete-all operations, placeholder ownership claims, or updates that replace reviewed inventory. Such destructive additions belong to particular fork branches; they are not an existing delete-all defect in our pinned baseline.
- **T09/T10:** Deleting the fallback generator does not remove old cached fabricated or private-derived results. Test mixed legacy/new cache entries, invalidate results with unknown origin, validate every output field, and record the actual configured model in provenance. A list of known placeholder IDs alone is not a complete migration.
- **T13:** Preserve command, environment, commit, exit result and output for each check. Keep author claims, our source checks and our executed tests distinct. A passing text-pattern scan or regex guard test does not establish privacy or authorization.

## Related technical observations

- **Graph identity is not stable:** [`lib/network-graph.ts:184–195`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L184) strips non-ASCII characters and truncates labels to 80 characters to make IDs; [`730–757`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L730) uses those IDs for records. Pure local diagnostics reproduced two different Thai-only labels becoming `unknown`, and two long labels differing after character 80 becoming identical. This creates record/relationship conflation and unstable detail identity. Use immutable database/import IDs for record nodes and explicit canonical entity IDs. Detailed graph semantics and acceptance cases are in the companion audit.
- **Analytics limits do not establish totals:** [`app/analytics/page.tsx:60–120`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/analytics/page.tsx#L60) fetches up to 5,000 rows per collection and derives summary counts from array lengths at [`250–256`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/analytics/page.tsx#L250). Graph source queries have separate caps at [`lib/network-graph.ts:304–311`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L304). These are useful resource bounds but need explicit pagination/truncation metadata or database aggregation. The companion audit owns the analytical/dataflow consequences.
- **Geography is an external dependency, not arbitrary-origin HTTP fetching:** [`lib/geo.ts:62–82`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/geo.ts#L62) resolves a record host, then calls a fixed geolocation service. It has private-IP checks and a bounded HTTP timeout, but lookup/private-range completeness and transport confidentiality deserve improvement. No arbitrary-URL server fetch/SSRF exploit was demonstrated here. Provider TLS, allowlisted ranges, IPv4/IPv6 handling, caching and deadlines should be evaluated when ingestion is repaired.

## Positive controls worth retaining

- Prisma models define unique canonical source URLs, unique robot names, indexes, foreign keys and cascading/nulling behavior. These limit exact duplicates/orphan references; they do not establish research validity or authorization. See [`prisma/schema.prisma`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L56) and the committed initial PostgreSQL migration.
- The shared client validates that a database URL exists and reuses a client during development. Explicitly generated client output avoids relying on an implicit global client installation.
- API ingestion targets fixed provider endpoints; provider-side page-size ceilings and graph response-size clamps exist. The graph API clamps node/edge output at [`app/api/network/graph/route.ts:22–23`](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/network/graph/route.ts#L22).
- `canonicalizeUrl` removes fragments/tracking parameters and normalizes host/trailing slash for valid HTTP(S) inputs; preserve that behavior after adding strict validation.
- The graph exposes data origin, warning and truncation metadata, and some private inventory fields are redacted. This is a useful starting point for consistent public read models.
- Basic credentials are checked on intended ingest/export API routes, even though fallback/session defects make the overall protection insufficient. The audit did not find interpolated raw SQL in the reviewed active Next.js persistence paths; ORM filters and React text rendering should be retained.
- `.gitignore` excludes local environment files, generated client/build artifacts and local databases. A committed lockfile and migrations exist. Current secret leakage across all Git history was not audited.
- Build commands generate the Prisma client without automatically pushing schema changes. Keep deployment migrations explicit, reviewed and separate from application builds.

## Recommended remediation order

1. **Close authority and disclosure boundaries before adding sensitive records:** T01–T04. Define verified roles and public field/row policy together; repair handlers as well as pages. Remove static fallbacks and production simulators, then invalidate existing sessions.
2. **Make the baseline reproducible against an isolated database:** T05 and the deployment portion of T13. Select the real connection transport, align package policy, apply committed migrations and verify actual CRUD without running the watcher.
3. **Protect human decisions and publication:** T07–T08. Separate imports/machine suggestions from editorial state, introduce actor/revision history and atomic derived-version/publication transitions. Remove seeding from ordinary startup.
4. **Bound external work and preserve failure truth:** T06, T09–T10, T12. Put paid/long work behind authorized jobs and budgets; validate outputs; never turn failures into invented persisted data; use revisioned caches and clear unavailable states.
5. **Gate regressions and safe distribution:** T11–T13. Add targeted integration tests and safe exports, portable commands and active-stack CI. Carry the companion audit's graph identity and data-provenance acceptance cases into that gate.

For a small baseline repair, authentication/privacy tests, explicit dev startup, a disposable PostgreSQL integration check, and non-fabricating map failure behavior provide higher value than expanding visualizations or adding more adapters.

## Checks performed and limitations

### Fresh checks for this audit session

| Check | Performer | Result / boundary |
| --- | --- | --- |
| Root README/context/instructions; source-tree inventory | Technical auditor | Read before source audit; prior review was not used as a substitute for source evidence |
| `git -C research/HumanoidTH status --short`, `rev-parse HEAD`, commit metadata | Technical auditor | Clean baseline at the specified commit |
| Source tracing | Technical auditor | Inspected middleware, active routes/actions, public data projections, Prisma schema/migration/client, ingestion/classification/geography, map and graph cache paths, seed/dev scripts, deployment configs and test entry points |
| Pure Node/tsx diagnostic | Technical auditor | Imported only URL helper, read graph source to exercise its slug function, and read installed package metadata; invalid/non-HTTP URL pass-through and Thai/long-label ID collisions reproduced; no database/network |
| Installed adapter signature/constructor | Both auditors | String argument is supported and becomes a pool connection string; not itself a bug |
| Public remote HEAD comparison | Coordinating auditor, reported this session | Remote HEAD equals reviewed commit; deployed revision unverified |
| `node node_modules/tsx/dist/cli.mjs --test test/classifiers.test.ts` | Coordinating auditor, reported this session | Exit 0; 3/3 classifier tests pass |
| `node node_modules/typescript/bin/tsc --noEmit` | Coordinating auditor, reported this session | Exit 0; no proof of database transport, runtime security or hosted compatibility |
| `node node_modules/tsx/dist/cli.mjs scripts/assert-no-mock-data.ts` | Coordinating auditor, reported this session | Exit 1; seven text matches: five map fallback log/comment signals and two network file-fallback wording signals; the latter do not themselves prove fabricated data |
| Report/source-link validation and final checkout status | Technical auditor | Checked before handoff; application source not changed |

The 12 October production build result recorded in project context is historical only; no production build was rerun for this audit. Current external model retirement/availability, provider quotas, dependency advisories and hosted limits were not rechecked. The hardcoded model identifiers are source evidence; any prior external retirement research must retain its original date.

No development server, seed watcher, seed/import/ingestion command, login simulation, database migration, database connection, production mutation or real model call was performed. There was no production log, account, private-record or deployment-settings inspection, penetration test, browser exploit, concurrency benchmark or full legacy-Python security audit. Findings about runtime timeout, billing, actual private exposure, serverless connection behavior and package interoperability remain conditional on their stated deployment/data preconditions. This report deliberately omits credential values and participant information.

### Audit session record

**2026-10-20 (Asia/Bangkok):** completed independent technical source audit at the pinned commit and wrote this report; reproduced pure URL/graph-ID diagnostics and incorporated explicitly attributed fresh coordinator checks. No application changes or live mutations. Outstanding work is remediation and isolated integration verification, with deployed revision/configuration and approved confidentiality policy still unknown.

**Fork-study reconciliation, 2026-10-20:** Expanded T05/T13 and repair acceptance cases using pinned captured studies, a scoped independent source comparison, and direct reads of baseline configuration/tests/docs. No new install, lint, build, browser, credential, database or model execution was performed. The earlier verification results retain their original scope; added checks above remain acceptance requirements until executed.
