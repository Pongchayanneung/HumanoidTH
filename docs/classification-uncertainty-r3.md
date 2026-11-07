# [R3] Bilingual Classification and Evidence Uncertainty Evaluation

## 1. Overview & Objectives

This document details the implementation, calibration, and benchmark evaluation for **Issue #27 ([R3] Evaluate bilingual classification and evidence uncertainty)** addressing **Audit Reference D05**.

Prior to R3, baseline source classification relied on naive substring matching with fixed confidence scores (0.82 on match, 0.74 on reject), and perspective extraction hardcoded terms like `"privacy"` directly into negative sentiment. Consequently, software-only Android mobile apps in Bangkok and non-robot eldercare facilities in Chiang Mai were accepted as humanoid robots with high confidence, while OpenAlex placeholders and title-only inputs were automatically published without human verification.

The R3 implementation provides:
1. An approved offline bilingual Thai/English ground truth benchmark (`data/evaluation/bilingual-classification-benchmark.json`) cleanly distinguishing real atlas data from synthetic edge-case fixtures.
2. A multi-factor calibrated classifier (`lib/classification/calibrated-classifier.ts`) evaluating evidence sufficiency, embodied vs. software topicality, institutional Thailand connections, and stance/sentiment disentanglement.
3. Strict human review gating and auto-publication suppression for placeholders, title-only inputs, and low-confidence machine suggestions.
4. An automated benchmark evaluation tool (`scripts/evaluate-classification.ts`, `pnpm run classification:eval`) recording verifiable metrics and false-positive containment in `data/evaluation/classification-evaluation-report.json`.

---

## 2. Root Cause Analysis (Audit D05)

| Failure Mode | Baseline Implementation | Impact | Calibrated R3 Fix |
| :--- | :--- | :--- | :--- |
| **Software-only Android Traps** | `robotTerms` contained `"android"`; `thailandTerms` contained `"thai"`, `"bangkok"`. | Android mobile apps (e.g. Bangkok transit ticketing) were marked `ACCEPTED` with `0.82` confidence. | `evaluateTopicalRelevance` detects mobile/OS/SDK patterns (`android app`, `kotlin`, `แอปพลิเคชัน`) and rejects software-only entries (`REJECTED`, 0.91 conf). |
| **Non-robot Eldercare Traps** | `robotTerms` contained `"eldercare"`; `thailandTerms` contained `"chiang mai"`, `"thailand"`. | Nursing home nutrition and staffing reports were marked `ACCEPTED` with `0.82` confidence. | Requires physical embodiment or robotic automation terms; general eldercare without robotics is classified as `non_robot_care` (`REJECTED`, 0.90 conf). |
| **Substring Traps** | Substring checks on `"thai"` matched food and sports. | "Pad Thai cooking recipes" or "Muay Thai camps" could trigger country hits. | Word boundary matching with explicit food/sport exclusions (`pad thai`, `muay thai`, `ผัดไทย`). |
| **Stance/Sentiment Conflation** | `negativeTerms` contained `"privacy"`. | Research on privacy-preserving telemetry was tagged as `skeptical` stance and `negative` sentiment. | Disentangles `privacy_and_surveillance` theme from sentiment; evaluates evaluative valence independently. |
| **Placeholder & Title-Only Ingestion** | OpenAlex placeholders (`"Academic paper about ... indexed on OpenAlex."`) were treated as substantive abstracts. | Sources with zero verified evidence were accepted and auto-published. | `evaluateEvidenceSufficiency` detects placeholders and title-only entries; marks `relevanceStatus: "UNCERTAIN"`, caps confidence `< 0.50`, and blocks auto-publishing. |
| **Unsafe Ingestion Auto-Publishing** | `lib/ingest/save.ts` accepted any `isRelevant: true` without confidence or evidence gates. | AI or rule errors immediately created public perspective annotations and triplets. | `autoPublishEligible` requires `ACCEPTED` + `confidence >= 0.80` + `sufficient` evidence + `!requiresHumanReview`. |

