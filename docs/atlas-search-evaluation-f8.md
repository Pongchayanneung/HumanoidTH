# Atlas Search Pilot Evaluation and Provisional Semantic Policy Specification (F8)

**Package:** Feature Package F8 — Issue #20  
**Assignee:** Suk-Nsr  
**Milestone:** Atlas Search — 6 hours  
**Status:** Lexical (keyword) baseline measured. **Semantic retrieval was NOT evaluated**: no real embedding model was run, so the semantic cutoff is provisional and uncalibrated.  
**Artifacts Generated:**
- `data/search/pilot-queries.json`: 20-query pilot covering 10 independent intents in paired Thai and English with verified corpus-grounded expected IDs
- `lib/search/semantic-policy.ts`: Pinned (not calibrated) semantic retrieval policy parameters and profile compatibility checks
- `lib/search/evaluation.ts`: Evaluation engine for Keyword, Semantic, and Hybrid (RRF) retrieval, full-depth MRR, offline retrieval timing, and zero-result / returned-excerpt counting
- `scripts/evaluate-retrieval.ts`: CLI evaluation runner (`pnpm run search:eval`) that reports its evaluation mode truthfully (see section 3)
- `data/search/evaluation-pilot.json`: Full case-level evaluation output and aggregate metric summary
- `test/search-evaluation.test.ts`: Complete unit test suite verifying query distribution, lexical weights, RRF ranking, threshold cutoff, exact full-depth MRR, evaluation-mode resolution, and zero-result / excerpt counting

---

## 1. 20-Query Pilot Design & Intent Matrix

The pilot comprises **10 independent intents** expressed symmetrically in **Thai (`th`) and English (`en`)** (20 queries total), structured according to the hackathon plan:

| Intent ID | Category | Split | Intent Description | Thai Query | English Query |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `hospital-service-robot` | Supported | **Dev** | Hospital delivery and medical assistant robotics in Thailand | หุ่นยนต์บริการทางการแพทย์ในโรงพยาบาลของไทย | hospital medical service robots developed in Thailand |
| `elderly-care-companion` | Supported | **Dev** | Elderly care companion and home assistance robotics | หุ่นยนต์ดูแลผู้สูงอายุและช่วยเหลือผู้ป่วยติดเตียงที่บ้าน | elderly care assistance and home companion robots in Thailand |
| `fibo-robotics-education` | Supported | **Dev** | KMUTT FIBO robotics capacity building and research education | โครงการพัฒนาทักษะหุ่นยนต์และการศึกษาของ FIBO มจธ. | KMUTT FIBO robotics education and capacity building programs |
| `covid19-delivery-telepresence` | Supported | **Dev** | COVID-19 response telepresence & delivery robots Pinto and Mirror | หุ่นยนต์ส่งของและสื่อสารทางไกลช่วงโควิด Pinto และ Mirror | COVID-19 response telepresence and delivery robots Pinto and Mirror |
| `quantum-cryptography` | Unrelated | **Dev** | Quantum key distribution and post-quantum cryptography | การเข้ารหัสเชิงควอนตัมและการกระจายคีย์ความปลอดภัยสูง | quantum key distribution protocols and post-quantum cryptography |
| `humanoid-no-camera-sensors` | Unsupported/Negation | **Dev** | Humanoid robots in Thailand explicitly without optical cameras | หุ่นยนต์ฮิวแมนนอยด์ในไทยที่ไม่ติดตั้งกล้องหรือเซนเซอร์จับภาพใดๆ | humanoid robots in Thailand without cameras or optical vision sensors |
| `police-surveillance-cyborg` | Supported | **Reserved** | AI police cyborg and surveillance robotics in Thailand | หุ่นยนต์ตรวจการณ์และรักษาความปลอดภัยสำหรับตำรวจไทย | security surveillance and police cyborg robots in Thailand |
| `elementary-coding-buddy` | Supported | **Reserved** | Robo-Buddy coding education for elementary schools | หุ่นยนต์สอนเขียนโค้ดสำหรับนักเรียนประถมศึกษา Robo-Buddy | educational coding companion robot for elementary school Robo-Buddy |
| `deep-sea-hydrothermal` | Unrelated | **Reserved** | Hydrothermal vent exploration with autonomous submersibles | การสำรวจปล่องน้ำร้อนใต้ทะเลลึกด้วยเรือดำน้ำไร้คนขับ | deep-sea hydrothermal vent exploration with autonomous submersibles |
| `underwater-humanoid-chiangmai` | Unsupported/Negation | **Reserved** | Autonomous underwater humanoid robots in Chiang Mai rivers | หุ่นยนต์ฮิวแมนนอยด์ดำน้ำอัตโนมัติที่ใช้งานในแม่น้ำเชียงใหม่ | autonomous underwater humanoid robots deployed in Chiang Mai rivers |

### Relevance Ground Truth Alignment:
Relevance expectations in `data/search/pilot-queries.json` are aligned directly to checked-in corpus records:
- **Pinto & Mirror COVID-19:** Ground truth points directly to `contribution:seed-11` (CU-RoboCOVID Pinto and Mirror deployment), `robot:seed-10` (Pinto Robot), `robot:seed-13` (Mirror Telepresence System), and `relationship:seed-12` (Pinto Robot deployed_in hospitals across Thailand).
- **Hospital Service:** Points to `robot:seed-1` (Dinsaw), `robot:seed-25` / `relationship:seed-26` (CORGI Healthcare), `robot:seed-28` (Mr SAM), and `robot:seed-22` (Radioactive Iodine Therapy).
- **Elderly Care:** Points to `robot:seed-4` (Dinsaw Mini), `perspective:seed-5`, and `relationship:seed-8`.
- **FIBO Education:** Points to `contribution:seed-30` (Robotics for All) and `relationship:seed-31`.
- **Police Surveillance:** Points to `robot:seed-39` (AI Police Cyborg 1.0) and relationships `seed-40`/`seed-41`.
- **Robo-Buddy:** Points to `robot:seed-32` and `contribution:seed-33`.

