# HumanoidTH baseline audit: product design and data-flow integrity

Reviewed 20 October 2026, Asia/Bangkok, against `research/HumanoidTH` commit `bef80bdfe895f9403af910951fa251c9baacad2b`, dated 5 July 2026. This independent source audit records baseline findings and proposed repairs. Implementation and deployed-system verification remain outstanding. The coordinating auditor confirmed that public repository HEAD matched this commit on the review date.

## Assessment

The atlas has useful entity models and research views. A person still cannot reliably submit a source or correction, have it reviewed by an identifiable reviewer, and reach a traceable published record whose analysis stays consistent. The first repairs should make map failures visible, complete publication/correction, enforce disclosure rules and preserve evidence when records change. Visual polish alone would leave these failures intact.

Each finding separates confirmed code behavior from proposed changes. Production record accuracy, the deployed revision and actual user experiences remain unverified. No user research was conducted.

| ID | Priority | Finding |
| --- | --- | --- |
| D01 | High | Map substitutes invented institutions/projects/counts for failed analysis and can persist them |
| D02 | High | Approval changes a queue badge without publishing a target record; corrections have no resolution link |
| D03 | High | Public/private and review promises do not form one consistent publication boundary |
| D04 | High | Seed imports bypass screening, overwrite decisions, and introduce placeholder/status claims |
| D05 | High | Classification treats weak signals as accepted evidence without a dependable review gate |
| D06 | High | Corrections and re-ingestion leave stale derived claims and lack reproducible lineage |
| D07 | High | Graph identity collapses distinct Thai names and long shared prefixes |
| D08 | High | Graph presents inferred relations and confidence as reviewed knowledge |
| D09 | High | An older review link can silently select a different record |
| D10 | Medium | Contribution filters use statuses that the database cannot accept |
| D11 | Medium | Analytics mix capped samples and incompatible date meanings |
| D12 | Medium | CSV export can download the wrong table and disregards the visible search |
| D13 | Medium | Pull-job history and counts do not reliably describe what was ingested |
| D14 | Medium | Mobile navigation, language access, and modal behavior hinder core workflows |

**Severity convention:** High means materially false publication, a broken privacy promise, an action on the wrong record, or loss of reliable evidence during a core task. Medium means a more localized problem with discovery, interpretation or recovery. Each finding reports confidence; source-confirmed behavior may remain untested in production. The companion [technical baseline audit](technical-baseline-audit.md) covers authentication, authorization, endpoint abuse, infrastructure, dependency/model availability and CSV security.

## Goals, actors, and scope

