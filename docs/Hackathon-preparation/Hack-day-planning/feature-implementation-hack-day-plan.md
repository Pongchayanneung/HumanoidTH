# Feature Implementation Hack Day Plan

## Atlas-wide Thai–English Search

HRI Hackathon Thailand 2026 · First-screening proposal · 22 October 2026

Status: planned feature. Implementation, retrieval evaluation and deployment validation remain to be completed on Hack Day.

## 1. Feature and intended use

We propose one natural-language search page for the public robotics information in Thailand Humanoid Atlas. Users will be able to search in Thai, English or a mixture of both and inspect relevant papers, repositories, news, videos, robot models and other public atlas records in one result list.

The intended users are researchers and students exploring HRI work, including wellness applications. An eldercare query may return a robot record, a paper and a repository when their stored content supports the match. Each result will show its content type, original text and available source link so the user can inspect the evidence before deciding what to investigate further.

The feature searches the text and metadata held by the atlas. A paper record may contain only a title; a repository description does not contain its complete code; a video description does not contain a transcript. The interface will identify these limits. Search results will indicate relevance to the request without certifying compatibility, clinical effectiveness or suitability.

The [Feature Technical Design](../feature-technical-design.md) describes the technical approach.

## 2. Delivery scope

The six-hour build will provide a global `/search` page, an API, a public search index and a live embedding service. Users will be able to filter results by content type, expand original text and follow available source links. Thai and English interface labels will follow the website's language setting; source text will retain its original language.

| Public content | Planned search coverage |
| --- | --- |
| Sources | Paper, repository, news, video, web and other source titles, substantive stored excerpts and permitted bibliographic metadata |
| Robot models | Names, descriptions and selected public catalog fields |
| Contributions | Public, approved project/research descriptions, contributor or organization labels and stored license information |
| Perspectives | Stored evidence, themes and annotation labels attached to an eligible source |
| Inventory | Explicitly public unit names and selected public model, organization and condition labels |
| Relationships | Stored relationship assertions with an eligible source or a documented public-release exception |
| Entities and organizations | Names and types with explicit provenance or a documented public-release exception |

Public eligibility will be checked before indexing and again before returning a result. Private inventory, contact details, user records, unpublished submissions and operational logs will remain outside the search corpus. An empty public content category will be reported as empty.

The build excludes generated answers, automatic translation of records, external full-text collection, model training, comparison tables and decision-brief export. Baseline repairs have a separate allocation. This plan assigns all six feature hours to the search build, testing and deployment.

## 3. Team responsibilities and schedule

Three developers will use AI-assisted coding and review within the same six-hour allocation. The schedule provides 18 total person-hours, including integration and verification.

| Contributor | Planned responsibility |
| --- | --- |
| NoneTP | Search API, keyword/semantic ranking, type filters and integration |
| Suk-Nsr | Public-data rules, content adapters, index generation and retrieval evaluation |
| Pongchayanneung | GPU service, search interface, website deployment and browser verification |

| Elapsed time | NoneTP | Suk-Nsr | Pongchayanneung |
| --- | --- | --- | --- |
| 00:00–00:30 | Agree result/API contract and prepare the search route | Inspect database content and define public fields | Check GPU runtime and deploy the website |
| 00:30–01:30 | Deliver keyword search and current-record checks | Export all eligible content types, prepare the keyword index and supply the embedding probe | Verify the deployed API's authenticated GPU connection; build the search interface |
| 01:30–03:00 | Add semantic retrieval, filters and grouped results | Generate embeddings, resume completed batches and report coverage | Integrate mixed result cards, evidence, language labels and failure states |
| 03:00–04:30 | Resolve ranking, duplication and freshness failures | Evaluate development queries and settle the retrieval policy | Test the hosted journey, keyboard/mobile use and access from another network |
| 04:30–05:15 | Run focused tests and repair release blockers | Evaluate reserved queries and validate index/evidence coverage | Deploy the final candidate and check restart/fallback behavior |
| 05:15–06:00 | Verify the final release, rollback and demonstration | Verify the final release, rollback and demonstration | Verify the final release, rollback and demonstration |