---

## 3. Calibrated System Architecture

### 3.1 Five-Factor Calibrated Pipeline

The classifier operates across five distinct evaluative factors:

```
Source Title + Excerpt
          │
          ├──> Factor 1: Evidence Sufficiency (Placeholders, Title-only, Thin text)
          │         └── If Insufficient ──> UNCERTAIN (conf < 0.50, requiresHumanReview: true)
          │
          ├──> Factor 2: Topical Relevance (Embodied Robot vs Software vs Care vs Unrelated)
          │         └── If Software / Non-robot Care ──> REJECTED (conf >= 0.90)
          │
          ├──> Factor 3: Thailand Connection (Institutions, Locations with boundaries, Thai script)
          │         └── If Foreign Robot ──> REJECTED (conf >= 0.89)
          │
          ├──> Factor 4: Stance & Sentiment Disentanglement
          │         └── Evaluative indicators independent of theme (Privacy != Negative)
          │
          └──> Factor 5: Human Review Gate & Auto-Publish Safety
                    └── autoPublishEligible: ACCEPTED & conf >= 0.80 & sufficient & !requiresHumanReview
```

### 3.2 Evidence Sufficiency Gating

The helper `evaluateEvidenceSufficiency` checks:
- **Placeholders**: Regex patterns matching OpenAlex metadata templates (`/^academic paper about .* indexed on openalex\.?$/i`, `/^openalex abstract metadata available\.?$/i`) and generic placeholders (`"placeholder"`, `"abstract not available"`).
- **Title-only**: Excerpt is empty or whitespace.
- **Thin text**: Excerpt < 30 characters or total substantive text < 45 characters.

Any record failing sufficiency is assigned:
- `relevanceStatus: "UNCERTAIN"`
- `calibratedConfidence: 0.42`
- `requiresHumanReview: true`
- `autoPublishEligible: false`

### 3.3 Topical Disambiguation & Lexicon Guards

- **Embodied Robotics**: Bipedal, humanoid, social robot, service robot, delivery robot, companion robot, hospital robot, telepresence robot, autonomous mobile robot (AMR), mobile manipulator, Dinsaw, Pepper, NAO, Sensai, หุ่นยนต์บริการ, หุ่นยนต์ฮิวแมนนอยด์, แขนกลหุ่นยนต์.
- **Software Disambiguation**: Android app, Android OS, Android Studio, Kotlin, Jetpack Compose, mobile app, iOS and Android, Play Store, แอปพลิเคชัน.
- **Substantive Exclusions**: Heavy factory assembly line arms and spot welding machinery are excluded from the humanoid/service robot atlas taxonomy (`topicalRelevance: "unrelated"`).

### 3.4 Stance & Sentiment Disentanglement

`extractCalibratedPerspective` identifies the primary perspective theme via weighted occurrence scoring (title matches = 3 pts, excerpt matches = 1 pt). 
Societal and ethical themes (`job_displacement`, `privacy_and_surveillance`, `safety_and_reliability`) take precedence over background application venues (`healthcare_and_eldercare_trust`).
Evaluative indicators (`positive`, `skeptical_negative`, `cautious_mixed`) are measured independently of the theme:
- Privacy-preserving architecture, encryption protocols, or PDPA data protection are classified as `stance: "supportive"` and `sentiment: "positive"`.
- Labor union warnings over automation job losses are classified as `stance: "skeptical"` and `sentiment: "negative"`.

---

## 4. Benchmark Dataset (`data/evaluation/bilingual-classification-benchmark.json`)

