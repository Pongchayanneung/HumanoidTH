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
| 4 | Focused checks | UNRUN | UNRUN |
| 5 | Typecheck | UNRUN | UNRUN |
| 6 | Production build | UNRUN | UNRUN |
| 7 | Baseline regressions ([m7-baseline-check.md](./m7-baseline-check.md)) | UNRUN | UNRUN |
| 8 | Other-device Thai queries | UNRUN | UNRUN |
| 9 | Other-device English queries | UNRUN | UNRUN |
| 10 | Outage and recovery | UNRUN | UNRUN |
| 11 | Second teammate restart/rollback runbook performed | UNRUN | UNRUN |
| 12 | Final 45 minutes rehearsal | UNRUN | UNRUN |

## Handover fields

| Field | Value |
|-------|-------|
| Tested commit | UNRUN |
| URL | UNRUN |
| Model id | UNRUN |
| Index id | UNRUN |
| Policy id | UNRUN |
| Release id / profile (from handoff check) | UNRUN |
| Coverage (eligible vs embedded) | UNRUN |
| Coverage complete? (yes/no; if no, demo is labelled partial/keyword-only) | UNRUN |
| Pilot results | UNRUN |
| Latency results | UNRUN |
| Operations (who restarts, who rolls back, where) | UNRUN |
| Unfinished scope | UNRUN |

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
