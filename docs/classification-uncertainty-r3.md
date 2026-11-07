# [R3] Bilingual Classification and Evidence Uncertainty Evaluation

## 1. Overview & Objectives

This document details the implementation, calibration, and benchmark evaluation for **Issue #27 ([R3] Evaluate bilingual classification and evidence uncertainty)** addressing **Audit Reference D05**.

Prior to R3, baseline source classification relied on naive substring matching with fixed confidence scores (0.82 on match, 0.74 on reject), and perspective extraction hardcoded terms like `"privacy"` directly into negative sentiment. Consequently, software-only Android mobile apps in Bangkok and non-robot eldercare facilities in Chiang Mai were accepted as humanoid robots with high confidence, while OpenAlex placeholders and title-only inputs were automatically published without human verification.

The R3 implementation provides:
1. An approved offline bilingual Thai/English ground truth benchmark (`data/evaluation/bilingual-classification-benchmark.json`) with verified provenance linking real atlas data and synthetic edge-case fixtures.
2. A multi-factor calibrated classifier (`lib/classification/calibrated-classifier.ts`) evaluating evidence sufficiency, embodied vs. software topicality, institutional Thailand connections (strictly separated from Thai script language), and stance/sentiment disentanglement.
3. Strict human review gating and auto-publication suppression: contradictory signals and low-confidence machine suggestions (< 0.80) are marked `UNCERTAIN` and blocked from public publication.
4. Atomic database ingestion (`lib/ingest/save.ts`) projecting valid Prisma fields (omitting non-schema `requiresHumanReview`) and enforcing the 0.80 threshold on both perspective annotations and triplets.
5. An automated benchmark evaluation tool (`scripts/evaluate-classification.ts`, `pnpm run classification:eval`) recording verifiable metrics and false-positive containment in `data/evaluation/classification-evaluation-report.json`.

---

## 2. Root Cause Analysis (Audit D05)

| Failure Mode | Baseline Implementation | Impact | Calibrated R3 Fix |
| :--- | :--- | :--- | :--- |
| **Software-only Android Traps** | `robotTerms` contained `"android"`; `thailandTerms` contained `"thai"`, `"bangkok"`. | Android mobile apps (e.g. Bangkok transit ticketing) were marked `ACCEPTED` with `0.82` confidence. | `evaluateTopicalRelevance` detects mobile/OS/SDK patterns (`android app`, `kotlin`, `แอปพลิเคชัน`) and rejects software-only entries (`REJECTED`, 0.91 conf). |
| **Contradictory Signals** | Allowed conflicting terms (software + robot) to publish as `ACCEPTED`. | Mobile apps with robot mentions were published with review flags but visible on public graphs. | `hasContradictorySignals` sets `relevanceStatus: "UNCERTAIN"` and `autoPublishEligible: false`. |
| **Language vs. Location Conflation** | Treated Thai Unicode script alone as proof of Thailand affiliation. | Foreign robots described in Thai language (e.g. French humanoid) were accepted. | `thai_script` indicates language (`th`) only; requires independently verified geographic or institutional tokens in Thailand. |
| **Non-robot Eldercare Traps** | `robotTerms` contained `"eldercare"`; `thailandTerms` contained `"chiang mai"`, `"thailand"`. | Nursing home nutrition and staffing reports were marked `ACCEPTED` with `0.82` confidence. | Requires physical embodiment or robotic automation terms; general eldercare without robotics is classified as `non_robot_care` (`REJECTED`, 0.90 conf). |
| **Substring Traps** | Substring checks on `"thai"` matched food and sports. | "Pad Thai cooking recipes" or "Muay Thai camps" could trigger country hits. | Word boundary matching with explicit food/sport exclusions (`pad thai`, `muay thai`, `ผัดไทย`). |
| **Stance/Sentiment Conflation** | `negativeTerms` contained `"privacy"`. | Research on privacy-preserving telemetry was tagged as `skeptical` stance and `negative` sentiment. | Disentangles `privacy_and_surveillance` theme from sentiment; evaluates evaluative valence independently. |
| **Placeholder & Title-Only Ingestion** | OpenAlex placeholders (`"Academic paper about ... indexed on OpenAlex."`) were treated as substantive abstracts. | Sources with zero verified evidence were accepted and auto-published. | `evaluateEvidenceSufficiency` detects placeholders and title-only entries; marks `relevanceStatus: "UNCERTAIN"`, caps confidence `< 0.50`, and blocks auto-publishing. |
| **Schema Field Mismatch in Upsert** | `saveSources` spread `requiresHumanReview` into Prisma's `PerspectiveAnnotation` payload. | Ingestion rejected by Prisma client with unknown argument. | Projects strictly valid schema fields; wraps source, annotation, and triplet writes in `prisma.$transaction`. |
| **Machine Suggestion Cutoff** | Annotations and triplets below 0.80 were saved unconditionally. | Low-confidence machine suggestions polluted the knowledge graph. | Enforces $\ge 0.80$ confidence threshold before persisting annotations or triplets. |

