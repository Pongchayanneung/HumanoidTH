# HumanoidTH — shared context for the issue team

Every agent on the issue team reads this first. It is the short version of
what the planning docs say; the docs win when they disagree.

## Project

- Thailand Humanoid Atlas: Next.js 15 App Router + React 19 + Prisma 6 /
  PostgreSQL, plus a legacy Python package in `src/humanoid_atlas` (pytest in `tests/`).
- Key code: `app/actions.ts` (server actions), `app/map/actions.ts`,
  `app/api/**`, `lib/seed-importer.ts`, `lib/prisma.ts`, `prisma/schema.prisma`,
  `prisma/seed.ts`, `scripts/dev.ts`, `scripts/watch-seed.ts`, `middleware.ts`.
- Package manager: pnpm. Node >= 20.11.

## Source of truth for the hack day

- Tracker: issue #2 (`[TRACK] Hack Day delivery, assignments and dependencies`).
- Fix plan: `docs/Hackathon-preparation/Hack-day-planning/technical-fix-implementation-hack-day-plan.md`
- Feature plan: `docs/Hackathon-preparation/Hack-day-planning/feature-implementation-hack-day-plan.md`
- Technical design: `docs/Hackathon-preparation/feature-technical-design.md`
- Audit findings (T01–T13, D01–D14): `docs/Hackathon-preparation/Baseline-audit/`
- Issue IDs: M1–M8 baseline must-do, F1–F9 Atlas Search, S3–S5 should-do,
  R1–R4 deferred. The `[XX]` prefix in each issue title is its plan ID.

## Rules the issues impose (do not relax them)

1. **`status:blocked` = an unmet START prerequisite.** Check the issue's
   "Blocked from starting by" list. Fixture-based preparation is allowed while blocked;
   claiming completion is not.
2. **Existing code or a ticked checkbox is not evidence.** Only commands
   actually run on a recorded revision count.
3. **Candidate repair commits** (e.g. `5c897d6`) are partial and unverified.
   Inspect and reuse only reviewed, relevant hunks.
4. **Report every acceptance check as passed / failed / unrun**, and every
   behavior as repaired / contained / deferred. A failed required check keeps the issue open.
   Containment (a tested restriction) does not close a full-repair backlog issue.
5. **Disposable database + synthetic fixtures only.** Never point at a shared
   or production `DATABASE_URL`. Credentials never enter Git, issues or PRs.
6. **Restrict at the server** (action/API), not only in the UI.
7. Schema changes need agreement from all three owners. Changes to feature dependency or
   configuration files go through NoneTP. Flag these and do not do them silently.
8. Owners: NoneTP = actions/permissions/search API/ranking; Suk-Nsr = public
   policy/adapters/index/evaluation; Pongchayanneung = startup/map/navigation/GPU/hosting.

## Verification toolbox (cloud container)

- Disposable Postgres 16: `/usr/lib/postgresql/16/bin/{initdb,pg_ctl}` (or `docker`).
  Use a data dir in the scratchpad, a non-default port (e.g. 55432), and
  `DATABASE_URL=postgresql://postgres@localhost:55432/atlas_test`.
- Checks: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
  `pnpm test`, `pnpm build`, `npx prisma migrate deploy`, `pnpm exec playwright test --trace off`,
  `python3 -m pytest -q` (Python side).
- Chromium/Playwright are preinstalled. Do not run `playwright install`.