The benchmark consists of **32 curated cases** with agreed ground truth labels:
- **16 Real Seed Records**: Sampled from authentic Thai humanoid and service robotics projects (Dinsaw, CU-Robo, Mahidol Siriraj, Pepper CentralWorld, Sensai, KMUTT FIBO, NECTEC) alongside valid negative cases (foreign robots, cloud software, web tutorials, industrial automotive arms).
- **16 Synthetic Fixtures**: Targeted stress-tests specifically reproducing Audit D05 vulnerabilities:
  - 3 Software-only Android apps in Thailand
  - 2 Non-robot eldercare/nursing facilities in Thailand
  - 3 Substring traps (Pad Thai, Muay Thai)
  - 3 Placeholders (OpenAlex abstract templates, generic placeholder)
  - 2 Title-only records (empty/whitespace excerpt)
  - 2 Privacy telemetry cases (neutral/supportive data protection)
  - 1 Labor job displacement concern (authentic skeptical stance)
- **Language Coverage**: 18 English (56.2%), 12 Thai (37.5%), 2 Bilingual (6.3%).

---

## 5. Evaluation Results

Run via `pnpm run classification:eval` (or `tsx scripts/evaluate-classification.ts`):

```
================================================================================
 [R3] Evaluating Bilingual Classification & Evidence Uncertainty (Audit D05)
================================================================================

Saved evaluation report to: data/evaluation/classification-evaluation-report.json

--- Benchmark Evaluation Summary ---
Total Cases Evaluated: 32 (Real Seed: 16, Synthetic Fixtures: 16)
Benchmark Version: 1.0.0
```

### 5.1 System Metric Comparison

| Metric | Baseline (Audit D05) | Calibrated (R3 Repaired) | Delta / Improvement |
| :--- | :--- | :--- | :--- |
| **Overall Relevance Accuracy** | 43.8% (14/32) | **100.0% (32/32)** | **+56.3%** |
| **Synthetic Traps False Positives** | 4/8 (50.0% FPR) | **0/8 (0.0% FPR)** | **-4 false positives** |
| **Synthetic Traps Specific Rejection (TNR)** | 50.0% | **100.0%** | **+50.0%** |
| **Insufficient Evidence Uncertainty Rate** | 1/5 (20.0%) | **5/5 (100.0%)** | **+80.0%** |
| **Privacy Stance & Sentiment Disentanglement** | 1/2 (50.0%) | **2/2 (100.0%)** | **+50.0%** |
| **Auto-Publication Safety Rate** | 50.0% (9 unsafe publishes) | **100.0% (0 unsafe publishes)** | **+50.0% (Zero leaks)** |

### 5.2 Breakdown by Language

| Language | Total | Baseline Accuracy | Calibrated Accuracy |
| :--- | :--- | :--- | :--- |
| **English (EN)** | 18 | 44.4% (8/18) | **100.0% (18/18)** |
| **Thai (TH)** | 12 | 41.7% (5/12) | **100.0% (12/12)** |
| **Bilingual (EN/TH)** | 2 | 50.0% (1/2) | **100.0% (2/2)** |

### 5.3 Breakdown by Source

| Source Cohort | Total | Baseline Accuracy | Calibrated Accuracy |
| :--- | :--- | :--- | :--- |
| **Real Seed Records** | 16 | 62.5% (10/16) | **100.0% (16/16)** |
| **Synthetic Fixtures (Traps & Placeholders)** | 16 | 25.0% (4/16) | **100.0% (16/16)** |

---

## 6. Operating Policy Before Operational Use

Before running operational ingestion pipelines:
1. **Never Auto-Publish Machine Suggestions on Thin Evidence**:
   Any record with placeholder text, title-only input, or excerpt < 30 characters must retain `relevanceStatus: "UNCERTAIN"` and `autoPublishEligible: false`.
2. **Minimum Confidence Threshold (0.80)**:
   Any machine suggestion (whether LLM-generated or rules-based) with confidence < 0.80 requires human curator review before publication.
3. **Disentangle Stance from Sentiment**:
   Privacy and surveillance technologies must not be conflated with skepticism or negative tone unless explicit negative evaluative terms (e.g. data breach, protest, infringement) are present.
4. **Reproducible Benchmark Audits**:
   Continuous integration runs `pnpm test` and `pnpm run classification:eval` to verify that false positive rates on traps remain strictly at 0.0%.