---

## 3. Calibrated System Architecture

### 3.1 Five-Factor Calibrated Pipeline

```
Source Title + Excerpt
          │
          ├──> Factor 1: Evidence Sufficiency (Placeholders, Title-only, Thin text)
          │         └── If Insufficient ──> UNCERTAIN (conf < 0.50, requiresHumanReview: true)
          │
          ├──> Factor 2: Topical Relevance (Embodied Robot vs Software vs Care vs Unrelated)
          │         └── If Software / Non-robot Care ──> REJECTED (conf >= 0.90)
          │
          ├──> Factor 3: Thailand Connection (Institutions, Locations; Thai script separated)
          │         └── If Foreign Robot ──> REJECTED (conf >= 0.89)
          │
          ├──> Factor 4: Stance & Sentiment Disentanglement
          │         └── Evaluative indicators independent of theme (Privacy != Negative)
          │
          └──> Factor 5: Human Review Gate & Auto-Publish Safety
                    └── autoPublishEligible: ACCEPTED & conf >= 0.80 & sufficient & !requiresHumanReview
```

### 3.2 Evidence Sufficiency & Uncertainty Gating

The helper `evaluateEvidenceSufficiency` checks:
- **Placeholders**: Regex patterns matching OpenAlex metadata templates (`/^academic paper about .* indexed on openalex\.?$/i`, `/^openalex abstract metadata available\.?$/i`) and generic placeholders (`"placeholder"`, `"abstract not available"`).
- **Title-only**: Excerpt is empty or whitespace.
- **Thin text**: Excerpt < 30 characters or total substantive text < 45 characters.

Any record failing sufficiency or containing contradictory signals is assigned `relevanceStatus: "UNCERTAIN"`, requiring human review and suppressing auto-publication.

---

## 4. Benchmark Dataset & Provenance (`data/evaluation/bilingual-classification-benchmark.json`)

The benchmark consists of **32 curated cases** with agreed ground truth labels and explicit provenance:
- **16 Real Seed Records**: Sampled from authentic Thai humanoid and service robotics projects (Dinsaw, CU-Robo, Mahidol Siriraj, Pepper CentralWorld, Sensai, KMUTT FIBO, NECTEC) alongside valid negative cases. Each real seed record explicitly records `sourceRecordUrl`, `seedIndex`, and provenance adaptation notes.
- **16 Synthetic Fixtures**: Targeted stress-tests specifically reproducing Audit D05 vulnerabilities.
- **Language Coverage**: 18 English (56.2%), 12 Thai (37.5%), 2 Bilingual (6.3%).

---

## 5. Evaluation Results

```
--- Benchmark Evaluation Summary ---
Total Cases Evaluated: 32 (Real Seed: 16, Synthetic Fixtures: 16)
Benchmark Version: 1.0.0

┌─────────┬──────────────────────────────────────────────┬──────────────────────────────┬───────────────────────────────┬──────────────────────┐
│ (index) │ Metric                                       │ Baseline                     │ Calibrated                    │ Delta                │
├─────────┼──────────────────────────────────────────────┼──────────────────────────────┼───────────────────────────────┼──────────────────────┤
│ 0       │ 'Overall Relevance Accuracy'                 │ '43.8% (14/32)'              │ '96.9% (31/32)'               │ '+53.1%'             │
│ 1       │ 'Synthetic Traps False Positives'            │ '4/8 (50.0% FPR)'            │ '0/8 (0.0% FPR)'              │ '-4 false positives' │
│ 2       │ 'Synthetic Traps TNR (Specific Rejection)'   │ '50.0%'                      │ '100.0%'                      │ '+50.0%'             │
│ 3       │ 'Insufficient Evidence Uncertainty (D05)'    │ '1/5 (20.0%)'                │ '5/5 (100.0%)'                │ '+80.0%'             │
│ 4       │ 'Privacy Stance & Sentiment Disentanglement' │ '1/2 (50.0%)'                │ '2/2 (100.0%)'                │ '+50.0%'             │
│ 5       │ 'Auto-Publication Safety Rate'               │ '50.0% (9 unsafe publishes)' │ '100.0% (0 unsafe publishes)' │ '+50.0%'             │
└─────────┴──────────────────────────────────────────────┴──────────────────────────────┴───────────────────────────────┴──────────────────────┘
```
