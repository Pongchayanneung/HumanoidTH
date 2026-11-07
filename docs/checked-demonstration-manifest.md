# Checked Demonstration Manifest Specification

**HumanoidTH · HRI Hackathon Thailand 2026**  
**Issue:** [M5] Publish the checked demonstration manifest ([#7](https://github.com/Pongchayanneung/HumanoidTH/issues/7))  
**Auditor / Data Owner:** Suk-Nsr  
**Date:** 7 November 2026  
**Status:** Implemented & Verified

---

## 1. Executive Summary & Objective

Baseline audit finding **D04** (*"Seed import assigns trust and can undo curation"*) demonstrated that inherited seed scripts blindly marked raw imported records as `ACCEPTED` or `APPROVED`. Re-running imports could overwrite human corrections, while synthetic placeholder fixtures (such as `"seed:contribution:thai-hri-research"`) were published directly into public views.

The **Checked Demonstration Manifest** (`data/checked-demonstration-manifest.v1.json`) solves this by defining an authoritative, human-reviewed public subset for the Hack Day demonstration:
- **Separation of Concerns:** Inherited machine-import flags (`ACCEPTED`/`APPROVED`) are strictly distinguished from human factual verification.
- **Traceable Provenance:** Every checked record specifies an identifiable reviewer (`Suk-Nsr`), verification date, canonical source URL, verified factual claims, and calibrated uncertainty.
- **Exclusion of Placeholders & Weak Claims:** Placeholders, duplicates, generic registry buckets, and unverified foreign robots are explicitly excluded.
- **Corpus Preservation:** The original raw corpus (`thailand_humanoid_atlas_seed_records.json`) remains completely preserved and untouched.

---

## 2. Dataset Provenance & Integrity

| Property | Value |
| --- | --- |
| **Manifest Version** | `1.0.0` |
| **Dataset ID** | `thailand-humanoid-atlas-checked-demo-v1` |
| **Original Corpus File** | `thailand_humanoid_atlas_seed_records.json` |
| **Original Corpus SHA-256** | `198e51ebaad252b57823adce678910313cd12b723135a51d417274effe31432c` |
| **Total Records in Corpus** | 6,749 |
| **Checked Public Records** | 29 |
| **Documented Exclusions** | 6 |

---

## 3. Manifest Record Schema

Each record in `records` conforms to the following schema:

```typescript
export interface CheckedRecord {
  typedId: string;           // E.g. "robot_model:dinsaw-robot", "contribution:cu-robocovid-deployment"
  canonicalUrl: string;      // Authoritative URL for primary evidence
  recordType: string;        // "robot_model" | "contribution" | "source_record" | "triplet" | "perspective_annotation"
  title: string;             // Official canonical title
  checkedClaims: string[];   // Verified factual claims
  reviewer: string;          // Human reviewer ("Suk-Nsr")
  reviewedDate: string;      // ISO 8601 Date ("2026-11-07")
  uncertainty: number;       // Calibrated uncertainty score (0.00 – 1.00)
  publicEligibility: boolean;// true for public presentation
  sourceType: string;        // E.g. "WEB", "OPENALEX", "GDELT"
  origin: string;            // E.g. "Thailand"
  evidence: string;          // Provenance citation and verification summary
}
```

---

## 4. Included Checked Demonstrations

### A. Robot Models (11 Verified Models)
1. **Dinsaw Robot** (`robot_model:dinsaw-robot`) — CT Asia Robotics (Thailand). Eldercare & hospital outpatient service robot deployed in Thai healthcare facilities.
2. **Dinsaw Mini Home AI** (`robot_model:dinsaw-mini-home-ai`) — CT Asia Robotics & NIA. Home companion and tele-consultation robot.
3. **Pinto Robot** (`robot_model:pinto-robot`) — CU-RoboCOVID (Chulalongkorn Engineering, Mi Workspace, HG Robotics, Obodroid). Hospital delivery robot deployed during COVID-19 pandemic.
4. **Mirror Telepresence System** (`robot_model:mirror-telepresence`) — Chulalongkorn University & Obodroid. Remote medical consultation telepresence robot.
5. **Ninja Robot** (`robot_model:ninja-robot`) — Chulalongkorn University. Tele-monitoring hospital robot.
6. **Kaitomm Robot** (`robot_model:kaitomm-robot`) — Obodroid (Thailand). Residential companion and smart home assistant robot.
7. **SR1 Security Robot** (`robot_model:sr1-security-robot`) — Obodroid (Thailand). Autonomous security and perimeter patrol robot.
8. **Mr SAM outpatient service robot** (`robot_model:mr-sam-service-robot`) — King Chulalongkorn Memorial Hospital. Outpatient guidance and triage robot.
9. **CORGI Healthcare Robot** (`robot_model:corgi-healthcare-robot`) — True Digital Group & King Chulalongkorn Memorial Hospital. Physical therapy assistant robot.
10. **Chula Rehabilitation Robots for Stroke Patients** (`robot_model:chula-rehab-stroke-robot`) — Chulalongkorn Robotics and Automation Center. Stroke upper-limb rehabilitation system.
11. **AI Police Cyborg 1.0** (`robot_model:ai-police-cyborg`) — Security Pitch & Royal Thai Police Region 7 (Nakhon Pathom). Public safety surveillance and automated reporting kiosk.

### B. Contributions (3 Verified Projects)
1. **CU-RoboCOVID Pinto and Mirror deployment** (`contribution:cu-robocovid-deployment`) — Chulalongkorn University.
2. **Robotics for All - KMUTT FIBO** (`contribution:kmutt-robotics-for-all`) — Institute of Field Robotics, KMUTT.
3. **Robo-Buddy: Educational Coding Companion** (`contribution:robo-buddy-education`) — Chulalongkorn University Sustainability.

### C. Source Records (8 Verified Sources)
- Primary corporate domains (CT Asia, True Digital, Obodroid).
- University press and research archives (Chulalongkorn University, KMUTT RIPO).
- National news reports (Bangkok Post).
- Government innovation publications (Royal Thai Government Portal `thailand.go.th`).
- Scholarly indices (OpenAlex record `W2963388701` for Kasetsart University Haptics and Robotics Laboratory).

### D. Checked Relationships & Perspectives
- 5 Verified Triplets linking entities, developers, and deployment hospitals.
- 2 Calibrated Perspective Annotations with primary text evidence.

---

## 5. Explicitly Excluded Records

| Identifier | Category | Reason for Exclusion |
| --- | --- | --- |
| `seed:contribution:thai-hri-research` | Placeholder | Synthetic placeholder injected by legacy seed importer without empirical data or source publication. |
| `robot_model:bumi-humanoid-robot` | Unverified Claim | Foreign robot (China) exhibited temporarily at a Bangkok conference; no Thai development or deployment. |
| `robot_model:ubtech-walker` | Unverified Claim | Imported platform tagged as `rumored_unverified` in seed data; lacks verified deployment evidence. |
| `robot_model:hospital-delivery-service-robot` | Generic Bucket | Generic placeholder registry bucket without specific model name or institutional custodian. |
| `robot_model:thai-university-social-robot-prototype` | Generic Bucket | Generic prototype bucket pending curated university lab sources. |
| `submission:robo-buddy` | Pending Review | Notes explicitly demand manual review and enrichment before public publication; auto-approval prevented. |

---

## 6. Integration Contract & Next Steps

1. **Downstream Task [M3] (Issue #5):**
   - The Public Data Projection middleware and server queries will import `lib/manifest/demo-manifest.ts`.
   - `isPublicCheckedRecord(idOrUrl)` provides the filter gate to ensure anonymous public views cannot leak unreviewed or private records.
2. **Downstream Task [M8-B] (Issue #10):**
   - The contributions filter page tests against `getPublicCheckedRecords("contribution")` to guarantee that queries return only human-verified contributions.
3. **Downstream Task [F3] (Issue #15):**
   - Atlas Search full-corpus export will use the public admission policy established here without mistaking the small demonstration manifest for the complete atlas index.
