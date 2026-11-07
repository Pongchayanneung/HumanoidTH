# M7 baseline check: matrix and runner

Issue #12 ([M7], accountable: Pongchayanneung). This page maps the six committed baseline outcomes to the
checks that prove them and to the owner who owes the evidence. `scripts/m7-baseline-check.sh` runs every
check that can be run from a command today and prints one line each.

Status of this page: **preparation** (the 20-minute command-preparation allowance). It is not a release
verdict. An issue checkbox, existing code or a green line for an unrelated check is not evidence for an
outcome; only the command output on a recorded revision is.

## How to run

```sh
# 1. A disposable local Postgres (see "Disposable database" below), then a FRESH database for this run.
psql -h localhost -p 55432 -U postgres -c 'create database atlas_m7'

# 2. Run. DATABASE_URL must be passed in; nothing is read from a .env file.
DATABASE_URL=postgresql://postgres@localhost:55432/atlas_m7 scripts/m7-baseline-check.sh

# Optional: also run the frozen-lockfile install (mutates node_modules, needs network)
DATABASE_URL=... scripts/m7-baseline-check.sh --with-install

# Optional: serve on port 3000 so the existing Playwright specs can run (they hardcode localhost:3000)
DATABASE_URL=... M7_PORT=3000 scripts/m7-baseline-check.sh
```

Rules the script enforces:

- **Refuses (exit 2) before any check** if `DATABASE_URL` is unset, is not a postgres URL, carries a
  `host=` or `hostaddr=` query override, or its parsed host is anything other than `localhost` or
  `127.0.0.1`. The password is never printed.
- Uses explicit commands only: `./node_modules/.bin/<tool>` or `node ./node_modules/...`. It never calls
  `scripts/dev.ts`, `prisma db seed` (which runs `tsx.CMD`, Windows only on `main`), `pnpm exec` or
  `pnpm run`.
- Strips `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`,
  `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ADMIN_BASIC_USER` and `ADMIN_BASIC_PASSWORD` from every child
  process, so no check can make a paid or provider call. Cold map reads on `main` can reach Gemini (M4), so
  this matters.
- Child processes run noninteractive (`CI=1`, stdin from `/dev/null`) under a hard timeout (default 900 s,
  `M7_TIMEOUT`). A prompt or a hang is a FAIL, which is what the plan's "noninteractive lint gate" means.
- Never installs anything (no `pnpm install` unless `--with-install`, no Playwright browsers, no pip).
- Records revision, branch, dirty-tree paths, OS, node, pnpm, database host/port/name, lockfile hash,
  test and spec file lists, then writes per-check logs to `M7_LOG_DIR` (default a `mktemp` folder).

Result words:

| Word | Meaning |
| --- | --- |
| PASS | The command ran and exited 0. |
| FAIL | The command ran and failed, hung, or timed out. A failed required check keeps its issue open. |
| UNRUN | A prerequisite is missing, or no check exists on `main` yet. **Not a pass.** |

Exit codes: `0` all PASS, `1` any FAIL, `2` refused or bad usage, `3` nothing FAILed but something is UNRUN.
For the final gate only `0` counts.

Environment knobs: `M7_LOG_DIR`, `M7_PORT` (default 3107), `M7_TIMEOUT`, `M7_TAIL` (log lines echoed under
a FAIL), `M7_HANDOFF_FILE` (default `docs/baseline-handoff.md`).

### Disposable database

macOS with Homebrew `postgresql@16`: `initdb` into a scratch data directory, `pg_ctl -o '-p 55432' start`,
trust auth, user `postgres`. Or `docker run --rm -d -p 55432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16`.
Use a new database name per run (the script runs `prisma migrate deploy` and the seed against it).

## Check catalogue

