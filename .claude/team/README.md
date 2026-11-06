# HumanoidTH agent team: running it on your Mac

## A. Continue THIS cloud session in your Mac terminal (optional)
```bash
cd ~/path/to/HumanoidTH            # a clone of Pongchayanneung/HumanoidTH
claude --teleport                  # pick this session from the list, or:
claude --teleport session_01V5p7wC7tvr3y19o9UoxSEW
```
Teleport brings the conversation and branch to your machine. Your Mac's own agents, skills,
Chrome and Codex/Gemini CLIs then become available to it.

## B. Fresh start on the Mac (recommended for the full autonomous run)
```bash
# 1. Code + team branch
git clone https://github.com/Pongchayanneung/HumanoidTH.git
cd HumanoidTH
git checkout chore/agent-team
pnpm install --frozen-lockfile

# 2. Tools the team can use (each is optional; the team skips what's missing)
docker info >/dev/null && echo "docker ok (disposable Postgres)"
gemini --version   # Gemini CLI, logged in   -> second-opinion reviewer
codex --version    # Codex CLI, logged in    -> second-opinion reviewer
#    ChatGPT image art book: sign in to https://chatgpt.com in Chrome and enable the
#    Claude in Chrome extension (or computer use for the ChatGPT desktop app).
export GEMINI_API_KEY=...   # optional fallback for images; never commit it

# 3. Run the whole team autonomously
claude
```
Then inside Claude Code:
```
/hackday-team                 # dispatch every startable issue of yours, loops, draft PRs, summary
```
Or one piece at a time:
```
/issue-board                  # triage only
/resolve-issue 3 --fast       # M1 alone
/resolve-issue 19 --ux        # F7 design studio (concept → ChatGPT art book → wireframe)
/hackday-team --ask           # same as /hackday-team but asks you at each gate
```

To avoid permission prompts during a long autonomous run, start Claude Code in auto mode
(`claude --permission-mode auto`) or add allow rules with `/fewer-permission-prompts`.

## What the team does without you, and what it never does
- Does: branches + worktrees per issue, reviews and feedback loops, pushes `issue/*` and `design/*`
  branches, opens **draft** PRs, comments evidence on **your own** issues.
- Never: merges, closes issues, pushes to `main`, touches teammates' issues, sends secrets or private
  data to ChatGPT/Gemini/Codex.

Results: `.claude/team/runs/<timestamp>/SUMMARY.md` and `decisions.md` (every call `team-lead` made).
