# Pre-run analysis: Pongchayanneung's issues

Prepared 2026-11-06 at `main` = `37fdd93`. Inputs: issue bodies #2–#28, the plan docs,
candidate commit `5c897d6`, and code reads. **This is a static analysis. Nothing was
executed**, so none of it counts as acceptance evidence.

## Order of work (your lane)

```
Baseline (6h)                                   Feature (6h, starts only after M7)
M1 #3 (45m) ─► M4 #6 (35m) ─► M8-C #11 (30m) ─┐
M7 #12 prep (20m, start now) ─────────────────┴─► M7 final gate ─► F2 #14 (GPU) ─┐
                                                                  F9 #21 prep ────┤
                                     F1 #13 (NoneTP) ─► F7 #19 (UI, fixtures) ────┴─► F9 final
Backlog (no committed hours): S4 #24 after M3 (Suk-Nsr) · R1 #25 after M2+M3
```

| # | ID | Startable now? | Waits on | Unblocks | Mode |
|---|---|---|---|---|---|
| 3 | M1 | **Yes** | — | M4, M7 | `/resolve-issue 3` |
| 12 | M7 | **Prep only** (final waits on all of M1–M8) | everyone | F1 F2 F3 F8 F9 | `/resolve-issue 12 --prep-only` |
| 6 | M4 | After M1 | you | M8-C, M7 | `/resolve-issue 6` |
| 11 | M8-C | After M4; final needs M5, M8-A, M8-B | you, Suk-Nsr, NoneTP | M7 | fast lane |
| 14 | F2 | After M7 | team | F4 F6 F8 F9 | **GPU laptop, not the Mac** |
| 19 | F7 | After F1 | NoneTP | F9 | UX lane (art book → wireframe) |
| 21 | F9 | After M7 | everyone | — | prep early |
| 24 | S4 | After M3 | Suk-Nsr | — | backlog, don't take phase hours |
| 25 | R1 | After M2+M3 | NoneTP, Suk-Nsr | — | backlog, don't take phase hours |

## M1 #3: concrete findings (code read, unverified)

1. **Windows-only commands break macOS/Linux.** `scripts/dev.ts` spawns `pnpm.cmd`.
   `prisma.config.ts` sets seed to `node_modules/.bin/tsx.CMD prisma/seed.ts`.
   As written, both will fail on your MacBook.
2. **The connection config is wrong for the code.** `.env.example` ships `prisma+postgres://accelerate...`,
   but `lib/prisma.ts` and `lib/seed-importer.ts` use `@prisma/adapter-pg`, which
   needs a direct `postgresql://` URL. This is the M1 objective ("match runtime config").
3. **Ordinary startup writes data.** `pnpm dev` → `scripts/dev.ts` always starts
   `seed:watch`, which reseeds whatever `DATABASE_URL` points to on every file change.
   That violates the check that "restart preserves reviewed decisions and roles".
4. **The seed entry points are unguarded.** `pnpm db:seed` and `prisma db seed` both run
   `seedAtlasData` with no explicit confirmation. Both must require a guard,
   e.g. `ATLAS_ALLOW_SEED=1` plus a refusal when the target is not a local/disposable DB.
5. **Version skew to check.** `@prisma/adapter-pg ^7.8` is installed against
   `@prisma/client ^6.19` / `prisma ^6.1`. Verify that `pnpm build` and real CRUD work.
   Changing dependencies goes through NoneTP.
6. **Seeding semantics.** Re-seeding may overwrite review status and roles. Check `seedAtlasData`
   upserts before you claim restart preservation. This overlaps with M5/D04 (Suk-Nsr).

Candidate commit `5c897d6`: reuse hunks for `scripts/dev.ts` (`pnpm`, opt-in `WATCH_SEED=1`)
and `.env.example` / `docs/vercel-deploy.md` (direct postgres URL). The commit does **not**
fix `tsx.CMD` in `prisma.config.ts` or guard the seed entry points. Its other hunks belong
to M2/M4/M6/M8-B owners, so leave them for those issues.

## M4 #6 notes
`5c897d6` already reworks `app/map/actions.ts` (−87 lines, no fabricated StatsCache
fallback) and `app/map/page.tsx` (unavailable state). Still needed: reject unknown-origin
cache rows, deny direct generation/reanalysis server actions with zero side effects, and a
test proving that cold public reads make no model call (stub the Gemini client) and no cache write.

## Scope warnings
- **M8-C says "no general redesign", with a 30-minute allowance.** Use existing components.
  Do not use the art book step here, only the wireframe check of the existing journey.
- **The art book → wireframe lane fits F7** (the new `/search` page). It can start on frozen F1
  fixtures before vectors exist.
- **F2 needs the RTX 3080 laptop** (TEI + Qwen3-Embedding-0.6B, CUDA). The MacBook can
  prepare config, probes and auth, but the acceptance runs on the GPU machine.
- S4/R1 are backlog. Running the team on them must not consume baseline or feature hours.
- Time allowances are small (30–45 min). Use the **fast lane** in `/resolve-issue` for
  ≤ 45-minute issues: analyst at sonnet, no art book, one review round.
