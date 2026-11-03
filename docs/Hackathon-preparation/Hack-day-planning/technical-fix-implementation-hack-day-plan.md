# Hack Day Fix Implementation Plan

HumanoidTH · HRI Hackathon Thailand 2026  
Revised 22 October 2026 · Status: planned work; no repairs implemented

## Objective and scope

Three developers will spend 5–6 hours repairing the baseline. The five-hour target is a working public discovery journey: open the atlas, find a checked contribution or robot, inspect its source and return to the results. Retained operator tools must use verified access.

The plan covers all 27 audit findings. Eight must-do packages address 16 findings, including the minimum validation, feedback and navigation needed by the retained journey. Five findings remain in should-do work; six broader findings are listed under if time allows. The delivery commitment is the tested baseline defined below. Finding counts describe planned coverage; restricted functions retain their outstanding repairs.

The new HRI Wellness Living Lab feature needs an explicit build allocation in the same fork. Readiness Search is a proposal; descriptive robot search is also under discussion. Embeddings, cross-record comparison and decision briefs are not settled requirements of this repair plan. Before work starts, record the chosen user task, feature owner, build time and acceptance checks. The repair schedule includes its data contract and integration checks, but does not assume an unassigned feature developer.

## Baseline completion and delivery commitment

### Committed minimum: must-do outcomes

By the end of the five-hour fix window, we commit to the following baseline in the documented test environment:

| Deliverable | Observable completion |
| --- | --- |
| A runnable application | The production build starts, migrations and real Prisma CRUD pass in the disposable database, and ordinary startup leaves reviewed data and roles unchanged. |
| A complete public discovery journey | A visitor can open the atlas, find a checked contribution or robot, inspect its source and return to the results. Retained lists and counts use the same checked dataset. |
| Usable retained controls | Exposed search/filter inputs accept valid values and reject invalid ones. Empty results differ from failures. The journey works on phone and keyboard with Thai/English navigation and visible language selection. |
| Enforced access and disclosure limits | Public responses exclude private, pending and internal-note fixtures. Every active privileged operation checks authorization; unfinished identity, editing, review, ingestion and export paths deny direct invocation. |
| Honest map behavior | The map displays a validated public result or an explicit unavailable state. Public reads trigger no model work, invented fallback claims or writes of untrusted cache content. |
| A reviewable handoff | The fork contains setup instructions, the tested revision, regression and runtime results, a demonstration script, and a repaired/contained/deferred record. |

All six outcomes must pass for this selected baseline scope to count as complete. Core discovery cannot be replaced by an unavailable page. Restrictions apply to unfinished supporting workflows and must be tested at the server. The commitment covers the retained journey and its safeguards; broader audit acceptance criteria remain open where only part of a finding is repaired.

Operator login and exact CMS inspection are implementation targets within M2/M6. They become available only after their checks pass; the committed minimum can run as public read-only discovery with legacy identity and write paths blocked. Publication, live ingestion, a working graph, CSV downloads and whole-corpus analytics have separate completion conditions below.

### Ideal result: must do plus verified should-do work

The ideal result adds a complete, relevant should-do package to the committed baseline. We will select the package after essentials pass and only if its dependencies, implementation and retest fit the remaining allocation. Every added function must meet its listed completion checks before it is demonstrated as working.

Completing all three should-do packages would add an estimated 270–450 person-minutes. The optional sixth hour provides at most 120 person-minutes for changes across three developers, followed by 60 person-minutes of retesting. We therefore promise the must-do outcomes and treat should-do completion as additional delivery. The full must-plus-should scope needs separately assigned time.

The six if-time-allows findings remain a longer-term backlog. Their minimum restrictions are included in the committed baseline. A new wellness feature remains a separate event deliverable; completing baseline fixes alone does not complete the hackathon submission.

## Baseline and implementation approach