| Check id | Command (run from the repo root) | Needs |
| --- | --- | --- |
| `node-engine` | compare `node -p process.versions.node` with `engines.node >=20.11` | node |
| `install-frozen` | `pnpm install --frozen-lockfile` (opt-in via `--with-install`) | pnpm, network |
| `prisma-generate` | `./node_modules/.bin/prisma generate` | node_modules, `DATABASE_URL` (prisma.config.ts reads it) |
| `typecheck` | `node ./node_modules/typescript/bin/tsc --noEmit` | node_modules |
| `lint` | `./node_modules/.bin/next lint` (stdin closed, `CI=1`) | node_modules |
| `unit-tests` | `./node_modules/.bin/tsx --test test/*.test.ts` | node_modules |
| `no-mock-scan` | `./node_modules/.bin/tsx scripts/assert-no-mock-data.ts` | node_modules |
| `migrate-deploy` | `./node_modules/.bin/prisma migrate deploy` | running local Postgres |
| `seed` | `./node_modules/.bin/tsx prisma/seed.ts` | `migrate-deploy` PASS |
| `prisma-read` | `./node_modules/.bin/tsx scripts/verify-prisma.ts` (connect + one read) | `migrate-deploy` PASS |
| `prisma-crud` | none on `main` (`verify-prisma.ts` is read-only) | always UNRUN until M1 adds one |
| `restart-preservation` | none on `main` (seed twice; curated rows and roles unchanged) | always UNRUN until M1 adds one |
| `build` | `./node_modules/.bin/next build` | `prisma-generate` PASS |
| `start-prod` | `./node_modules/.bin/next start -p $M7_PORT`, poll `GET /` until 200 | `build` PASS, port free |
| `route-probe` | `curl` status of `/`, `/robots`, `/contributions`, `/map`, `/network` (status only, no content assertion) | server up |
| `e2e-playwright` | `PLAYWRIGHT_EXTERNAL_SERVER=1 ./node_modules/.bin/playwright test --trace off` | server on port 3000, browsers installed |
| `pytest` | `python3 -m pytest -q` (legacy FastAPI package) | python3 with pytest |
| `handoff-record` | `docs/baseline-handoff.md` exists and has the headings below | M7 writes it at the final gate |
| `denial-direct`, `privacy-cross-view`, `discovery-journey`, `controls-valid-invalid`, `map-cold-read`, `nav-phone-keyboard` | none on `main` | always UNRUN; each owner's test replaces its placeholder |

`pnpm run` and `pnpm exec` are avoided on purpose: under pnpm 11 they run a dependency status check that
re-triggers `postinstall` and fails for toolchain reasons (pnpm 11 skips the `prisma`, `@prisma/client`,
`sharp` build scripts). A failure from that path would be recorded as a repo failure when it is not.
If a FAIL could come from node 26 or pnpm 11 rather than the repo, re-check with `npx -y pnpm@9` before
recording it as a repo failure.

The `handoff-record` check looks for these headings (case-insensitive substring in a `#` heading):
Tested revision, Environment, Setup commands, Public policy, Demo script, Repaired, Contained, Deferred.
It proves structure only, never that the contents are true.

### Wiring each owner's tests in

The runner executes whatever is in `test/*.test.ts`, so owners do not edit the script to be counted:

- NoneTP (M2, M6, M8-A): direct-denial and exact-selection tests as `test/*.test.ts`, run by `unit-tests`.
- Suk-Nsr (M3, M5, M8-B): privacy-projection, manifest-membership and filter tests as `test/*.test.ts`.
- Pongchayanneung (M1, M4, M8-C): CRUD and restart-preservation tests as `test/*.test.ts`; map cold-read
  test with the Gemini client stubbed; phone/keyboard journey as `tests-node/*.spec.ts`.

When a test lands, replace the matching UNRUN placeholder in the script with a real `check` that names that
test file. A placeholder that stays UNRUN keeps its outcome unproven. A file that merely exists is not
evidence; the check has to run.

## Matrix: the six committed outcomes

Source: the deliverables table in `docs/Hackathon-preparation/Hack-day-planning/technical-fix-implementation-hack-day-plan.md`
(all six must pass for the selected baseline scope to count as complete) and the M7 acceptance checks in issue #12.

