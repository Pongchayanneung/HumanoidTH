# F9 handoff: hosted deployment, regressions and demonstration (issue #21)

Every field below is `UNRUN` until someone runs it and records the real output. Do not fill a field from
memory, from a checkbox or from a different commit. Do not invent URLs, results or numbers.

> **Semantic delivery rule.** Full semantic delivery requires complete eligible vector coverage. A
> keyword-only or partial-coverage demo must be labelled as such on screen and in this handoff, and it does
> **not** close the requirement.

Local preparation: `npx tsx scripts/f9-handoff-check.ts` (manifest checksums, release not under `public/` or
in client code, no secret-like names in `public/`, required scripts, commit/node/release facts). It does not
deploy and is not a substitute for the hosted checks below.

## Checklist

| # | Item | Status | Evidence (command output / link) |
|---|------|--------|----------------------------------|
| 1 | Hosted bundle loads the release (release id served equals manifest release id) | UNRUN | UNRUN |
| 2 | Semantic slice working by hour 3 | UNRUN | UNRUN |
| 3 | Freeze at hour 4.5 | UNRUN | UNRUN |
| 4 | Focused checks | PASS | `scripts/f9-handoff-check.ts` all 5 checks passed |
| 5 | Typecheck | PASS | `pnpm typecheck` exit code 0 |
| 6 | Production build | PASS | `pnpm build` completed with static generation exit code 0 |
| 7 | Baseline regressions ([m7-baseline-check.md](./m7-baseline-check.md)) | PASS | M7 outcome suite passed in CI e2e |
| 8 | Other-device Thai queries | UNRUN | Final rehearsal |
| 9 | Other-device English queries | UNRUN | Final rehearsal |
| 10 | Outage and recovery | UNRUN | Final rehearsal |
| 11 | Second teammate restart/rollback runbook performed | UNRUN | Final rehearsal |
| 12 | Final 45 minutes rehearsal | UNRUN | Final rehearsal |

## Handover fields

| Field | Value |
|-------|-------|
| Tested commit | `3939e016265087ebfc22faeb13d78f9921753656` |
| URL | `http://localhost:3333` (local production smoke test) |
| Model id | `UNRUN` (keyword-first release) |
| Index id | `releaseId: search-v1-keyword` |
| Policy id | `FROZEN_SEMANTIC_POLICY` |
| Release id / profile (from handoff check) | `search-v1-keyword` / Node `v26.9.0` |
| Coverage (eligible vs embedded) | 251 eligible / 0 embedded (keyword mode) |
| Coverage complete? (yes/no; if no, demo is labelled partial/keyword-only) | No, labelled keyword-only on screen and in handoff |
| Pilot results | `test/search-evaluation.test.ts` passing |
| Latency results | Offline retrieval latency verified in `test/search-evaluation.test.ts` |
| Operations (who restarts, who rolls back, where) | Deployer: Pongchayanneung; Verifiers: NoneTP, Suk-Nsr |
| Unfinished scope | Live TEI vector embeddings and hosted staging URL |

## Restart / rollback runbook (second teammate)

Performed by someone other than the person who deployed. Record name, time and outcome.

| Step | Status | Notes |
|------|--------|-------|
| Restart hosted service | UNRUN | UNRUN |
| Roll back to previous release | UNRUN | UNRUN |
| Confirm release id after rollback | UNRUN | UNRUN |

## Sign-off

| Role | Name | Date | Status |
|------|------|------|--------|
| Deployer | UNRUN | UNRUN | UNRUN |
| Second teammate | UNRUN | UNRUN | UNRUN |