The audit baseline is upstream commit [`bef80bd`](https://github.com/taechasith/HumanoidTH/tree/bef80bdfe895f9403af910951fa251c9baacad2b). The team fork was at `a6ba556`, branch `docs/hri-hackathon-prep`, when this revision was prepared; its application code matched that baseline. Record the actual fork URL and revision again at execution.

Keep Next.js App Router, React and Prisma/PostgreSQL. Use a disposable database and synthetic privacy fixtures. Stub external providers during failure tests. Credentials stay outside Git. Test the actual Prisma connection and the final production build.

The known failures include client-controlled identity in [server actions](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts), invented [map results](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts) and automatic trust assignments in the [seed importer](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts). Restrict unfinished paths at the action/API as well as the interface.

## Functions available at handoff

The table separates committed behavior from conditional extensions. Add the selected new feature and its build allocation before implementation begins.

| Function | Committed behavior or conditional extension | Owner | Completion check |
| --- | --- | --- | --- |
| Overview and robot registry | Public records and counts follow the checked-data policy. Robot cards expose source links; no new registry search is assumed. | Suk-Nsr | Private/unverified fixtures stay absent; a checked robot opens its evidence. |
| Contribution discovery | Text search and exposed type/organization/robot/status filters work on the permitted subset. Empty results and query failures differ. | Suk-Nsr | Valid statuses return expected IDs; unknown values fail clearly; search-to-source-to-results works. |
| Navigation and language | The retained journey is reachable on phone and keyboard, with visible language selection and named controls. | Pongchayanneung | At 390px and desktop, complete the journey in both languages without typing route URLs. |
| Operator login and record inspection | Conditional extension within M2/M6: one configured operator can inspect an exact CMS record after session/selection checks pass. Otherwise identity-dependent routes and actions remain blocked. Public registration, role simulation and unsafe editing stay disabled. | NoneTP | Retained sessions reject forged/expired/revoked credentials; oldest-of-101 and missing IDs never select another record. If unavailable, direct calls deny access. |
| Map | Show a clear unavailable state unless a validated public result passes all checks. Generation/reanalysis stays disabled. | Pongchayanneung | Cold reads and denied actions make no model calls, cache writes or invented claims. |
| Submission and publication | Public submission, approval and correction actions remain unavailable until one complete publication workflow passes S5. | NoneTP | Direct calls are denied; the interface states that publication is unavailable. |
| Graph, CSV, raw database and private inventory | Restricted until their access and function checks pass. | Suk-Nsr/NoneTP | Alternate URLs, query flags and file/hybrid modes cannot bypass restrictions. |
| Analytics and perspectives | Retain only a checked subset with clear scope/date labels if it passes privacy and stale-claim checks; otherwise show unavailable. | Suk-Nsr | Totals identify the included subset; rejected-source derivatives are absent. |
| Live ingestion and reclassification | Disabled for this release. | NoneTP/Pongchayanneung | Direct actions/APIs cannot invoke providers or alter records. |

A restricted workflow remains an outstanding repair. It does not count as a completed function.

## Must do

The allowances below fit the 130-minute implementation block for each developer. They include focused tests for the committed scope and conditional operator targets. If a target exceeds its allowance, apply its tested restriction and prioritize the baseline completion checks. M7's shared integration and release work appears separately in the schedule. These allowances are planning limits rather than measured delivery times.

| Package | Findings | Planned work and acceptance | Owner allowance |
| --- | --- | --- | --- |
| M1. Reproducible startup | T05, T08 | Match configuration to the actual Prisma connection; remove seed watching from ordinary startup; guard both seed entry points. Migrations and real CRUD work in the disposable database; restart preserves decisions and roles. | Pongchayanneung: 45 min |
| M2. Identity and action boundaries | T01, T02 | Remove simulated identity and fallback credentials; block legacy identity-dependent paths. Retain operator access only with server-verified, expiring/revocable sessions and permission checks before side effects. Missing configuration and forged/denied requests fail without writes or provider/cache work. | NoneTP: 100 min maximum |
| M3. Public-data protection | T03, D03 | Use permitted-record filters and explicit fields on retained views. Deny unsafe routes and derived outputs by default. Private, pending and internal-note markers stay absent from HTML, React payloads and JSON. | Suk-Nsr: 85 min |
| M4. Honest map output | T04, T10, D01 | Remove invented fallbacks, reject unknown-origin caches and disable generation/reanalysis. Failure yields unavailable; public reads trigger no model calls or shared-cache writes. | Pongchayanneung: 35 min |
| M5. Checked demonstration data | D04 | Define a small versioned public manifest; separate imported status from human review. Correct or exclude source-type errors, placeholders, duplicates and unsupported claims used by the demo. Preserve the original corpus. | Suk-Nsr: 30 min |
| M6. Exact review target | D09 | For retained operator inspection, load the exact authorized ID or show missing; check oldest-of-101, deleted and unknown IDs. Otherwise deny CMS inspection/actions. Approval/publication stays disabled pending S5. | NoneTP: 15 min |
| M8. Usable retained journey | D10, T09, T12, D14 | Validate retained inputs, fix contribution statuses, distinguish empty/failed/stale results and provide phone/keyboard navigation and language access. Full site-wide cleanup remains open. | NoneTP: 15; Suk-Nsr: 15; Pongchayanneung: 30 min |
| M7. Release checks | T13 | Prepare the focused check commands, then integrate, verify and rehearse the retained journey. Record the tested revision and remaining work. | Pongchayanneung: 20 min preparation; shared checks in schedule |

M8 promotes the old filter, validation/feedback and selected-journey accessibility work from should do. Adding it requires narrower defaults elsewhere: M3 restricts derived tools, and M4 leaves map generation off.

M2 targets one operator account with secure cookie attributes, expiry, revocation and protection against repeated login guesses. If that does not fit its allowance, deny identity-dependent routes and actions, including profile and submission paths that trust legacy email cookies. Use the public journey in read-only mode. Record identity and review tools as contained, with their full repair outstanding.

## Data policy and feature dependencies

M5's manifest records dataset version, typed record ID, canonical source URL, record type, checked claims, reviewer/date, uncertainty and public eligibility. Use only claims that can be checked within the allowance. A small corpus must contain useful candidates for the chosen journey; an empty registry or missing field stays explicit.

Apply that same membership policy to lists, counts, downloads and any feature index. Inherited ACCEPTED/APPROVED values do not establish human review. Broader search over the original corpus needs a separate publication policy; an unverified label alone does not authorize disclosure. Repair source-type labels for retained records and keep excluded placeholders/duplicates out of results. Full import reconciliation remains deferred.

The feature build must use the same public-record projection. NoneTP owns access/reference validation, Suk-Nsr owns public data and search-result fields, and Pongchayanneung owns runtime/fallback integration. These are integration responsibilities within the repair window. Feature implementation needs the separate build allocation below.

| Feature choice or dependency | Required before it is demonstrated |
| --- | --- |
| Any new search | Name the wellness/HRI user and decision it supports. Query only permitted records; use typed IDs plus canonical URLs; validate input and show evidence, unknown fields, empty results and failures. Check several reviewed queries, not one rehearsed example. |
| Embeddings/indexes, if selected | Filter inputs before index generation. Public files, snippets and neighbor expansion must exclude private data. Record corpus/text/model settings and index version; query/build settings must match. Recheck eligibility at retrieval and stop using stale indexes after corrections/exclusion. Test corrupt/stale indexes and provider failure with an honest fallback. |
| Saved/imported selections, if selected | Treat imported IDs/URLs as untrusted references. Recheck current records; show missing or unavailable sources without retrieving restricted data. Browser-held notes remain user-authored material, not evidence of verification. |
| Full Readiness Search, if selected | Demonstrate 2–3-record comparison, source-backed fields with `unknown`, reload persistence, brief export/import round-trip, missing-source handling and visible storage errors. Disclose title-only paper inputs; do not infer compatibility. |
| Submission/correction as the feature journey | Promote S5 before implementation and fund its publication transaction and retry checks. |
| Graph or legacy CSV as part of the journey | Promote S4 or S3 respectively. Search need not use the graph; JSON/Markdown decision briefs have their own validation and do not require the old CSV endpoint. |

The new feature must run in the same fork and production demonstration build. Its wellness fit and retrieval benefit need evidence; this plan makes no clinical, adoption or compatibility claim.

## Should do

These packages define the ideal extensions beyond the committed baseline. There is no stretch slot in the five-hour base. Start a package only after essentials pass and its implementation plus retest fits assigned capacity. Promote a feature dependency before work starts and remove equivalent scope or assign separate time.

| Priority/package | Findings | Completion target | Planning estimate |
| --- | --- | --- | --- |
| First: S5. One complete publication workflow | D02 | Submit/review one selected type, publish or correct the exact target atomically, retain reviewer/target linkage, retry without duplication and leave no partial publication on failure. Other types stay restricted. | 120–180 person-min |
| Next: S3. Correct CSV downloads | T11, D12 | Match table, permitted fields and search membership; use spreadsheet-safe text, headers-only empty files, valid table selection and bounded execution. | 60–120 person-min |
| Then: S4. Dependable graph | D07, D08 | Stable typed IDs preserve distinct Thai/long names. Separate reviewed assertions from inference; verify relation evidence and all graph/detail source modes. | 90–150 person-min |

These estimates include focused checks, not a promise that a whole package fits the sixth hour. A larger package normally needs separately assigned time.

## If time allows

These six findings sit outside the promised baseline and the should-do target. They need broader persistence or data-quality work and normally continue after Hack Day. Minimum restrictions remain part of the must-do packages.

| Findings | Broader work | Restriction until verified |
| --- | --- | --- |
| T06, D13 | Recoverable ingestion jobs, checkpoints/retries, consistent UI/API/CLI history and accurate new/updated/partial counts. | Disable live ingestion; use the checked corpus. |
| T07, D06 | Source/assertion versions, retirement of stale claims, edit-conflict handling and reproducible snapshots. | Disable unsafe edits/reclassification. Any retained publication or feature-index eligibility change still needs consistent state handling. |
| D05 | Bilingual relevance/stance evaluation, sufficient source text and calibrated uncertainty. | No automatic publication of machine suggestions. Mark missing evidence and title-only inputs where applicable. |
| D11 | Whole-corpus aggregation, coverage and publication/observation/ingestion-date distinctions. | Use labeled subset totals or leave charts unavailable. |

Full inventory reservations, maintenance/custody workflows, bulk CMS operations and site-wide translation/accessibility remain possible later work.

## Responsibilities and schedule

NoneTP owns shared action/permission changes. Suk-Nsr owns public queries, the manifest and contribution filters. Pongchayanneung owns startup, map restrictions, navigation/error UI and integration. Changes to shared actions go through NoneTP; schema changes require agreement among the three.

| Elapsed time | NoneTP | Suk-Nsr | Pongchayanneung |
| --- | --- | --- | --- |
| 00:00–00:20 | Agree capabilities, feature allocation and access contract. | Agree public fields, corpus and feature data contract. | Confirm revision, isolated database and supported runtime. |
| 00:20–02:30 | M2: 100 min; M6: 15; M8 input checks: 15. | M3: 85 min; M5: 30; M8 filters: 15. | M1: 45 min; M4: 35; M8 UI: 30; M7 command preparation: 20. |
| 02:30–03:30 | Integrate action/session checks and repair failures. | Test cross-view privacy, manifest membership and feature-result eligibility. | Run actual DB/build checks and integrate retained navigation/feature interfaces. |
| 03:30–05:00 | Freeze scope; verify access and any retained CMS functions; repair failures and rehearse. | Verify privacy, dataset membership and discovery; repair failures and rehearse. | Run production release checks, record results and coordinate the demonstration. |
| 05:00–05:40, if available | Recover essentials first; take an agreed should-do slice only if its whole change fits. | Recover essentials or verify feature data; support only a fitting agreed extension. | Recover essentials or verify the built feature; integrate any agreed extension. |
| 05:40–06:00, if available | Rerun affected access/record checks and rehearse. | Rerun affected data/discovery checks and rehearse. | Rerun affected runtime/build checks and rehearse the final revision. |

Each developer has 300 minutes in the base: 20 setup + 130 implementation + 60 integration + 90 release. The three lanes total 15 gross person-hours. The sixth hour adds at most 40 minutes of changes and 20 minutes of checks per person. M7 is counted in these blocks once.

At hour one, a database or identity approach with no viable testable path triggers the local-runtime or read-only fallback. At hour three, settle remaining route restrictions. By 03:30, every retained function must pass or be restricted; failure of core public discovery or its privacy checks blocks the baseline release. The sixth hour is recovery capacity first. Should-do work never consumes the final checks or replaces an unfinished committed outcome.

Feature build allocation must be settled before kickoff. If the same three people must also build the feature inside this window, use the read-only variant: NoneTP spends at most 30 minutes of the 130-minute implementation block denying legacy identity/write paths and testing denial, then at most 100 minutes on a separately bounded feature slice. Suk-Nsr and Pongchayanneung keep their data/runtime work. Operator login, review and publication then remain contained. This variant does not promise the full Readiness Search specification; reduce the feature to a testable scope before starting. If no feature can be built and verified in its allocation, record the event deliverable as incomplete.

## Acceptance and delivery evidence

Use disposable public/private/pending fixtures and test doubles for provider failures. For each repaired behavior, record a regression that exposes the original failure and passes after the change.

- [ ] Each capability has an owner, working/restricted outcome and check result at the submitted revision.
- [ ] All six committed baseline deliverables pass. Conditional operator tools and any completed should-do work are reported separately from the minimum delivery.
- [ ] Forged, expired, revoked and unauthorized identity/action/API requests cause no database/provider/cache side effects. Authorized retained operations work.
- [ ] Private, pending and internal-note markers stay absent from anonymous HTML, React responses, APIs, file/hybrid paths and feature artifacts. Query flags cannot bypass policy.
- [ ] Missing keys, provider errors, DB failure and unknown-origin caches produce no invented map claims. Cold map reads make no model calls or cache writes.
- [ ] Exact review IDs never select substitutes. Unfinished submission/publication and editing paths deny direct invocation.
- [ ] Valid contribution filters return expected fixture IDs; invalid values are rejected. Empty results differ from errors. Phone/keyboard users can complete the retained journey in both languages.
- [ ] Manifest membership agrees across lists, counts and retained feature results. Excluded/changed records do not return through a stale index, neighbor expansion or reference lookup.
- [ ] Documented configuration, migrations and real Prisma CRUD work. Ordinary startup preserves curation and roles.
- [ ] Frozen-lockfile install, `pnpm typecheck`, `pnpm test`, `pnpm build` and production `pnpm start` pass in the documented environment. Set required environment before install/import; any lint gate is noninteractive.
- [ ] Every no-mock scan signal has a recorded disposition. Build, database/runtime and provider results remain separate evidence.
- [ ] Each promoted should-do package and selected feature passes its listed checks in the same production build. Retained live providers receive a configured-runtime check as well as stubbed failure checks.

Deliver setup instructions, tested revision, command results, a short demo script and the remaining-work list in the fork. Mark each finding repaired and tested, contained and tested, or deferred. Report partial scope under T09/T12/D14 and the other broad findings; 16 must-do IDs do not mean 16 fully closed findings.
