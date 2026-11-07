# Checked Demonstration Manifest Specification

**HumanoidTH · HRI Hackathon Thailand 2026**  
**Issue:** [M5] Publish the checked demonstration manifest ([#7](https://github.com/Pongchayanneung/HumanoidTH/issues/7))  
**Auditor / Data Owner:** Suk-Nsr  
**Date:** 7 November 2026  
**Status:** Manifest & Specification Published (D04 remains open)

---

## 1. Executive Summary & Objective

Baseline audit finding **D04** (*"Seed import assigns trust and can undo curation"*) demonstrated that inherited seed scripts blindly marked raw imported records as `ACCEPTED` or `APPROVED`. Re-running imports could overwrite human corrections, while synthetic placeholder fixtures (such as `"seed:contribution:thai-hri-research"`) were published directly into public views.

The **Checked Demonstration Manifest** (`data/checked-demonstration-manifest.v1.json`) addresses the public demonstration boundary by defining an authoritative, human-reviewed public subset for the Hack Day demonstration:
- **Separation of Concerns:** Inherited machine-import flags (`ACCEPTED`/`APPROVED`) are strictly distinguished from human factual verification.
- **Traceable Provenance:** Every checked record specifies an identifiable reviewer (`Suk-Nsr`), verification date, canonical source URL, verified factual claims, and calibrated uncertainty.
- **Exclusion of Placeholders & Weak Claims:** Placeholders, duplicates, generic registry buckets, unverified foreign robots, and pending submissions are explicitly excluded.
- **Corpus Preservation:** The original raw corpus (`thailand_humanoid_atlas_seed_records.json`) remains completely preserved and untouched.
- **Audit Finding Scope:** Finding D04 remains open until baseline ingestion refactoring lands; this manifest provides the checked slice consumed by M3 and M8-B to guard public views.

---

## 2. Dataset Provenance & Integrity

| Property | Value |
| --- | --- |
| **Manifest Version** | `1.0.0` |
| **Dataset ID** | `thailand-humanoid-atlas-checked-demo-v1` |
| **Original Corpus File** | `thailand_humanoid_atlas_seed_records.json` |
| **Original Corpus Canonical SHA-256 (LF)** | `29c634dc20af30bca15726d4e253c0688ec86bd6cb6246965a136d2e78597879` |
| **Total Records in Corpus** | 6,749 |
| **Checked Public Records** | 29 |
| **Documented Exclusions** | 8 |

---

## 3. Manifest Record Schema

Each record in `records` conforms to the following schema:

```typescript
export interface CheckedRecord {
  typedId: string;           // E.g. "robot_model:dinsaw-robot", "contribution:cu-robocovid-deployment"
  canonicalUrl: string;      // Authoritative URL for primary evidence (HTTP/HTTPS)
  recordType: string;        // "robot_model" | "contribution" | "source_record" | "triplet" | "perspective_annotation"
  title: string;             // Official canonical title
  checkedClaims: string[];   // Verified factual claims
  reviewer: string;          // Human reviewer ("Suk-Nsr")
  reviewedDate: string;      // ISO 8601 Date ("2026-11-07")
  uncertainty: number;       // Calibrated uncertainty score (0.00 – 1.00) approximately (1 - seedConfidence); where the seed triplet carries its own confidence that value was used, so a few records differ by about 0.01
  publicEligibility: boolean;// true for public presentation
  sourceType: string;        // E.g. "WEB", "OPENALEX", "GDELT"
  origin: string;            // E.g. "Thailand"
  evidence: string;          // Provenance citation and verification summary
}
```

---

## 4. Included Checked Demonstrations

### 4.1 Robot Models (11 records)
- **`robot_model:dinsaw-robot`**: Dinsaw Robot (CT Asia Robotics)
- **`robot_model:dinsaw-mini-home-ai`**: Dinsaw Mini Home AI Assistance (CT Asia Robotics / NIA)
- **`robot_model:pinto-robot`**: Pinto Quarantine Delivery Robot (CU-RoboCOVID)
- **`robot_model:mirror-telepresence`**: Mirror Telepresence System (CU / Obodroid)
- **`robot_model:ninja-robot`**: Ninja Hospital Monitoring Robot (CU Engineering)
- **`robot_model:kaitomm-robot`**: Kaitomm Residential Companion Robot (Obodroid)
- **`robot_model:sr1-security-robot`**: SR1 Security Patrol Robot (Obodroid)
- **`robot_model:mr-sam-service-robot`**: Mr SAM Outpatient Service Robot (King Chulalongkorn Memorial Hospital)
- **`robot_model:corgi-healthcare-robot`**: CORGI Physical Therapy Robot (True Digital / KCMH)
- **`robot_model:chula-rehab-stroke-robot`**: Chula Stroke Rehabilitation Robots (Chulalongkorn University)
- **`robot_model:ai-police-cyborg`**: AI Police Cyborg 1.0 (Royal Thai Police / Security Pitch)

### 4.2 Community & Academic Contributions (3 records)
- **`contribution:cu-robocovid-deployment`**: CU-RoboCOVID Pinto & Mirror deployment (Chulalongkorn University)
- **`contribution:kmutt-robotics-for-all`**: Robotics for All outreach and training (KMUTT FIBO)
- **`contribution:robo-buddy-education`**: Robo-Buddy educational coding companion (Chulalongkorn University)

### 4.3 Authoritative Source Records (8 records)
- **`source_record:ct-asia-official`**: Dinsaw official corporate website
- **`source_record:chula-pinto-covid`**: Chula announcement #42184 on Pinto deployments
- **`source_record:thailand-gov-dinsaw-mini`**: Royal Thai Government PR department feature on Dinsaw Mini
- **`source_record:true-chula-medical-robot`**: True Corporation engineering blog on nuclear medicine assistant robot
- **`source_record:bangkok-post-chula-robots`**: Bangkok Post third-party independent coverage of hospital robotics
- **`source_record:aws-ai-police-cyborg`**: AWS technical case study on AI Police Cyborg in Nakhon Pathom
- **`source_record:kmutt-fibo-robotics-for-all`**: KMUTT RIPO research highlight database
- **`source_record:openalex-mitsantisuk-ku-robotics`**: OpenAlex work W1678091165 (DOI: 10.1541/ieejias.135.nl4_5) Chowarit Mitsantisuk / Kasetsart University Robotics

### 4.4 Triplet Relations (5 records)
- **`triplet:dinsaw-developed-by-ctasia`**: Dinsaw Robot -> developed_by -> CT Asia Robotics (confidence: 0.96)
- **`triplet:pinto-deployed-in-hospitals`**: Pinto Robot -> deployed_in -> hospitals across Thailand (confidence: 0.93)
- **`triplet:kaitomm-developed-by-obodroid`**: Kaitomm Robot -> developed_by -> Obodroid (confidence: 0.88)
- **`triplet:true-digital-collab-kcmh`**: True Digital -> collaborated_with -> KCMH (confidence: 0.92)
- **`triplet:ai-police-developed-by-security-pitch`**: AI Police Cyborg -> developed_by -> Security Pitch (confidence: 0.84)

### 4.5 Perspective Annotations (2 records)
- **`perspective:elderly-care-safety`**: Supportive perspective on Dinsaw Mini Home AI assistance (Chulalongkorn University news highlight #198924)
- **`perspective:public-safety-surveillance`**: Supportive institutional framing on smart policing (AWS Thailand technical blog)

---

## 5. Explicitly Excluded Records (8 records)

1. `seed:contribution:thai-hri-research`: Legacy placeholder contribution.
2. `seed:contribution:hospital-field-observation`: Legacy placeholder field observation without empirical verification.
3. `robot_model:bumi-humanoid-robot`: Out of scope foreign humanoid robot (Noetix Robotics, China) exhibited temporarily at a conference in Bangkok without ongoing Thai laboratory research or deployment.
4. `robot_model:ubtech-walker`: Unverified foreign robot without verified primary Thai deployment.
5. `robot_model:hospital-delivery-service-robot`: Generic placeholder bucket.
6. `robot_model:thai-university-social-robot-prototype`: Generic prototype placeholder.
7. `submission:robo-buddy`: Pending submission requiring manual administrative enrichment before publication.
8. `seed:source_record:dinsaw-mini-video-duplicate`: Duplicate video record in raw seed corpus excluded as redundant crawl duplicate.

## Gate rule for M3

M3 must gate with `isPublicCheckedRecord` (typed ID), never `isPublicCheckedUrl`: an excluded record can share a URL with an included one. No mapping from `typedId` to a database record exists yet; M3 must add it before it gates on this manifest.