---

## 2. Semantic Policy Specification (Pinned, Provisional, Uncalibrated)

These values are pinned so F5 (Ranking) and F6 (API) read the same numbers. "Frozen" in the code identifiers (`FROZEN_SEMANTIC_POLICY`, `1.0-frozen`) means the values are pinned, **not** that they were calibrated. `calibrationStatus` is `provisional_uncalibrated`.

| Policy Setting | Value | Rationale |
| :--- | :--- | :--- |
| **Policy Version** | `1.0-frozen` | Pinned parameter set, not a calibrated production policy |
| **Bound Model Profile** | `qwen3-embedding-0.6b-1024-f32-l2-97b0c61-v1` | Binds embedding runtime to `Qwen/Qwen3-Embedding-0.6B` (1,024 dims, L2 normalized, commit pinned). Not run in this evaluation |
| **Semantic Cutoff Threshold** | **`0.62`** (provisional, uncalibrated) | Placeholder with no measured support: the only semantic run used deterministic mock vectors, and it returned 1 result in 20 queries with semantic MRR and P@3 of 0. Must be re-derived on the dev split against the real embedding model before use |
| **RRF Constant ($k$)** | **`60`** | Common default for reciprocal rank fusion ($1 / (60 + \text{rank})$); not tuned on this pilot |
| **Lexical Weights** | Title: `4.0`, Body: `1.0` | Prioritizes title and canonical name matches over broad substantive excerpts; not tuned on this pilot |
| **Candidate Limits** | 50 candidates / branch | Bounded latency budget (max 200 current-record revalidation checks) |
| **Result Limits** | Default 10, Max 20 | Bounded result size |
| **Task Instruction** | `"Given a Thai or English robotics information request, retrieve relevant public atlas records."` | Pinned query prefix for Qwen embedding instruction tuning |

---

## 3. Evaluation Metrics and Mode Comparison

The committed report (`data/search/evaluation-pilot.json`) was produced by `./node_modules/.bin/tsx scripts/evaluate-retrieval.ts` (equivalently `pnpm run search:eval`) with no embedding service configured. It ran **`lexical_only`**: 20 pilot queries against the 6,746 eligible public atlas documents (`data/search/documents.json`). `semanticStatus` is `unavailable`. **No semantic or real-embedding result exists in this report.** Hybrid is RRF over the keyword branch alone, so it is not evidence that fusion helps.

| Evaluation Dimension | Keyword Retrieval | Semantic Retrieval | Hybrid (RRF over keyword only) |
| :--- | :--- | :--- | :--- |
| **Supported MRR (Full-Depth, 12 queries)** | `0.378` | n/a (not evaluated) | `0.377` |
| **Supported Precision@3** | `0.167` | n/a (not evaluated) | `0.167` |
| **Unrelated Query Suppression (zero results, 4 queries)** | `50.0%` (2 of 4) | n/a (not evaluated; a mock run returns nothing, which is vacuous) | `50.0%` (2 of 4) |
| **Mean offline retrieval timing, embedding excluded** | `3.29 ms` | n/a (not run) | `3.84 ms` |

Unsupported / negation queries (4 queries), counted separately. **Whether the returned excerpts reveal the missing condition was not assessed.**

| Outcome (hybrid) | Count |
| :--- | :--- |
| Zero results returned | 2 of 4 |
| Results returned, every primary result has a non-empty excerpt | 2 of 4 |
| Results returned, at least one primary result has no excerpt | 0 of 4 |

The timing figures are means from one run on one machine and vary between runs. They measure in-process keyword scan, fusion and grouping only; query embedding time is outside the timer, so they are **not end-to-end latency** and say nothing about the production embedding endpoint.

> [!NOTE]
> - **Evaluation Mode Labeling:** `scripts/evaluate-retrieval.ts` resolves its mode from what is actually available. `production_semantic` requires BOTH on-disk document vectors bound to the policy profile AND a real query embedding provider (`EMBEDDING_SERVICE_URL` or `TEI_ENDPOINT`). With neither, the run is `lexical_only`. `mock_fixture` is used only when `--mock-fixture` is passed explicitly (or the on-disk vectors are themselves mock); it reports `semanticStatus: "mock"` and semantic metrics as n/a. Mock vectors are never described as Qwen results.
> - **Full-Depth MRR:** Mean Reciprocal Rank calculates the first useful rank across the full candidate list rather than truncating at rank 3. Precision@3 strictly measures the fraction of relevant documents in the top 3 results.
> - **Pilot size:** 12 supported queries over 6 intents. These are descriptive case-level numbers, not statistically powered.

---

## 4. Limitations and Boundaries

- **Pilot Evidence Scope:** This evaluation establishes case-level retrieval behavior across 10 representative intents; it does not claim corpus-wide statistical accuracy or health/medical certification.
- **Semantic retrieval is unmeasured:** No real embedding model was run against the pilot. The 0.62 cutoff, the RRF constant and the lexical weights are not validated for semantic or hybrid quality. Before the semantic branch is enabled, build real vectors for the bound profile, run `search:eval` with the embedding endpoint configured, re-derive the cutoff on the dev split only, and confirm on the reserved split.
- **Offline Fixtures:** Mock embeddings (`--mock-fixture`) only exercise the ranking pipeline structurally. They carry no information about semantic quality.
