# Submission-to-Publication Atomic Workflow (S5)

## Overview & Scope
Implements the atomic submission-to-publication workflow for community contributions ([Issue #22](https://github.com/Pongchayanneung/HumanoidTH/issues/22), finding D02). 
The workflow allows community contribution submissions to be submitted, inspected by verified operators, and atomically published or corrected to public `Contribution` records with full reviewer/target linkage, while ensuring that retries do not duplicate publication and failure leaves no partial published state. Unsupported submission types (e.g., direct inventory edits, raw robot specs) remain strictly restricted (`WORKFLOW_UNAVAILABLE`).

## Architecture & Data Flow

```
[ Contributor / Client ]
           │
           │  createSubmission({ submissionType: "contribution", title, url, ... })
           ▼
[ SubmittedData (status: QUEUED, payloadJson: {...}) ]
           │
           │  Operator Login via getOperatorPrincipal()
           ▼
[ reviewSubmission({ submissionId, decision: "APPROVED" | "REJECTED", reviewNotes }) ]
           │
           ├─► prisma.$transaction(async (tx) => {
           │      1. Load exact SubmittedData row
           │      2. Check idempotency: if already approved/linked, return existing
           │      3. If decision === "APPROVED":
           │           a. If payloadJson.targetRecordId:
           │                Update existing Contribution in place (Correction)
           │              Else:
           │                Create new public Contribution (visibility: "public", verificationStatus: "APPROVED")
           │           b. Update SubmittedData:
           │                status: "APPROVED"
           │                payloadJson: { publishedRecordId, reviewerEmail, reviewedAt }
           │         If decision === "REJECTED":
           │           Update SubmittedData:
           │             status: "REJECTED"
           │             payloadJson: { reviewerEmail, reviewedAt }
           │             (NO Contribution created or modified)
           │   })
           ▼
[ Public Data / Projection ]
   `isEligiblePublicContribution()` admits published records.
   Rejected/queued submissions are excluded from all public views.
```

## Acceptance Checks & Verification Matrix

| Acceptance Check | Implementation Reference | Test Verification | Status |
| --- | --- | --- | --- |
| **Verified operator authorization** | `lib/submission-workflow/service.ts:reviewSubmission`<br>`authorize(customCookies)` via `getOperatorPrincipal()` | `test/submission-workflow.test.ts` (unauthenticated & forged sessions rejected fail-closed) | PASS |
| **Atomic publish & correct target** | `lib/submission-workflow/postgres-repository.ts:executeReviewTransaction`<br>`prisma.$transaction` across `SubmittedData` and `Contribution` | `test/submission-workflow.test.ts` (new publication and in-place correction tests) | PASS |
| **Reviewer/target linkage** | `SubmittedData.payloadJson.publishedRecordId`<br>`SubmittedData.payloadJson.reviewerEmail`<br>`SubmittedData.payloadJson.reviewedAt` | `test/submission-workflow.test.ts` (asserts bidirectional linkage) | PASS |
| **Idempotency & retry safety** | Checks `submission.status === "APPROVED"` and verifies linked `Contribution` exists | `test/submission-workflow.test.ts` (retry test verifies 0 duplicate rows created) | PASS |
| **No partial state on failure** | Wrapped in atomic database transaction; rollback restores snapshot | `test/submission-workflow.test.ts` (simulated failure test verifies rollback) | PASS |
| **Shared public data policy** | Sets `visibility: "public"`, `verificationStatus: "APPROVED"`; tested against `isEligiblePublicContribution()` | `test/submission-workflow.test.ts` (evaluates `isEligiblePublicContribution`) | PASS |
| **Restrict unsupported types** | `submissionType !== "contribution"` returns `WORKFLOW_UNAVAILABLE` | `test/submission-workflow.test.ts` & `test/operator-boundaries.test.ts` | PASS |

## Test Execution Evidence
- Unit test suite: `node --import tsx --test test/submission-workflow.test.ts`
  - 10 tests executed, 10 passed (100%), 0 failed.
- Operator boundary suite: `node --import tsx --test test/operator-boundaries.test.ts`
  - 7 tests executed, 7 passed (100%), 0 failed.
- Full unit test suite: `pnpm test`
  - 256 tests executed: 244 passed, 0 failed, 12 skipped.
- Code hygiene: `pnpm run check:no-mock-data`
  - PASSED (no mock/fallback data signals found in app web code).
- TypeScript check: `pnpm run typecheck`
  - PASSED with 0 errors.

## Repaired, Contained, and Deferred Register
- **Repaired:**
  - Finding D02: Single atomic submission-to-publication workflow for `Contribution` records with reviewer attribution, target linkage, and idempotency.
- **Contained:**
  - Non-contribution submission types (`inventory`, `robot_model`, `source_record`) remain disabled with `WORKFLOW_UNAVAILABLE`.
  - Public submission page `app/submit-data/page.tsx` retains baseline containment.
- **Deferred:**
  - Automated AI re-evaluation and batch multi-record ingestion remain disabled until R2/S3.