Each contributor has 360 minutes. The final 45-minute block is reserved for joint release checks and rehearsal. GPU batches may run while the data owner inspects results; their measured throughput will determine whether the complete index can finish within the window.

## 4. Delivery checkpoints

| Deadline | Required evidence |
| --- | --- |
| Hour 1 | The deployed website's server can obtain a real embedding from the team's authenticated GPU service. |
| Hour 1½ | Keyword search covers the complete eligible metadata export. A representative 128-document embedding probe has recorded throughput, memory use and failures. |
| Hour 2½ | A provisional semantic acceptance policy has been selected using development queries. |
| Hour 3 | A real semantic index slice works through the deployed website. Measured remaining work, with 50% time contingency, projects full indexing before hour 4½. |
| Hour 4½ | Feature and ranking changes stop. The team records actual index coverage and runs the reserved evaluation cases. |
| Hour 6 | The deployed URL, tested revision, index/profile identifiers, operating instructions and known limitations are ready for demonstration. |

The build depends on a working application/database connection, deployment access, a compatible GPU runtime and internet connectivity. The team will check these dependencies at the start and report a blocked checkpoint immediately.

If indexing runs late, keyword search will retain the complete eligible metadata export. Completed vector batches may support a labelled partial semantic release. The team will record full atlas-wide semantic coverage as incomplete in that case. An inference outage will trigger a visible keyword-search fallback with reduced cross-language coverage.

Card styling, optional highlighting and broader metric reporting may be reduced to protect the release block. Public-data checks, original evidence, content-type coverage and the working deployed path remain release requirements.

## 5. Verification and acceptance criteria

The team will prepare a 20-query pilot from ten independent search intents, each expressed in Thai and English. Six intents will cover supported discovery tasks, two will be unrelated requests, and two will add an unsupported condition or negation. Development will use four supported, one unrelated and one partial intent (12 queries). The remaining four intents will supply eight reserved queries. Paired language versions will stay in the same split.

The team will compare keyword, semantic and combined retrieval by inspecting the union of their top three results. The report will record first useful result, judged relevance, partial matches, duplicate results and observed latency. This pilot will provide case-level evidence; it will not establish accuracy across the entire corpus.

| Acceptance criterion | Verification |
| --- | --- |
| Deployed operation | A person on another device/network can open the URL and submit fresh Thai and English queries. The live model processes the requests. |
| Atlas-wide coverage | Export and index reports identify eligible and indexed records for every supported public content type. Full semantic completion requires vectors for the complete eligible export. |
| Mixed results and filters | Results preserve their content labels. A selected filter qualifies results through matching records of that type. Duplicate source entries do not increase ranking merely through repetition. |
| Inspectable evidence | Displayed text matches its original stored field and source reference. Missing descriptions, unavailable sources, placeholders and partial text are labelled. |
| Current public eligibility | Deleted, hidden, changed or newly ineligible records and dependent annotations are excluded before display. |
| Failure handling | Inference failure produces a visible keyword mode. Failed eligibility checks produce an unavailable state. |
| Usable controls | Search, filters, source links and loading/error feedback work by keyboard and at a mobile viewport. Older slow responses cannot replace newer results. |
| Reproducible operation | A second teammate can restart the GPU service and restore a compatible index release using the operating notes. |

Feature tests, type checking, a production build and the hosted browser journey will support these checks. The validation record will distinguish passed, failed and unrun checks. Existing unrelated baseline failures will retain their own status.

## 6. Deployment and handoff

The hosted website will call an authenticated HTTPS embedding service on the team's NVIDIA GeForce RTX 3080 Mobile machine with 8 GB VRAM. Corpus vectors will be computed in advance; each new query will use the same pinned model configuration. The endpoint credential will stay on the website server.

This arrangement requires the team's machine, model process and network connection to remain available during judging. The handoff will identify that dependency and describe how the embedding endpoint can later move to an always-on host. Runtime compatibility and performance have not yet been measured.

The final delivery record will include the deployed URL, tested commit, index and model-profile identifiers, coverage by content type, pilot results, measured latency, restart/rebuild/rollback instructions and any unfinished scope.
