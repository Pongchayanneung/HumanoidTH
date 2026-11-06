# HumanoidTH agent team: running it on your Mac

## One-time setup
```bash
git clone https://github.com/Pongchayanneung/HumanoidTH.git && cd HumanoidTH
git checkout chore/agent-team          # the team lives here until it's merged
pnpm install --frozen-lockfile
# Optional external models. Log in with each CLI's own login flow:
#   gemini   (Gemini CLI)   -> second opinion
#   codex    (Codex CLI)    -> second opinion
export GEMINI_API_KEY=...   # only for art-book images; never commit it
docker info >/dev/null && echo "docker ok"   # disposable Postgres for the verifier
claude                                        # start Claude Code here
```

## Commands
| Command | What it does |
|---|---|
| `/issue-board` | Triage every open issue; tells you what you can start next |
| `/resolve-issue 3 --fast` | M1, end to end, on branch `issue/3-m1` in `../HumanoidTH-wt/` |
| `/resolve-issue 12 --prep-only` | M7: prepare the release-check commands now |
| `/resolve-issue 19 --ux` | F7: brief → art book → wireframe → build |

Suggested order: `3` → `12 --prep-only` → `6` → `11` → (after M7) `14`, `21`, `19 --ux`.
Read `analysis/pongchayanneung-issues.md` first. It lists the M1 bugs already found.

## Where you stop and decide (✋)
1. Plan approval, before any code is written.
2. Art-book direction and wireframe (UX lane only).
3. Publish: push, PR and issue comment. This always asks, even with `--auto`.

Every issue gets its own branch and worktree from `main`, so each PR holds only that issue's changes.
Nothing is merged and no issue is closed by the team. You and your teammates review and merge.