| # | Outcome and observable completion | Script checks that prove it | Not provable by script today | Evidence owed by |
| --- | --- | --- | --- | --- |
| 1 | **A runnable application.** Production build starts, migrations and real Prisma CRUD pass in the disposable DB, ordinary startup leaves reviewed data and roles unchanged. (T01, T13, M1) | `node-engine`, `install-frozen`, `prisma-generate`, `typecheck`, `lint`, `unit-tests`, `migrate-deploy`, `seed`, `prisma-read`, `build`, `start-prod`, `route-probe` | `prisma-crud`, `restart-preservation` (no check exists) | **Pongchayanneung** (M1 runtime). Unit-test and lockfile hygiene shared with NoneTP (dependency skew goes through NoneTP). |
| 2 | **A complete public discovery journey.** Visitor opens the atlas, finds a checked contribution or robot, inspects its source, returns to results. Lists and counts use the same checked dataset. (M3, M5, M8-B, M8-C) | `route-probe` (routes answer 200 only), `e2e-playwright` (existing specs; the smoke spec depends on the admin simulator that M2 removes) | `discovery-journey`, manifest-membership agreement between list, count and detail | **Suk-Nsr** (checked data, manifest, membership); **Pongchayanneung** (browser journey, M8-C). |
| 3 | **Usable retained controls.** Valid search/filter inputs accepted, invalid rejected, empty differs from failure; works on phone and keyboard in Thai and English. (M8-A, M8-B, M8-C) | none | `controls-valid-invalid`, `nav-phone-keyboard` | **NoneTP** (M8-A input validation); **Suk-Nsr** (M8-B filters and query feedback); **Pongchayanneung** (M8-C 390px and desktop, TH/EN, keyboard). |
| 4 | **Enforced access and disclosure limits.** Public responses exclude private, pending and internal-note fixtures; every privileged operation checks authorization; unfinished paths deny direct invocation. (M2, M3, M6) | `unit-tests` once owners' tests exist (today only `test/classifiers.test.ts`, which proves nothing here) | `denial-direct`, `privacy-cross-view` | **NoneTP** (M2 identity and action boundaries, M6 exact CMS selection, direct-denial checks); **Suk-Nsr** (M3 projections, privacy, membership, cross-view checks). |
| 5 | **Honest map behavior.** Validated public result or explicit unavailable state; no model work, invented fallback claims or untrusted cache writes on public reads. (M4) | `route-probe` includes `/map` (status only). Keys are scrubbed, so a cold read cannot reach a provider in this run, but that is a property of the script, not a repo result. | `map-cold-read` (stubbed-Gemini cold-read test, denied generation/reanalysis with zero side effects) | **Pongchayanneung** (M4 runtime/browser evidence). Server-side action denial overlaps NoneTP's action boundary (M2). |
| 6 | **A reviewable handoff.** Setup instructions, tested revision, regression and runtime results, demo script, repaired/contained/deferred record. | `handoff-record` (structure only) plus this script's header (revision, dirty paths, environment, versions) | Truth of the contents; the 02:30-06:00 schedule is process, not a command | **All three** supply evidence (NoneTP access/CMS, Suk-Nsr privacy/membership/discovery, Pongchayanneung runtime/browser); **Pongchayanneung** assembles and signs off. |

### M7 acceptance checks in the issue, cross-referenced

| Issue #12 acceptance check | Where it is covered |
| --- | --- |
| Production runtime, disposable DB migrations/CRUD, restart-preservation pass | Outcome 1 rows above. CRUD and restart-preservation are UNRUN until M1 writes them. |
| Checked discovery, valid controls, privacy/access boundaries, honest map pass | Outcomes 2, 3, 4, 5. |
| Direct denial and cross-view privacy checks run; failed and unrun recorded explicitly | `denial-direct`, `privacy-cross-view` placeholders, and the PASS/FAIL/UNRUN summary. |
| Tested commit, environment, setup commands, public policy, demo script, register recorded | Outcome 6 and the script header. Public policy text and the demo script are authored by Suk-Nsr (policy) and Pongchayanneung (script). |
| Schedule preserved: integration 02:30-03:30, release 03:30-05:00, recovery 05:00-05:40, retest 05:40-06:00 | Process only. Rerun this script at the start of release and again for the retest; keep both outputs. |
| Owner evidence split | Last column above. |

## Using the output at the final gate

1. Run on the final, committed revision. The header must show a clean tree (or list exactly which paths are
   dirty and why). A dirty run is a development run, not release evidence.
2. Keep the whole output and the log folder. Link the revision and output from issue #12.
3. For each of the six outcomes, state passed, failed or unrun from the lines above, and label each behavior
   repaired, contained or deferred in `docs/baseline-handoff.md`.
4. Any FAIL or UNRUN in a required outcome keeps #12 open. Containment (a tested restriction) does not close
   a full-repair backlog issue.
5. Do not widen claims: no clinical wellness, full-site completion or laptop-independent operation is claimed.

## Known limits of this runner

- Status-only route probes do not show that content is correct or private.
- `no-mock-scan` is a text-pattern scan. A pass does not establish privacy, authorization or data integrity,
  and each signal still needs a recorded disposition.
- `e2e-playwright` needs the server on port 3000 and installed browsers; otherwise UNRUN. If something else
  holds port 3000 (another worktree), the Playwright check is skipped rather than testing someone else's code.
- Python `pytest` covers the legacy FastAPI package, not the Next.js app.
- The localhost guard checks the URL string. It cannot detect a local tunnel or port-forward to a remote
  database; do not forward remote databases to a local port while using this script.
