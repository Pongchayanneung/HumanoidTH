---
name: issue-board
description: Whole-project triage for HumanoidTH. Reads all open issues and tracker #2, builds the dependency graph, and says which of a person's issues are startable now, which are blocked and on whom, and the recommended order. Use for "what should I work on", "my issues", "project status", or before /resolve-issue.
argument-hint: [github-login (default: Pongchayanneung)]
---

# Issue board

1. Read `.claude/team/project-context.md`.
2. `list_issues` on `pongchayanneung/humanoidth` with state OPEN and fields
   number, title, labels, assignees, updated_at. Then `issue_read` tracker #2.
3. For each open issue, `issue_read` the body and parse the "Blocked from starting by",
   "Blocked from completion by" and "Blocks" lists. For a large board, run
   `codebase-scout`-style parallel reads in one message, at most 10 issues per agent.
4. Build the graph. A node is startable when all its start-blockers are closed or have posted
   all-PASSED evidence. Flag stale labels: `status:blocked` on a startable issue, or no
   label on a blocked one.
5. Output:
   - **Your next move**: the one issue to run with `/resolve-issue <n>`, and why. Order by phase
     (baseline before feature), then priority, then how many issues it unblocks.
   - Table of the person's issues: `| # | ID | title | startable? | waiting on (who) | unblocks |`.
   - **Critical path** across all three owners (e.g. M1 → M4 → M8-C → M7 → F*).
   - Stale-label fixes to suggest. Do not apply them.
6. Offer to start `/resolve-issue` on the recommended issue.
