# HumanoidTH incomplete and defective functions

Prepared 22 October 2026 from the baseline at team-fork commit `a6ba556`. This report summarizes source and audit findings; no new runtime tests were performed.

## Hackathon relevance

The [organizer-supplied announcement](https://www.camphub.in.th/hri-hackathon-thailand-2026/), reopened on 22 October, gives two Hack Day missions: improve/fix the existing platform for real use, and integrate at least one new HRI Wellness Living Lab feature. Baseline completion is part of that task. The announcement lists neither our 27 audit findings nor a requirement to close every finding. The priorities below are team recommendations; the organizers have not issued this checklist.

The official Google Docs project template could not be reopened during this review. Its detailed interpretation in the preparation checklist retains the 20 October verification date.

## Functions needing work

The 27 findings overlap, so this table groups them by affected function. “Finished behavior” describes proposed acceptance targets. Implementation remains outstanding, and the organizers have not mandated these designs.

| Function | Existing defect or incomplete behavior | Proposed finished behavior | Audit IDs |
| --- | --- | --- | --- |
| Sign-in and roles | Users can claim an email and choose administrator authority without proving identity. | Verified identity, server sessions the app can trust and controlled operator roles. | T01 |
| Administrative writes | Privileged functions change records without checking permission for the operation. Restricting the page alone leaves those functions unprotected. | Every retained write/action/API verifies the caller before any side effect. | T02 |
| Public/private access | Pages, graph, map and exports apply inconsistent restrictions to private inventory, pending submissions, account information and internal fields. “Public-safe” inventory is a display toggle. | One server-enforced policy for permitted public records and fields across every output. | T03, D03 |
| Map generation and cache | Failed analysis can display invented clusters, projects and counts. Reanalysis can keep them in the shared cache indefinitely. Public reads can start model work with internal data. | Public results backed by evidence, controlled generation, cache entries with provenance and freshness checks, and visible unavailable states. | T04, T10, D01 |
| Submission approval and corrections | Approve changes a status label without creating/updating the relevant public record. Generic forms have no correction target, reviewer link or published-record link. | Complete one submission type through authorized review to the intended public record. Preserve reviewer/target links and prevent duplicate publication on retry. | D02 |
| Admin record selection | The CMS loads the newest 100 rows. An older or missing selected ID silently selects another record. | Fetch the exact authorized record by ID or show that it is missing. Never substitute another editable record. | D09 |
| Contribution filtering | The UI sends VERIFIED/UNVERIFIED/FLAGGED, which the schema's review-status enum does not contain. Query failure appears as no matches. | Shared valid statuses, validated filters and distinct failure/empty states. | D10 |
| CSV downloads | Export ignores the screen search. Selecting inventory exports sources under an inventory filename, and empty exports insert a fake data row. Exports load whole tables and do not handle text that spreadsheets may read as formulas. | Export the selected permitted records/fields with matching filters and the correct filename/schema. Preserve safe cell text, limit resource use and return headers only for empty results. | T11, D12 |
| Seed import and reviewed data | Imports grant accepted/approved status, mislabel source types and include placeholders. Normal development startup can re-import seeds, overwrite decisions and restore seed roles. | Explicit guarded imports, accurate source types and separate inherited, machine and human-review states. Startup preserves curation and roles. | T08, D04 |
| Classification and evidence | Broad word matches and fixed confidence can misclassify material or imply unsupported stance. OpenAlex supplies placeholder abstract text, and suggestions can become accepted without meaningful review. | Reviewed bilingual evaluation examples, adequate evidence, explicit uncertainty/method labels and controlled publication. Corpus-wide error rates remain unknown. | D05 |
| Corrections reaching derived outputs | Sources, annotations and triplets update separately, leaving some old claims active. Cache invalidation/versioning and protection against conflicting edits are incomplete. | Consistent source/assertion updates, retirement of obsolete claims, appropriate refresh, review history and reproducible snapshots. | T07, D06 |
| Graph entity identity | Identifiers strip non-ASCII characters and truncate names. Distinct Thai or long names can produce the same ID and merge entities. | Stable IDs that identify record/entity type and keep distinct records/entities separate across languages. | D07 |
| Graph review and relationship meaning | “Only reviewed” checks confidence. Organization, ownership and location labels can make claims stronger than the evidence supports. | Explicit review state, separate sourced assertions and inferences, and accurate relationship labels. | D08 |
| Analytics completeness and dates | Each dataset query stops at 5,000 rows, but loaded lengths appear as totals. Charts mix publication, first-seen and insertion dates. Earlier graph query limits can also omit data. | Accurate aggregates or clearly labeled subsets, explicit coverage/limits and defined date meanings. | D11 |
| Ingestion execution and history | Batches run inside web requests with no durable recovery. UI/API/CLI history differs, saved counts mix new records and updates, and a missing optional GitHub token can label a pull skipped even after it saves records. | Recoverable jobs/checkpoints, explicit partial outcomes, accurate counts and links from runs to affected records. | T06, D13 |
| Form/API validation | The code converts/casts inputs without checking allowed statuses, sensible numeric bounds or valid URLs. | Shared runtime validation that returns clear errors before database/provider work. | T09 |
| Failure and freshness feedback | Some database failures look like empty results, stale caches can appear current, and the ingestion dialog can close after catching a failure. | Distinct empty, failed, partial and stale states, with useful recovery feedback. | T12 |
| Mobile, language and accessibility | Mobile navigation omits many modules and hides the language selector with the sidebar. Some labels remain untranslated. Dialogs lack focus management, Escape handling and dialog semantics. | Discoverable routes and language selection, accessible controls/dialogs and a selected journey that works on phones and by keyboard. | D14 |
| Database setup and release checks | The documented database connection differs from the configured client. Some setup commands use the wrong order or depend on a particular operating system. Existing checks miss key authorization/privacy/DB workflows. | Reproducible install, configuration, migration, CRUD, build and start, with regression checks for the retained journey and its permission/privacy boundaries. | T05, T13 |

The [technical audit T01–T13](technical-baseline-audit.md) and [design/data-flow audit D01–D14](design-data-flow-baseline-audit.md) provide evidence and reproduction limits. Findings include confirmed source defects and design risks. Failure, load, concurrency and production-impact scenarios were not all reproduced; actual exposure of private production data remains unverified.

## Possible additions beyond baseline repairs

The inventory has custody, condition and repair-note fields, but no complete maintenance-history, reservation or custody-transfer workflow. The robot registry lacks a dedicated advanced search/detail workflow. The CMS has no bulk edit, delete, revision-history or rollback UI. These are possible additions whose absence alone establishes no hackathon requirement.

Readiness Search remains a separate, unimplemented proposal in the feature inventory. Its fit with the wellness theme still needs a clear wellness/HRI user journey.

## Proposed priorities

The revised [fix implementation plan](../Hack-day-planning/technical-fix-implementation-hack-day-plan.md) allocates three developers and 5–6 hours to eight must-do packages covering 16 findings. Alongside startup, identity, privacy, map, corpus, exact record selection and release work, it now includes valid contribution filters, minimum input validation/error feedback and phone/keyboard/language access for the selected journey. Five findings remain should do, covering publication, CSV and graph repairs. Six broader findings remain if time allows. Implementation is outstanding, and the narrow must-do scope may address only part of a broader finding.

Include any repair the chosen feature needs in its essential scope. A correction/review feature needs actual publication; graph-based discovery needs dependable identity and relationship meaning; downloads need correct filtered exports. A tested temporary restriction can disable a faulty path while its missing function and full repair remain open.

## Session verification

During the original review, the auditor read all 27 audit summaries and the repair/checklist documents, confirmed a clean local fork at `a6ba556`, and reopened the organizer announcement. Google Docs template retrieval failed. No application code changes, tests, database/provider calls, seed/import, deployment or organizer contact occurred.
