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
| 4 | Focused checks | PASS | `node scripts/f9-handoff-check.ts` passed 5/5 local checks on the tested commit with Node `v24.16.0`. |
| 5 | Typecheck | PASS | [PR #61 CI typecheck](https://github.com/Pongchayanneung/HumanoidTH/actions/runs/42389763802/job/128454682109) passed on the tested commit. |
| 6 | Production build | UNRUN | Production build evidence is pending for the tested commit. |
| 7 | Baseline regressions ([m7-baseline-check.md](./m7-baseline-check.md)) | UNRUN | [PR #61 CI](https://github.com/Pongchayanneung/HumanoidTH/actions/runs/42389763802/job/128454682288) covered smoke and network tests. [M7 passed in PR #60 CI](https://github.com/Pongchayanneung/HumanoidTH/actions/runs/42399266007) on a separate revision. |
| 8 | Other-device Thai queries | UNRUN | Final rehearsal |
| 9 | Other-device English queries | UNRUN | Final rehearsal |
| 10 | Outage and recovery | UNRUN | Final rehearsal |
| 11 | Second teammate restart/rollback runbook performed | UNRUN | Final rehearsal |
| 12 | Final 45 minutes rehearsal | UNRUN | Final rehearsal |

## Handover fields

| Field | Value |
|-------|-------|
| Tested commit | `743345ddaf61ad0ed96cf8dcb42345e292c6d451` (local checker and PR CI) |
| Hosted URL | `UNRUN` |
| Model id | `UNRUN` |
| Index id | `UNRUN` |
| Policy id | `UNRUN` |
| Local manifest release id / profile | `search-v1-keyword` / `UNRUN` |
| Coverage (eligible vs embedded) | `UNRUN`. The local checker reported no coverage figures. |
| Coverage complete? (yes/no; if no, demo is labelled partial/keyword-only) | `UNRUN` |
| Pilot results | `UNRUN` |
| Latency results | `UNRUN` |
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