The upstream [README:26](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/README.md#L26) describes a transparent, reliable, collaborative atlas of Thailand-related robotics. Its [methodology:143](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/README.md#L143) promises auditable collection, screening, conservative deduplication, evidence-bearing relationships, corrections, privacy care and reproducible reporting. These are stated goals, not evidence that the implementation meets them.

The saved contest investigation reports that the published template expects a working HumanoidTH baseline plus at least one integrated HRI Wellness Living Lab feature. It does not establish numerical judging weights, required hardware, permitted pre-event coding, a deployment commitment or a clinical outcome target. Those remain unknown here; contest sources were not re-browsed during this audit.

| Actor inferred from the product | Intended job | Necessary success signal |
| --- | --- | --- |
| Public visitor / researcher | Find a robot, project, organization or relevant source | Understand claim, evidence, review state, dates and limits without mistaking an inference for fact |
| Community contributor | Submit a sighting, source, contribution or correction | Receive a reference, see review feedback, supply missing evidence and find the resulting record |
| Curator / reviewer | Screen, reconcile and publish useful material | Review the intended record, preserve decisions, explain rejection and publish once |
| Data operator | Acquire and refresh a bounded research batch | Know query, adapter, coverage, failures, duplicates, accepted/pending totals and affected records |
| Inventory custodian | Track a physical unit and choose permissible disclosure | Separate a model from an owned unit and disclose only approved operational information |
| Prospective wellness facilitator / participant | Use a future integrated wellness workflow | Have a clear task, consent/visibility expectations, evidence and an understandable completion/failure state |

The facilitator/participant role belongs to a proposed extension; no participant workflow is implemented. This audit inspected the active Next.js application, Prisma schema, seed importer/watcher, adapters, review forms, registry, inventory, graph, map, dashboards and export. Legacy Python provided historical context, consistent with the upstream README, and was not audited as the active production pipeline.

## As-is data flow

```text
OpenAlex / GitHub / GDELT / YouTube
  -> adapter-specific thin metadata -> canonical URL + network-geo enrichment
  -> Gemini if configured; otherwise rules; Gemini errors also fall back to rules
  -> SourceRecord UPSERT by URL [ACCEPTED / REJECTED / UNCERTAIN]
       -> if accepted: PerspectiveAnnotation UPSERT by evidence/theme/target
       -> if accepted and AI triplets present: Triplet UPSERT
       -> no removal of earlier annotations/triplets when decisions change

Root seed JSON -> seedAtlasData (also initial + file-change development watcher)
  -> SourceRecord [forced ACCEPTED]
  -> RobotModel [default observed_in_thailand on create]
  -> Contribution [public + APPROVED on create]
  -> Triplet / PerspectiveAnnotation; auxiliary categories can overwrite same URL
  -> SubmittedData / SourcePullJob CREATE for corresponding seed categories

Community form -> SubmittedData [QUEUED] -> reviewer status edit [APPROVED etc.]
                                             -X-> no typed publication/merge/correction action
Admin CMS -> independent source/model/contribution edits

Database records -> registry / contribution / perspective / inventory views
                 -> dashboards + capped analytics -> graphs/charts
                 -> graph builder (database/file/hybrid/auto; file fallback warning)
                 -> map input -> AI clusters -> unversioned StatsCache
                                      failure -> hardcoded clusters
                                      reanalysis failure -> hardcoded clusters cached
                 -> raw database browser -> CSV table switch (not its search predicate)
```

Trace anchors: [adapters:22](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/adapters.ts#L22), [save:8](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/save.ts#L8), [seed importer:69](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L69), [watcher:37](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/scripts/watch-seed.ts#L37), [submission actions:60](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L60), [graph loaders:301](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L301), [map:249](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L249), [export:6](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/export/route.ts#L6).

The four ecosystem layers are modeled, but their connection is incomplete. Contributions can point to robot models; annotations and triplets point to sources. A submission has no published-target foreign key, a contribution has a URL rather than a SourceRecord relation, and a robot's evidence resides in free-form JSON/URL fields. SourcePullJob has no per-record batch-membership relation. See [schema:64](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L64), [123](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L123), [181](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L181) and [213](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L213).

## Prioritized findings

### D01: Invented map output is indistinguishable from successful analysis

- **What it is:** The map can show invented projects and counts when AI analysis fails.
- **Impact:** People may mistake a made-up result for evidence about a real institution.
- **Why fix it:** A research atlas must show when evidence is unavailable and let readers trace any published claim.

**High · confidence: high, source-confirmed.** [map/actions.ts:19](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L19) hardcodes five clusters with project names, summaries, coordinates and counts. [fetch:249](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L249) returns them after analysis failure; [reanalysis:269](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L269) writes them to the same cache used for model output. The [page:77](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/page.tsx#L77) presents clusters beside current database totals labeled “Database Items Analyzed” and a Gemini engine label. Neither cache origin nor failure is part of the returned point type.

**Consequence:** A failed request can appear to establish a university's robotics work and contribution count. Current raw totals do not prove a cached cluster analyzed those rows. Even a successful model response provides titles rather than stable evidence-record IDs, so a reader cannot reliably audit each cluster membership.

**Adjustment proposed:** Show when analysis is unavailable or empty. Retain a prior result only with explicit stale status, run time, input snapshot, model/method and linked member IDs. State whether coordinates refer to an institution, deployment or city estimate, with their precision and evidence.

**Acceptance:** Isolated missing-key, model-error and database-error scenarios produce no invented claims or replacement cache. A successful fixture run has traceable member IDs; editing a member marks the result stale. Loading a map does not implicitly start a new analysis. No map request was executed in this audit.

### D02: Approval and correction have no completion contract

- **What it is:** Approving a submission changes its status label but does not create or update the corresponding public record.
- **Impact:** A contributor may think a correction is finished while the original error remains visible.
- **Why fix it:** Review needs a clear outcome that links the decision to the record published or corrected.

**High · confidence: high, source-confirmed.** The [submission policy:50](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/submit-data/page.tsx#L50) promises queue review before public records. [updateSubmissionStatus:90](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L90) updates only `SubmittedData.status`; [CMS review:462](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/admin/AdminConsolePage.tsx#L462) binds its Approve button directly to it. The [form:151](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/submit-data/page.tsx#L151) offers inventory updates, robot specs and correction requests but collects only generic title/URL/notes. [schema:181](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L181) has no correction target, revision, published target or reviewer identity.

**Consequence:** Approving a submission leaves the corresponding domain table unchanged. A correction can be approved while the incorrect original remains intact. The submit page's `sub.notes || sub.reviewNotes` at [228](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/submit-data/page.tsx#L228) can hide review notes, and the page offers no contributor reply/resubmission action.

**Adjustment proposed:** Track review and publication separately. Identify the target record type and let reviewers inspect a diff and choose whether to merge. Store reviewer, reason, timestamps and published-record/revision references. Add explicit states for evidence requests, contributor responses and withdrawal.

**Acceptance:** Approving a source/model/contribution/correction fixture creates or updates exactly the intended domain record once, links back to the submission, and shows its destination to the contributor. Rejection creates no public target; more-information feedback remains visible alongside original notes.

### D03: Visibility and consent promises do not survive derived views

- **What it is:** Labels such as private, public-safe, and pending review are applied differently across views.
- **Impact:** Information someone expects to keep private could appear in a graph, map, or other public output.
- **Why fix it:** People need a clear disclosure choice, and that choice must follow their data through every view.

**High · confidence: high for code paths; actual affected production records unknown.** The [schema:135](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L135) has contribution visibility and [inventory:246](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L246) defaults inventory to private, yet [contributions:51](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/contributions/page.tsx#L51) has no mandatory public/approved condition. [Graph submissions:460](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L460) retain notes and title for unapproved submissions while only suppressing their URL; [node privacy:752](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L752) recognizes only private inventory. [Map inputs:90](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L90) include all inventory and contribution rows. The inventory [public-safe view:162](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/inventory/page.tsx#L162) masks some fields but still displays custodian and documentation links at [183](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/inventory/page.tsx#L183).

**Consequence:** “private,” “public-safe,” and “review before publication” mean different things across screens, so those labels do not tell users what they will disclose. A future wellness session also needs consent, retention and withdrawal rules; the existing generic notes field has no such protections for participant information.

**Adjustment proposed:** Define which fields and records may appear publicly for each entity and derived output. Include attribution, location precision and disclosure to external models. Tell contributors what will be public before they submit, and exclude pending/private material by default. The companion technical audit details enforcement and security repairs.

**Acceptance:** Synthetic sentinel fields from pending/private fixtures are absent from every public list, graph, map payload, analytics payload and export; changing publication consent retracts derived artifacts. Do this in isolation, without real participant data.

### D04: Seed import assigns trust and can undo curation

- **What it is:** Imported seed records are treated as accepted or approved, and importing again can replace human decisions.
- **Impact:** Unverified material can look trustworthy, while earlier corrections or rejections can disappear.
- **Why fix it:** Imported suggestions and reviewed facts need separate states, with human decisions preserved.

**High · confidence: high, source-confirmed.** [normalizeSourceType:38](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L38) recognizes only GDELT distinctly; OpenAlex/GitHub/YouTube imports default to WEB. Source [create/update:126](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L126) force ACCEPTED regardless of confidence. [Contribution create:360](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L360) defaults public/APPROVED. A [placeholder contribution:111](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L111) is also inserted. Robot imports set `observed_in_thailand` on creation at [189](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L189), without a separate deployment-evidence assertion. The watcher [starts by syncing:37](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/scripts/watch-seed.ts#L37).

**Consequence:** Including a record in the collection grants it accepted/approved status or a Thailand-observation claim. Re-importing a rejected source resets it to ACCEPTED. Auxiliary triplet/annotation seed branches [220](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L220) and [285](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L285) upsert the same URL's source metadata and can replace its title/excerpt. Seed submission/job categories use CREATE at [388](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/seed-importer.ts#L388), so repeated imports can create duplicates.

**Adjustment proposed:** Import versioned batches for review. Keep examples out of public results, preserve human decisions, validate platform/status mappings and store source metadata separately from derived assertions. Require Thailand deployment evidence beyond a vendor/global product page.

**Acceptance:** Replay the same fixture twice without duplicate submissions/jobs, placeholder publication or reset decisions. Conflicting seed changes produce a reviewable diff. Each accepted item has recorded evidence and method. Dataset-wide accuracy and duplicate prevalence remain unmeasured.

### D05: Relevance and perspective labels overstate weak evidence

- **What it is:** Simple word matches and fixed confidence scores can make weak evidence look like a reliable classification.
- **Impact:** Unrelated content may be accepted, and tone or public opinion may be described inaccurately.
- **Why fix it:** Research labels need enough supporting text, an honest uncertainty state, and a review process.

**High · confidence: high for rules; corpus error rate unknown.** [classifiers.ts:43](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/classifiers.ts#L43) uses substring matches and assigns fixed 0.82 acceptance when both term lists hit. “android,” “eldercare,” and “hri” are robot terms; “thai” is a country term. This allows lexical coincidence and non-embodied care/software content. [Perspective extraction:85](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/classifiers.ts#L85) picks the first matching theme and treats “privacy” as negative sentiment, which is not itself evidence of skeptical stance. [OpenAlex:32](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/adapters.ts#L32) substitutes “OpenAlex abstract metadata available.” instead of reconstructing the abstract and drops author/affiliation evidence used by the intended screening criteria. [save:32](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/save.ts#L32) accepts AI `isRelevant` without a minimum-confidence review branch; errors silently switch methods for the caller.

**Consequence:** A confidence badge can make a fixed rule score look like measured confidence, and mixed domains can appear as public/media opinion. Relevant Thai research may also become uncertain because the retained metadata omits its Thailand connection.

**Adjustment proposed:** Assess topical relevance, Thailand evidence, source sufficiency, stance and human verification separately. Keep records pending when evidence is missing or AI fails, and show the classification method. Test a small bilingual fixture set with agreed reviewer labels before making broader claims. Include software-only Android, non-robot eldercare, ambiguous substrings, Thai-only institutional evidence and neutral privacy discussion.

**Acceptance:** False-positive fixtures do not auto-publish; low-confidence AI results require review; a quote is verified against stored source text. Report evaluation denominators and disagreements rather than treating current tests as accuracy validation.

### D06: Updates do not retire stale assertions or produce a reproducible snapshot

- **What it is:** Changing a source does not reliably update or retire all the claims and charts derived from it.
- **Impact:** Old errors can survive a correction, and researchers cannot easily recreate an earlier result.
- **Why fix it:** A correction should reach every affected output, with a record of what changed and why.

**High · confidence: high, source-confirmed.** [save.ts:65](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/save.ts#L65) overwrites source metadata/status, then only upserts currently produced annotations/triplets at [89](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/save.ts#L89); earlier assertions are not superseded or removed. [CMS source editing:237](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L237) similarly changes the source without updating its derived claims. [Perspectives query:51](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/perspectives/page.tsx#L51) does not require accepted parent sources. [Revalidation paths:39](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L39) omit map/network; map cache [249](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/map/actions.ts#L249) has no age/input-version check. The graph has a separate 60-second in-memory cache at [857](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L857).

**Consequence:** Rejecting or correcting a source can leave its old stance/relationships public, and re-ingestion can overwrite a curator's decision. The latest `rawMeta.query` records only the latest query, leaving earlier batches untraceable. Researchers cannot reliably recreate the exact dataset behind a chart or cached map.

**Adjustment proposed:** Version sources, assertions and decisions; link them to ingestion/review runs; mark superseded assertions; and invalidate derived outputs when their input version changes. Keep machine suggestions separate from approved facts. Preserve canonical aliases and prior URLs when merging. Retain the URL canonicalizer's existing removal of basic tracking parameters and trailing slashes.

**Acceptance:** Accepted → corrected → rejected and AI → rules reprocessing fixtures leave no active stale public claims. The original decision remains auditable; a report/export identifies snapshot, inclusion rules, filters, method and code revision.

### D07: Graph identity loses Thai names and merges unrelated entities

- **What it is:** Graph identifiers remove Thai characters and cut long names short, so different names can produce the same identifier.
- **Impact:** Distinct robots, people, or organizations could be merged into one misleading graph node.
- **Why fix it:** The atlas needs stable identifiers that keep different entities separate regardless of their language or name.

**High · confidence: high; pure helper reproduction, no deployed merge claimed.** [slugify:184](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L184) removes all characters except ASCII letters/digits, truncates at 80 characters and substitutes `unknown` for empty strings. [nodeId:194](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L194) makes that the identity; [mergeNode:674](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L674) then combines records and takes the maximum confidence.

**Reproduction:** A pure Node copy of this helper produced `robot_model:unknown` for both `หุ่นยนต์ดินสอ` and `หุ่นยนต์ช่วยสอน`; distinct Latin labels sharing the first 80 slug characters also collided. This executed no application import, database call or network request. These are synthetic examples, not claims about current production records.

**Consequence:** Different Thai robots/authors/institutions can share a node, acquire unrelated edges and inherit another record's confidence. Latin labels with long shared prefixes have the same problem.

**Adjustment proposed:** Use stable IDs that identify each entity's type and record independently of its display name. Make entity-matching decisions explicit and reviewable. Preserve Unicode display names, aliases and source identities; display-label slugs cannot serve as unique entity keys.

**Acceptance:** Distinct Thai-only labels, same-label distinct entities, and long-prefix collisions remain separate; an intentional merge preserves all evidence and can be reversed.

### D08: “Reviewed” and relationship labels substitute inference for evidence

- **What it is:** The graph treats high confidence as review and turns some loose associations into stronger relationship labels.
- **Impact:** Visitors could mistake an inferred connection for verified ownership, development, or deployment.
- **Why fix it:** The graph must distinguish what a source states, what the app guesses, and what a person reviewed.

**High · confidence: high, source-confirmed.** [Only-reviewed filtering:269](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/network/NetworkGraphClient.tsx#L269) tests confidence ≥0.7 rather than a review decision; edges use the same test at [285](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/network/NetworkGraphClient.tsx#L285). Backend [confidence assignment:395](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L395) manufactures scores from contribution status. [Organization edges:901](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L901) infer developed_by/created_by/published_by from a generic organization field. [Country edges:972](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L972) call association `located_in`; robot input country is country of origin. [Inventory edges:1041](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L1041) assign `owned_by Internal team` regardless of ownershipStatus. [Mention edges:1111](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L1111) are substring inferences. The [detail panel:877](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/network/NetworkGraphClient.tsx#L877) says “Reviewed or high-confidence” when there is no review status.

**Consequence:** Visitors can read discovery links as verified development, location or ownership facts. Confidence alone provides neither evidence provenance nor human review. A model can also be highly confident that a source is irrelevant, which says nothing about whether a relationship is verified.

**Adjustment proposed:** Record asserted, inferred, imported and reviewed states separately. Preserve each relationship's meaning and show its evidence. Count unique supporting evidence and remove arbitrary corroboration scores. Make “Open record” use the record's type and ID. The existing [link:860](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/network/NetworkGraphClient.tsx#L860) searches the default source table by label even for other entity types.

**Acceptance:** Borrowed inventory never gets an owned_by claim; country of origin never becomes deployment location; an unreviewed high-confidence edge is excluded by “reviewed only.” Every claimed relation opens its source and method.

### D09: Review selection can silently fall back to the wrong record

- **What it is:** If the requested review item is outside the loaded list or missing, the editor silently selects another record.
- **Impact:** A reviewer could approve or change the wrong submission.
- **Why fix it:** A review screen must always act on the requested record or clearly say that it cannot be found.

**High · confidence: high from source; future isolated scenario required.** [CMS collection loading:114](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/admin/AdminConsolePage.tsx#L114) fetches only the newest 100 rows. [Selection:146](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/admin/AdminConsolePage.tsx#L146) uses `records.find(id) ?? records[0]` for any non-new selectedId. Review actions bind to that selected item's ID at [468](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/admin/AdminConsolePage.tsx#L468).

**Consequence:** An older, deleted or mistyped review link can display and act on a newer record instead of reporting that the requested record was not found. No pagination, independent selected-record lookup or queue search is provided in this component, so backlog items can become unreachable through the list.

**Adjustment proposed:** Fetch the selected record by ID under the relevant access policy. Keep the selection stable and show when the requested record is missing or has changed. Add paginated status queues with age and evidence filters.

**Acceptance:** In an isolated test database or mocked repository, create 101 submissions, select the oldest by URL, and verify its exact ID/title in the editor and action target. A missing or deleted selectedId shows no substitute and offers no approve/edit control for another record. This scenario was not run against any database.

### D10: Contribution status filters cannot match the schema

- **What it is:** The contribution filter sends status names that do not match the database's allowed statuses.
- **Impact:** Choosing a filter can fail and misleadingly appear to return no matching records.
- **Why fix it:** Filters need valid shared labels, and errors must be distinguishable from genuine empty results.

**Medium · confidence: high, source-confirmed.** [Filter options:185](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/contributions/page.tsx#L185) send VERIFIED, UNVERIFIED or FLAGGED to `verificationStatus` at [55](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/contributions/page.tsx#L55). [ReviewStatus:30](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L30) instead defines QUEUED, FETCHING, ANALYZED, NEEDS_REVIEW, APPROVED, REJECTED and FAILED. The broad query catch at [86](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/contributions/page.tsx#L86) becomes the “No records match” state. Contribution types are separately hardcoded in the filter and free text in the CMS.

**Consequence:** A visitor asking for verified contributions encounters an invalid Prisma enum query disguised as no matching data. Divergent labels also make submission types, contribution types and review states harder to reconcile.

**Adjustment proposed:** Use shared, validated taxonomy values and translated labels. Track verification separately from submission processing. Reject invalid query values clearly and show query failures as unavailable states.

**Acceptance:** Every rendered status option round-trips to valid seeded fixture rows; unknown parameters produce an explicit validation response. Type/status labels in forms, filters, badges and exports share documented meanings.

### D11: Analytics cannot be read as whole-corpus or event-time measures

- **What it is:** Charts use limited subsets and mix dates of publication, discovery, and data entry.
- **Impact:** Counts and trends can suggest patterns that come from collection limits or import timing.
- **Why fix it:** Readers need to know which records are included and what each date and total means.

**Medium · confidence: high, source-confirmed.** [Analytics queries:60](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/analytics/page.tsx#L60) cap each domain at 5,000 and [summary:250](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/analytics/page.tsx#L250) counts fetched arrays. Sources use publication date or ingestion date at [127](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/analytics/page.tsx#L127), robots firstSeenYear/creation at [150](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/analytics/page.tsx#L150), and contributions/annotations creation date at [176](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/analytics/page.tsx#L176). OpenAlex [adapter:37](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/adapters.ts#L37) turns publication year into January 1. [Graph loading:305](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L305) has earlier per-table caps; its later truncation flag at [1194](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/network-graph.ts#L1194) measures the built graph rather than omitted database records.

**Consequence:** Totals disagree with count-based overview/dashboard queries. Ingestion bursts can look like changes in research/public attention, and unknown or year-only dates appear precise. A graph can report no truncation while earlier queries have already omitted records. The coordinating auditor counted 6,714 source rows in the static root seed file; the current database count remains unverified.

**Adjustment proposed:** Show total, analyzed and returned counts with coverage rules; aggregate server-side where appropriate. Keep publication, observation, ingestion, review and first-seen dates separate, preserving date precision and nulls. Label sentiment as a property of the sampled sources. Population-level public trust and wellness outcomes require separate evidence.

**Acceptance:** A >5,000-row isolated fixture either yields full aggregate totals or an explicit sample warning. Year-only dates do not imply monthly events; changing ingestion time does not move an unchanged publication into a new publication trend.

### D12: Export scope differs from the screen and can name the wrong dataset

- **What it is:** A download can ignore the search on screen, and selecting inventory can export source records instead.
- **Impact:** People could analyze or share the wrong dataset under a misleading filename.
- **Why fix it:** The exported records, filters, and filename need to match what the user chose.

**Medium · confidence: high, source-confirmed.** The [browser:19](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/database/page.tsx#L19) offers owned_inventory, but [export switch:12](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/export/route.ts#L12) has no inventory case, falling through to SourceRecord while retaining the selected filename. Its [export link:103](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/database/page.tsx#L103) omits `q`; preview queries cap at 250 while export returns all rows. [Empty export:32](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/export/route.ts#L32) invents an `id,empty` record rather than a stable empty table schema.

**Consequence:** A researcher can unknowingly cite or share sources in a file named inventory, or export records outside the visible search. The CSV records no snapshot, applied filter, count or taxonomy/version manifest, and annotations have no linked source bundle.

**Adjustment proposed:** Validate allowed datasets and apply the same filters to browse and export. Let users explicitly choose “filtered results” or “all permitted records,” and attach the metadata needed to reproduce the export. The technical audit covers permitted public fields and spreadsheet safety.

**Acceptance:** Each dataset's download has the expected entity IDs and schema; filtered preview and export agree on membership; an empty result contains headers only. Unknown table values return a clear error, not another table.

### D13: Pull outcomes omit lineage and conflate saved, new and successful

- **What it is:** Different ways of importing data record progress differently, and saved counts do not distinguish new records from updates.
- **Impact:** Operators may see a successful pull labeled skipped or be unable to tell what changed after a partial failure.
- **Why fix it:** Import history needs accurate outcomes and a link from each run to its affected records.

**Medium · confidence: high, source-confirmed.** [saveSources:130](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/save.ts#L130) increments saved for every processed upsert, including existing URLs. [GitHub:68](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/ingest/adapters.ts#L68) reports an absent optional token as a missing key, and [job status:113](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/actions.ts#L113) marks any missing-key list SKIPPED_MISSING_KEY even if public GitHub data was saved. [API ingestion:19](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/api/ingest/%5Badapter%5D/route.ts#L19) and [CLI:15](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/scripts/ingest.ts#L15) call adapters without the UI's job wrapper. The overview queries a different [PipelineRun:90](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/page.tsx#L90), for which no active Next.js ingestion writer was found. [Dialog:30](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/components/DataPullFab.tsx#L30) closes after the action, including a caught failure.

**Consequence:** Operators cannot distinguish new records, updates, duplicate hits, classification decisions or partially committed failures. Some runs never appear in history; a successful unauthenticated GitHub pull can be labeled skipped. Saved counts are not acceptance counts.

**Adjustment proposed:** Record runs consistently across UI/API/CLI, preserving which records belonged to each run. Report found/new/updated/duplicate/accepted/pending/rejected/failed counts separately, with adapter limits and warnings. Show the run reference and any partial failure.

**Acceptance:** A no-token GitHub fixture with results is successful-with-warning; a repeat pull reports updates/duplicates rather than new records; an injected mid-batch error reports what persisted. The same run reference connects dashboard history to its records.

### D14: Mobile and accessible task completion need deliberate navigation

- **What it is:** Phone layouts hide some navigation and language controls, while dialogs lack some keyboard and screen-reader support.
- **Impact:** Some visitors may struggle to find tools, read evidence, or complete a task without a mouse.
- **Why fix it:** Core tasks need to remain discoverable and usable across screen sizes, languages, and input methods.

**Medium · confidence: high for source structure; usability impact requires runtime/user testing.** [CSS:644](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/globals.css#L644) hides the sidebar below 860px. The [mobile tabs:21](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/components/MobileTabNav.tsx#L21) expose only overview/dashboard/network/robots/profile, while [language selection:148](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/layout.tsx#L148) exists only inside that hidden sidebar. The [mobile header:6](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/components/MobileHeader.tsx#L6) offers no more-menu and its icon-only profile link has no explicit accessible name. Some page-body links exist, so omitted routes are less discoverable, not proven unreachable. Tables have a global [880px minimum:391](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/globals.css#L391). [Pull dialog:47](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/components/DataPullFab.tsx#L47) lacks dialog semantics, focus management and Escape handling; substantive labels on contribution/perspective pages remain English in Thai mode.

**Consequence:** Phone visitors lose persistent access to language choice and several core tasks. Reading evidence/review tables requires substantial horizontal scrolling, and keyboard/screen-reader users lack reliable dialog entry and exit. The first-session [loader:17](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/components/FirstTimeLoader.tsx#L17) also reports timed “indexing/synchronizing” statuses at [47](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/components/FirstTimeLoader.tsx#L47), unrelated to real data readiness.

**Adjustment proposed:** Add a mobile task menu and visible language switch. Make discover → evidence → contribute/correct easy to follow, with operator tools separate. Add a compact evidence/detail view, accessible dialogs and translated taxonomy labels. Remove timed processing claims or tie them to actual work.

**Acceptance:** At 320/390/768px, both languages support discovery, evidence inspection, submission/correction and return navigation without URL entry; all tasks work by keyboard with visible focus and named controls. Dialog focus returns to its trigger. Test zoom, screen reader and reduced motion; this audit did not perform that runtime verification.

## Good foundations worth retaining

- **Meaningful domain separation:** Sources, annotations, triplets, robot models, contributions and physical inventory are distinct models. Optional dates and unknown fields can support honest uncertainty instead of mandatory fabricated values. Schema relations give a starting point for evidence lineage.
- **Basic canonicalization and unique keys:** [url.ts:3](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/lib/url.ts#L3) removes fragments, common tracking parameters and trailing slashes; source and contribution URLs are unique. Extend this with platform IDs, aliases and conservative entity resolution rather than discarding it. Existing/historical duplicates need a reconciliation migration; current normalization alone does not establish their removal.
- **Some honest unavailable states:** [perspectives:66](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/perspectives/page.tsx#L66), [robots:167](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/robots/page.tsx#L167) and [analytics:268](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/analytics/page.tsx#L268) disclose database failure. Apply this consistently to map, contributions, raw database and inventory.
- **Graph transparency scaffolding:** Source-mode warnings, database/file origin IDs, evidence excerpts and JSON export already exist; file fallback is explicitly signaled at [client:774](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/network/NetworkGraphClient.tsx#L774). A labeled imported snapshot is different from fabricated map results, though its freshness, corrections and publication policy still need explicit handling.
- **Accessibility and localization starting points:** Labeled form controls, mobile active-page indication, Thai fonts/translations, focus styles and [reduced-motion CSS:802](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/app/globals.css#L802) are present. The findings identify gaps rather than claiming an absence of all accessibility work.
- **The stated methodology is useful:** Evidence, conservative merging, privacy, clear failure states and reporting requirements are already articulated. A small workflow implementation can turn these into enforceable acceptance criteria.

## Proposed improvement sequence and wellness extension fit

These are proposals for scoping, not an approved implementation plan or a promise to finish every finding in one hack day.

1. **Establish one honest public journey.** Define allowed public fields and statuses with the technical-audit repairs; eliminate fabricated map output; quarantine placeholders and choose a small manually verified demonstration corpus. Demonstrate discovery → evidence → submit/correct → review → published destination.
2. **Make that journey survive change.** Add stable identifiers, submission/decision/target links, revision history and invalidation; repair wrong-record selection and status filters. Replay, reject and correct the same item safely before expanding ingestion.
3. **Make analysis explain itself.** Separate observed and inferred edges, repair Unicode identity, preserve date precision and publish coverage/snapshot metadata. Align list, dashboard, graph and export inclusion rules. Fix mobile and keyboard routes used by the selected demo.
4. **Add one visible HRI wellness capability in the same fork.** A plausible fit for the user's data-trust/privacy interest is an evidence-backed wellness interaction evaluation workflow: facilitator selects a sourced robot/activity; reviews stated suitability and uncertainty; records a consented, minimal session observation; obtains a human-reviewed summary or issue; and can correct/withdraw it. This is an example to validate with organizers and intended users, not a clinical recommendation or a selected design.

The current registry's use-case text and sentiment charts do not constitute such a completed wellness workflow. [OwnedInventory:229](https://github.com/taechasith/HumanoidTH/blob/bef80bdfe895f9403af910951fa251c9baacad2b/prisma/schema.prisma#L229) stores current condition/custodian/notes but no maintenance-event, availability/reservation or wellness-session entities; its view is read-only. The submission form's inventory-update option therefore does not complete the README's promised operational custody/maintenance journey.

For any chosen extension, define the human benefit before choosing data fields or AI: e.g., “a facilitator can inspect the activity's evidence, complete or abort a session, and resolve a safety/comfort concern without publishing identifying notes.” Functional acceptance can measure completion, correct state changes, evidence coverage, data minimization and recovery. Do not claim improved health, clinical validity, adoption or a participant trial without separate evidence. Hardware access, real-participant involvement, consent requirements, contest acceptance criteria and preparation rules are still unresolved.

## What the captured fork studies add to this design audit

The original audit identifies gaps in record accuracy and workflow accountability. The captured fork plans add detail about running a wellness activity, interpreting its evidence and verifying readiness. The additions below are proposed design/verification requirements. Implementation and study-method validation remain outstanding; these proposals add no new baseline defects.

Sources: [phowadol's session/Hack Day plan](https://github.com/phowadol0512-debug/HumanoidTH/blob/3d642b0a658d7264fa942fee7dcd421198178d48/docs/hackday/HACKDAY_PLAN.md), [Teeraphat's planned Living Lab protocol](https://github.com/Teeraphat2543Inta/HumanoidTH/blob/a3a3b54994b130f6b004aca45acdc8d72c5ef668/docs/hackathon/LIVING_LAB_PROTOCOL.md), its [feature plan](https://github.com/Teeraphat2543Inta/HumanoidTH/blob/a3a3b54994b130f6b004aca45acdc8d72c5ef668/docs/hackathon/HACKDAY_PLAN.md), and our fork comparison. Documents were read from the captured Git objects at these commits. They contain plans, and one protocol claims a `lib/wellness.ts` implementation that the captured tree does not contain; its method must not be treated as delivered software.

### Added coverage and where it belongs

| Topic from their studies | What our original report lacked | Addition / relation to our findings |
| --- | --- | --- |
| A concrete facilitator journey | We proposed an evidence-backed wellness workflow but did not spell out its session states or the smallest complete demonstration. | Expand D02/D14 acceptance for any selected feature: choose robot/activity → record permitted consent decision → start → complete or abort → record a concern → review → show a privacy-safe result. A missing or denied step must have an explicit outcome. This is a candidate journey, not an approved scope. |
| Equipment readiness | We noted absent inventory operations, but did not state that filling an empty inventory is different from repairing broken code. | Under D04/demo preparation, zero units is a valid empty state. Register verified available equipment only when actually available; label synthetic fixtures, planned units and real owned units separately. Do not import placeholder robots to make dashboard counts look complete. |
| Measurement and uncertainty | D11 covers atlas counts/dates, but a future session scorecard needs a separate evidence contract. | Define what is measured, by whom, when, on what scale, with what missing-data rules and context. Report people and sessions separately, and specify how repeated observations from one person are handled. Have any comparison/ranking method reviewed before making benefit claims. |
| Consent and aggregate privacy | D03 requires consistent disclosure, but did not explicitly address participant codes and small-group queries. | A code replacing a name does not itself prove anonymity. Define linkage access, withdrawal, retention, notes-free exports, and protections against identifying someone through small or overlapping groups. Do not copy another plan's participant/session threshold as a proven privacy guarantee. |
| Safety/comfort concerns | We proposed recording an issue, but did not define aborted sessions or whether concerns survive a positive summary. | Keep a restricted, attributable concern-resolution path; preserve aborted/incomplete sessions as such. An overall positive score must not hide concerns from authorized reviewers. Public safety reporting must still follow the disclosure policy and prevent identification. |
| Demo evidence and fallback | We had acceptance criteria but no explicit record of what a demonstrator must prove or what can be cut. | Link each selected finding to its change and verification receipt; rehearse the complete journey in the same build to be shown. Provide a local/offline or recorded fallback with clearly labeled synthetic data. Drop optional telemetry/extra charts before weakening identity, consent or privacy controls. Dates, hardware and contest rules must be reconfirmed independently. |

### Study-design questions to resolve before choosing a wellness scorecard

The source protocol itself acknowledges no control condition, unvalidated Thai older-adult items and repeated sessions from the same person. These are reasons to keep the plan provisional. This audit does not validate its instruments, effect-size calculations, confidence thresholds, robot rankings or health claims.

- **What is being demonstrated?** Distinguish usable software, recorded participant feedback, and evidence of a robot's benefit. Completing a form or obtaining a positive before/after score does not establish all three.
- **Whose observations count?** Define participant versus session identifiers, setting, activity, robot/unit, aborted sessions and missing responses. Repeated records from one person must not silently count as independent people.
- **What does the result label mean?** Require a reviewed interpretation of uncertainty, repeated observations and context before using labels such as “supported,” “effective,” or a ranked “wellness impact.” The fork's planned threshold and shrinkage formula are not established validation evidence.
- **How is privacy preserved after analysis?** Verify suppression, overlapping filters, exports, cached summaries and withdrawal together. Keeping names out of a form does not show that notes, timing or small-group combinations cannot identify someone.
- **What is real versus simulated?** Keep synthetic demo sessions and telemetry distinguishable in storage, every chart and every export; never use them to claim measured benefit or real equipment ownership. Real-participant work remains a separate decision with appropriate study/consent arrangements.

### Acceptance evidence missing from the fork plans as well as ours

For the selected workflow, keep a small table linking each requirement to its implementation/revision, isolated verification command or walkthrough, observed result and remaining limitation. Cover success, denial, abort, correction/withdrawal, provider outage and a private-data sentinel check. Show a successful empty state separately from a failed request. Verify the behavior directly; a diagram, unchecked plan, heading-only smoke test or manually asserted completion table leaves it unproven. Use disposable fixtures and mocked external services before considering a real participant demonstration.

Existing IDs D01–D14 remain unchanged; these additions strengthen their scope and future acceptance criteria. The captured 27-finding comparison matrix continues to describe the original baseline, not a newly implemented wellness system.

## Verification, limits, and handoff

**Performed here:** Read the workspace README/context, saved contest research, upstream README, active source/schema/ingestion/seed/review/derived-view/export/UI code; inspected checkout status; traced the workflows above; reproduced only the graph identity helper using synthetic inputs and a pure Node expression. The nested checkout was clean at the initial inspection. This report is the only file authored by this auditor.

**Parent-reported fresh checks on 20 October 2026:** Public HEAD matched the baseline commit; `node node_modules/tsx/dist/cli.mjs --test test/classifiers.test.ts` passed 3/3; `node node_modules/typescript/bin/tsc --noEmit` passed; `node node_modules/tsx/dist/cli.mjs scripts/assert-no-mock-data.ts` failed with seven text-pattern signals, five map logging/comment matches and two network fallback/cache-wording matches. Those are pattern signals, not seven independently proven defects; source tracing establishes D01. The parent independently reproduced classifier false positives and counted 6,749 total / 6,714 source rows in the static root seed file. Passing three unit cases/typecheck does not validate publication, privacy, data accuracy or these journeys.

**Not performed:** Application builds by this auditor; database/runtime integration tests; browser/mobile/assistive-technology checks; live counts; map GET; model calls; ingestion/seeding; login/registration/simulator; production writes; organizer contact; corpus-wide external source verification. The 12 October 2026 live observations and successful production build in the shared context remain historical, not fresh evidence. This report does not rely on those counts as current state. External provider availability and legal compliance were not assessed here. Credential values and private participant information are intentionally excluded.

**Next verification should be isolated:** Implement fixtures for each acceptance criterion, especially approval idempotence, public projection, correction retraction, 101-item review selection, Unicode identity, filtered export membership, partial ingestion and unknown dates. Use temporary test data and mocked providers; do not exercise mutating production routes to confirm these findings. Preserve the baseline for comparison and agree on the one wellness journey before adding domain-specific data collection.

**Fork-study reconciliation, 2026-10-20:** Added the comparison and proposed readiness checklist after reading the pinned fork plans/protocol and retained source-review notes. No study, instrument validation, participant collection, application change or new runtime test was performed. Fork authors' claimed runs remain attributed historical claims; the preceding baseline verification results were not rerun for this documentation update.
