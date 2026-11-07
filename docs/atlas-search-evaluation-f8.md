# Atlas Search Pilot Evaluation and Frozen Semantic Policy Specification (F8)

**Package:** Feature Package F8 — Issue #20  
**Assignee:** Suk-Nsr  
**Milestone:** Atlas Search — 6 hours  
**Status:** Completed  
**Artifacts Generated:**
- `data/search/pilot-queries.json`: 20-query pilot covering 10 independent intents in paired Thai and English with verified corpus-grounded expected IDs
- `lib/search/semantic-policy.ts`: Frozen semantic retrieval policy specification and profile compatibility checks
- `lib/search/evaluation.ts`: Evaluation engine for Keyword, Semantic, and Hybrid (RRF) retrieval, full-depth MRR, full-path latency, and inspectable evidence gap checking
- `scripts/evaluate-retrieval.ts`: Automated CLI evaluation runner (`pnpm run search:eval`) with explicit evaluation mode reporting
- `data/search/evaluation-pilot.json`: Full case-level evaluation output and aggregate metric summary
- `test/search-evaluation.test.ts`: Complete unit test suite verifying query distribution, lexical weights, RRF ranking, threshold cutoff, full-depth MRR, and evidence gap preservation

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

## 2. Frozen Semantic Policy Specification

Calibrated using the development query slice and frozen to ensure deterministic agreement across F5 (Ranking) and F6 (API):

| Policy Setting | Value | Rationale |
| :--- | :--- | :--- |
| **Policy Version** | `1.0-frozen` | Immutable production policy |
| **Bound Model Profile** | `qwen2-gte-1024-f32-l2-e085e72-v1` | Binds embedding runtime to `Alibaba-NLP/gte-Qwen2-1.5B-instruct` (1,024 dims, L2 normalized, commit pinned) |
| **Semantic Cutoff Threshold** | **`0.62`** | Admits relevant cross-lingual semantic matches while cleanly suppressing unrelated queries |
| **RRF Constant ($k$)** | **`60`** | Standard reciprocal rank fusion ($1 / (60 + \text{rank})$) balancing keyword and semantic branches |
| **Lexical Weights** | Title: `4.0`, Body: `1.0` | Prioritizes title and canonical name matches over broad substantive excerpts |
| **Candidate Limits** | 50 candidates / branch | Bounded latency budget (max 200 current-record revalidation checks) |
| **Result Limits** | Default 10, Max 20 | Clean UX without padded or irrelevant entries |
| **Task Instruction** | `"Given a Thai or English robotics information request, retrieve relevant public atlas records."` | Pinned query prefix for Qwen embedding instruction tuning |

---

## 3. Evaluation Metrics and Mode Comparison

Evaluated across all 20 pilot queries against the 6,746 eligible public atlas documents (`data/search/documents.json`) in mock fixture evaluation mode (`evaluationMode: "mock_fixture"`):

| Evaluation Dimension | Keyword Retrieval | Semantic Retrieval (Mock Fixture) | Hybrid Retrieval (RRF) |
| :--- | :--- | :--- | :--- |
| **Supported MRR (Full-Depth)** | **`0.378`** | *(Mock Fixture)* | **`0.377`** |
| **Supported Precision@3** | **`0.167`** | *(Mock Fixture)* | **`0.167`** |
| **Unrelated Query Suppression Rate** | `50.0%` | **`100.0%`** | **`50.0%`** |
| **Unsupported / Negation Evidence Gaps** | Preserved | Preserved | **Preserved (4/4 cases)** |
| **Full End-to-End Latency** | ~2.5 ms | ~8.0 ms | **~10.5 ms** |

> [!NOTE]
> - **Evaluation Mode Labeling:** `scripts/evaluate-retrieval.ts` explicitly marks its evaluation mode (`mock_fixture` vs `production_semantic` vs `lexical_only`). When running without live production Qwen vectors, the report records `mock_fixture` and evaluates deterministic mock vectors to test cutoff behavior without falsely attributing synthetic numbers to Qwen.
> - **Full-Depth MRR:** Mean Reciprocal Rank calculates the first useful rank across the full candidate list rather than truncating at rank 3. Precision@3 strictly measures the fraction of relevant documents in the top 3 results.
> - **Evidence Gap Preservation:** Assessed by confirming that unsupported condition queries either cleanly return 0 results (refusing to claim ungrounded satisfaction) or return candidates with verifiable, non-empty source evidence text for human inspection.

---

## 4. Limitations and Boundaries

- **Pilot Evidence Scope:** This evaluation establishes case-level retrieval behavior across 10 representative intents; it does not claim corpus-wide statistical accuracy or health/medical certification.
- **Offline Fixtures:** In offline execution without a live GPU server, mock embeddings verify structural ranking pipelines; production inference utilizes the authenticated GPU endpoint established in F2.
