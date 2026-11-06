---
name: resolve-issue
description: Run the HumanoidTH issue team on one GitHub issue end to end. Analyze → plan → implement → verify → review → evidence → PR, with human checkpoints. Use when the user says "/resolve-issue <n>", "do issue #n", "finish M1", etc.
argument-hint: <issue-number> [--prep-only] [--auto]
---

# Resolve a HumanoidTH issue with the agent team

Repo: `pongchayanneung/humanoidth`. Team context: `.claude/team/project-context.md` (read it now).
Scratch output dir: `$SCRATCH/issue-<n>/`, where `$SCRATCH` is the session scratchpad.
If there is no scratchpad, use `.claude/team/runs/` (gitignored).

| Role | Agent (`subagent_type`) | Model | Skills |
|---|---|---|---|
| Lead analyst | `issue-analyst` | opus | testing-strategy, architecture |
| Code mapper | `codebase-scout` | haiku | — |
| Builder | `implementer` | sonnet | debug |
| QA | `verifier` | sonnet | deploy-checklist, run |
| Reviewer | `reviewer` | opus | code-review, security-review |
| Scribe | `evidence-writer` | haiku | documentation |

You (the main session) are the **orchestrator**. You own git, GitHub writes and user checkpoints.
Agents return reports, and you save each one to the scratch dir as `0X-<role>.md`.
Pass each agent the paths of earlier reports, not pasted copies.

## Phase 0 — Gate (orchestrator)
1. `issue_read` the issue. Parse its plan ID, assignee, labels and the "Blocked from starting by" list.
2. For each start-blocker, check that it is closed or that its evidence comment shows all required checks PASSED.
3. Decide: READY, PREP-ONLY (if blocked or `--prep-only`), or STOP (wrong assignee: ask the user).
   Tell the user the decision in one line.

## Phase 1 — Analyze (parallel)
Launch **in one message**:
- `issue-analyst` with the issue number and the gate result.
- `codebase-scout` with the topics from the issue objective (e.g. M1 → "startup scripts, seed entry
  points, Prisma connection config").
Then send the scout's map to the analyst if it asked for one. Save `01-brief.md` and `01-scout.md`.

## Phase 2 — Checkpoint ✋ (skip only with `--auto`)
Show the user the gate verdict, the plan (bullets), the verification matrix and the open questions.
Ask for approval or edits with AskUserQuestion. Stop if they decline.

## Phase 3 — Build
1. `git fetch origin main && git checkout -B issue/<n>-<plan-id-lowercase> origin/main`.
2. Run `implementer` with the brief path. In PREP-ONLY mode, limit it to fixtures, tests and
   scaffolding that need no unmet prerequisite.
3. Commit its work: `git add -A && git commit -m "<plan-id>: <summary> (#<n>)"` plus attribution trailers.

## Phase 4 — Verify + Review loop (max 2 rounds)
1. Run `verifier` and wait for it, then run `reviewer`, which reads the verifier output.
2. If the verdict is CHANGES or any required check FAILED, send the findings to `implementer`, commit,
   and repeat. After 2 rounds, stop looping and carry the remaining failures into the evidence.
Save `04-verify-rN.md` and `04-review-rN.md`.

## Phase 5 — Evidence
Run `evidence-writer` → `05-issue-<n>-evidence.md`, `05-issue-<n>-pr.md`.
Check that each verdict matches the latest verifier report. Correct any mismatch yourself.

## Phase 6 — Publish ✋ (always ask, even with `--auto`)
Show the user the evidence summary. With their approval:
- `git push -u origin <branch>` (retry with backoff on network errors only).
- Create a PR with the PR draft. Leave it open; the owners review it.
- Post the evidence comment on the issue.
- Suggest label changes for the issues this one blocks. Change labels only if the user says to.
Then offer to watch the PR (`subscribe_pr_activity`).

## Never
- Claim a check passed without a verifier command and output.
- Push to `main`, merge, close issues, or touch other owners' issues without being asked.
- Put credentials, a real `DATABASE_URL` or admin passwords in commits, comments or PRs.
- Make schema or dependency changes without the owner agreement recorded in the brief.
