# Baseline handoff (M7, issue #12): lane B close-out

Written 2026-11-08 (Asia/Bangkok) by Claude Code for Pongchayanneung. This is **execution evidence for one revision**, not a
release verdict. Nothing here closes #12: the open items are listed under "Not run" and "Deferred". No secrets are in this file.

## Tested revision

- Base: `739d583309cf73b33ed1e97f77b357fa47c439d5` (`origin/main`, merge of PR #74), clean tree at test time.
- Added on this branch (`docs/baseline-handoff`): `scripts/m7-crud-restart.ts` (the CRUD and restart script) and this page. Nothing
  else changed; the application code that was tested is exactly `739d583`.
- `pnpm-lock.yaml` sha256: `9f48c0f73008bc7417ad3680c768b6b17e89c811f9ca07b9fb3fda74de956b64`.

## Environment

| Item | Value |
| --- | --- |
| Host | MacBook Pro, Apple Silicon (arm64), macOS 27.0 (Darwin 27.0.0) |
| Node | **26.9.0** (CI uses 22; not run on 22, see "Not run") |
| pnpm | 9.15.9 via `npx --yes pnpm@9.15.9` (pnpm 11 breaks `pnpm run` here) |
| Postgres | 16.15 (Homebrew `postgresql@16`), disposable cluster, trust auth, `127.0.0.1:55433`, database `atlas_laneb`; second cluster `127.0.0.1:5544` for the DB-gated suites |
| Playwright | 1.61.1, Chromium only |
| Operator variables | the throwaway `OPERATOR_*` values from the `e2e` job in `.github/workflows/ci.yml`; `OPERATOR_APP_ORIGIN` changed per run, see below |
| Provider keys | none set (`GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN`, Google keys unset): no provider call was possible |
| Database state | `prisma migrate deploy` then `ATLAS_ALLOW_SEED=1 pnpm run db:seed` on an empty database. After seed: Contribution 4, RobotModel 17, SubmittedData 1, User 1, OwnedInventory 0, SourceRecord 6719, Triplet 10, PerspectiveAnnotation 4, SourcePullJob 1 |

Another agent started a `next dev` on port 3000 of this machine while I worked (its cwd was `HumanoidTH-wt/run/ui-verify`). After that I
ran the Playwright spec on port 3187 through a copy of the config and the spec that differs from the originals only in the port
(`localhost:3000` replaced by `localhost:3187`; verified with `diff`). That copy was deleted afterwards and is not committed.

## Setup commands

```sh
export PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH
initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8
pg_ctl -D "$PGDATA" -o '-p 55433 -c listen_addresses=127.0.0.1' -w start
createdb -h 127.0.0.1 -p 55433 -U postgres atlas_laneb

export DATABASE_URL=postgresql://postgres@127.0.0.1:55433/atlas_laneb
# plus OPERATOR_EMAIL, OPERATOR_PASSWORD_HASH, OPERATOR_AUTH_EPOCH, OPERATOR_APP_ORIGIN exactly as in ci.yml (e2e job)
npx --yes pnpm@9.15.9 install --frozen-lockfile
npx --yes pnpm@9.15.9 exec prisma migrate deploy
ATLAS_ALLOW_SEED=1 npx --yes pnpm@9.15.9 run db:seed
npx --yes pnpm@9.15.9 run build
NODE_ENV=production node ./node_modules/next/dist/bin/next start -p 3187
```

## Results

Words: PASS = ran and exited 0 with the stated assertions. FAIL = ran and failed. UNRUN = not executed (not a pass).

### Static and unit

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm run typecheck` | PASS (also with the new script) |
| No-mock-data scan | `pnpm run check:no-mock-data` | PASS ("No mock/fallback data signals found") |
| Unit tests, DB URL set | `pnpm run test` | PASS: 295 tests, 289 pass, 0 fail, 6 skipped (the 6 need DB gates) |
| Unit tests, DB-gated suites on | `OPERATOR_AUTH_TEST_DB=1 ISSUE4_AUTH_ACCEPTANCE=1`, `DATABASE_URL` to `127.0.0.1:5544/hri_issue4_test` (migrated), `tsx --test test/*.test.ts` | PASS: 295 tests, 294 pass, 0 fail, 1 skipped (`public contribution aggregates include eligible null URLs and exclude private and pending rows`; its skip condition was not investigated) |
| Integration suite | same env, `tsx --test test-integration/*.test.ts` | **FAIL 1 of 10** (9 pass). `disabled handlers remain effect-free with a real valid operator session...` fails because `app/api/export/route.ts:27` now reads the request (`new URL(req.url)`) for a valid operator session, which the test's poison request object forbids. Export was opened to operators in #23 (S3); the test still expects a 403 for every caller. Stale test, not a disclosure bug: anonymous and forged callers still get 403 (below). This suite is not in CI. |

### Outcome 1: runnable application, CRUD, restart preservation

| Check | How | Result |
| --- | --- | --- |
| Production build | `pnpm run build` (run twice, once per build) | PASS, exit 0, all routes listed |
| Real Prisma CRUD | `ATLAS_ALLOW_SEED=1 tsx scripts/m7-crud-restart.ts crud` against the migrated, seeded DB, using the app's own `createPostgresSubmissionWorkflowRepository` plus Prisma for user and inventory | PASS, 7 of 7 lines: submission create+read, review update; contribution create, update, read by unique `sourceUrl`; duplicate `sourceUrl` rejected by the database; user and inventory create (private default applied) and role update; delete of all four rows confirmed by count |
| Restart preservation | `persist-write` while the production server was up (pid 21602), snapshot, server stopped (port confirmed free), started again (new pid 21778, `GET /` 200), `persist-verify`, snapshot again | PASS: reviewed contribution keeps `REJECTED`, user keeps `ADMIN`, private unit keeps visibility and serial; per-table row count and md5 for 11 tables are identical before and after the restart (files `snap1.txt`/`snap2.txt` in the session scratchpad, not committed) |
| Negative control | changed the marker user's role in SQL, ran `persist-verify` | FAIL as intended (exit 1), then restored and PASS. The verify step can fail |
| Ordinary startup does not seed | read: `start` is `next start`; seed only runs from `prisma/seed.ts` and is blocked unless `ATLAS_ALLOW_SEED=1` and a local URL (`lib/seed-guard.ts`) | Observed by the unchanged snapshots across the restart. A re-seed was not executed; the guard comment says seeding resets reviewed relevance status, re-grants the seed admin and appends duplicate pull-job/submission rows |

Limit: the app has no public write path any more (server actions are denied by design), so the "CRUD journey" is the repository and
Prisma level, not a browser journey. Process-level restart was tested, not a Vercel redeploy.

### Outcome 4: privacy and access in production mode (`next build` + `next start`)

Raw HTML and the React Server Component payload (`RSC: 0` and `RSC: 1` headers) of 18 routes (`/`, `/search`, `/dashboard`, `/map`,
`/network`, `/perspectives`, `/robots`, `/inventory`, `/inventory?mode=operator`, `/contributions`, `/contributions?status=NEEDS_REVIEW`,
`/analytics`, `/database`, `/submit-data`, `/data-pulls`, `/profile`, `/api/network/graph`, `/api/network/graph?includePrivate=true`,
`/api/search?q=robot`) were fetched with `curl`, anonymous and with forged `admin_session`, `user_role`, `user_email`, `operator_session`
cookies, and searched for 11 markers: a private unit's name, owner, custodian, location, serial and notes (inserted as fixtures), a public
unit's serial, custodian, location and notes, and the seeded pending contribution and submission texts.

- PASS: 0 leaks, anonymous and forged. Done twice (once on port 3000 against my own server, once on 3187).
- Positive controls: the public unit's name is present in `/inventory` (so the scan sees the payload) and the private unit's name is absent;
  the approved contribution is present in `/contributions`, in both HTML and RSC.
- Public unit masking in production, raw payload: the public unit's owner, serial, custodian, location and notes: 0 hits in HTML and RSC.
  This closes the item that `docs/m7-baseline-check.md` left manual ("raw production inventory payload privacy") for these fields on this revision.
- `GET /api/export` anonymous 403, forged cookies 403, `POST /api/export` 405, `POST /api/ingest/openalex` 403.
- `/data/search/documents.json` 404.
- Fixture rows were deleted after each scan; final `OwnedInventory` count returned to the seed state after the marker cleanup below.

### The M7 outcome spec (`tests-node/m7-outcomes.spec.ts`, 17 tests) against a production build

| Run | Server | Result |
| --- | --- | --- |
| D (control) | `next dev` started by the Playwright config, CI environment, same database | **PASS 17 of 17** (55 s). Port 3000; it was free when the run started, but see the note on port 3000 above |
| P1 | `next start`, CI environment unchanged (`OPERATOR_APP_ORIGIN=http://localhost:...`) | **FAIL**: 3 pass, 5 fail, 9 not run (1a, 3 desktop, 4a, 4c, 6 desktop). Same result on port 3000 (run A) and 3187 |
| P2 | `next start`, `OPERATOR_APP_ORIGIN=https://localhost:3187` | 15 pass, 2 fail (4c, 6 desktop) |
| P2b | same server settings, all tests except 4c | **PASS 16 of 16** (14 s) |

Why P1 fails, with evidence:

1. `lib/operator-auth/config.ts:53` rejects a non-https origin when `NODE_ENV=production`. With the CI value the operator config is invalid,
   `/admin` renders "Authentication unavailable" instead of redirecting to sign-in, and server actions answer `UNAVAILABLE`
   ("Operator authentication required") instead of `UNAUTHENTICATED`. This is fail-closed (no record was exposed), and is why 1a and the
   `/admin` step of test 3 fail. It is a test-setup issue: production needs an https `OPERATOR_APP_ORIGIN`, as a real deployment has.
2. Test 4c waits for `window.__networkCy`, which `app/network/NetworkGraphClient.tsx:560-562` only sets when `NODE_ENV !== "production"`.
   It cannot pass on a production build whatever the app does. In production the graph element was visible but the hook is `undefined`
   (checked with a script after 15 s). **4c is UNRUN in production mode**; it passed in dev mode (run D).
3. Tests 4a and 6 desktop (language switch) failed in P1, in P2 (6 only) and in an isolated 8-run repeat, yet passed in every later isolated run
   (4a 4 of 4 on fresh and warm servers, 6 desktop 1 of 1) and in P2b. A direct script that clicks TH immediately, after 1.5 s and after
   4 s switched the language every time. **I did not establish the cause.** The machine was under heavy load from other agents (load
   average up to 26) and my production server was found terminated after several runs by something I did not identify. Treat the
   language switch in a production build as passing in the final clean run, with an unexplained intermittent failure on record.

### Everything else

| Check | Result |
| --- | --- |
| Discovery, controls, map cold read, keyboard (phone and desktop) in production | PASS in P2b (tests 3, 3 phone, 4a, 4b, 5, 6 desktop, 6 phone); 4c as above |
| Direct denial (1a to 1e) in production | PASS in P2b, with the https origin |
| Cross-view privacy (2a to 2d) in production | PASS in P2b |

## Not run

- `pnpm exec playwright test tests-node/a11y.spec.ts` (axe at 390 and 1440 px), `tests-node/smoke.spec.ts`, `network.spec.ts` and the other specs of the
  `e2e` job: not executed here. The CI result for main is the only evidence.
- `scripts/m7-baseline-check.sh` (the full runner) and pytest for the legacy FastAPI package.
- `playwright.auth.config.ts` and `playwright.inspection.config.ts` suites; a real signed-in operator session in a browser.
- Node 22 (the CI version), Firefox/WebKit, a physical phone, screen reader behavior.
- A Vercel preview or production deployment, the production database, `prisma migrate status` against it.
- Semantic search (lane V), the UI branch (lane U), and any embedding service. This page covers lane B only.
- The runbook `docs/DEMO_COMPLETION_RUNBOOK_2026-11-08.md` named in the handoff is not on `origin/main`, in any local worktree or in
  `git log --all`, so the demo script and ladder in it were **not read**.

## Public policy

Not authored here. Owner per `docs/m7-baseline-check.md`: Suk-Nsr. Nothing in this run changes it. The behavior verified above
(pending and private records absent, masked inventory fields absent, export operator-only) is what the policy would describe.

## Demo script

Not authored here. Owner: Pongchayanneung, in the missing runbook (see "Not run"). Not verified.

## Repaired, contained, deferred

| Behavior | Label | Evidence |
| --- | --- | --- |
| Dashboard aggregates counting withheld pending records | **Repaired** (the earlier note in `docs/m7-baseline-check.md` calling it deferred is stale) | PR #68 merged 2026-11-07T18:35Z; `test/dashboard-public-filter.test.ts` passes in the suite; `/dashboard` raw HTML and RSC scan shows 0 pending markers. A browser check of the totals was not made |
| Raw `/inventory` payload carries un-sanitised rows | **Repaired for production** (it was "contained" as a dev-only effect) | Production raw HTML and RSC: 0 hits for the public unit's owner, serial, custodian, location, notes, and 0 for the private unit |
| Phone nav shows five destinations | **Contained by design** (unchanged) | `test/m8c-nav.test.ts`, test 3 phone passes |
| Export route | **Contained**: operator-only, anonymous and forged 403 | curl above. The integration test that still expects 403 for a valid operator is stale and should be updated by its owner |
| Operator auth needs an https origin in production | **Contained**: fails closed with "Authentication unavailable" | Needs a deployment setting check before the demo (Vercel `OPERATOR_APP_ORIGIN`); not verified |
| M7 spec depends on dev-only hook for 4c | **Deferred** | Needs a production-safe hook or a dev-only run of 4c to be recorded as a separate line |
| Language switch intermittent failure in production runs | **Deferred, cause unknown** | See P1 item 3 |
| Stale `test-integration/operator-auth.test.ts` handler test | **Deferred** | Not in CI; fails on `739d583` |
| Restart preservation across a real redeploy, signed-in operator journey | **Deferred / unrun** | See "Not run" |

## Repository access (read-only, no change made)

`gh api repos/Pongchayanneung/HumanoidTH/collaborators` on 2026-11-08. The repository is **public**; owner is a user account.

| Login | Role | admin | maintain | push | triage | pull |
| --- | --- | --- | --- | --- | --- | --- |
| Pongchayanneung | admin | yes | yes | yes | yes | yes |
| NoneTP | write | no | no | yes | yes | yes |
| Suk-Nsr | write | no | no | yes | yes | yes |
| **Nathaphat-Euatudtan** | **write** | no | no | **yes** | yes | yes |
| **18409-boop** | **write** | no | no | **yes** | yes | yes |

- NoneTP and Suk-Nsr are the named owners in issue #12 and have commits in the history.
- `Nathaphat-Euatudtan` (account created 2026-09-28, profile name "Arkenuzz", 0 public repos) and `18409-boop` (account created
  2026-10-21, 1 public repo, no profile name) each have **write** access, **0 commits and 0 pull requests** in this repository (checked with
  `commits?author=` and `gh pr list --author`). Nothing in the repository or in the handoff explains why they have write access.
- `main` has **no branch protection** (`branches/main/protection` returns 404). Anyone with write access can push to `main` directly, so
  the rule "never merge into main without the user's yes" is enforced by convention only.
- `repos/.../invitations` returned no pending invitations.
- **Admin action needed (Pongchayanneung):** confirm whether these two accounts are team members. If not, remove or downgrade them
  (Settings, Collaborators). Also consider branch protection on `main`. I changed nothing.

## Reproduce this page's numbers

```sh
ATLAS_ALLOW_SEED=1 ./node_modules/.bin/tsx scripts/m7-crud-restart.ts crud            # 7 PASS lines
ATLAS_ALLOW_SEED=1 ./node_modules/.bin/tsx scripts/m7-crud-restart.ts persist-write   # server up
# stop the server, start it again, then:
ATLAS_ALLOW_SEED=1 ./node_modules/.bin/tsx scripts/m7-crud-restart.ts persist-verify  # 3 PASS lines
ATLAS_ALLOW_SEED=1 ./node_modules/.bin/tsx scripts/m7-crud-restart.ts persist-clean
# production-mode spec: use an https OPERATOR_APP_ORIGIN, skip 4c
PLAYWRIGHT_EXTERNAL_SERVER=1 ./node_modules/.bin/playwright test tests-node/m7-outcomes.spec.ts -g '^(?!.*4c controls)'
```

The script refuses unless `ATLAS_ALLOW_SEED=1` and `DATABASE_URL` is a local database (the seed guard), and every row it writes carries the
`M7LANEB` marker.
