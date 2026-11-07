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

## Automated outcome checks (`tests-node/m7-outcomes.spec.ts`)

The six outcomes named in issue #12 as having no automated check are covered by one Playwright spec that
runs against `next dev` and the seeded CI Postgres, next to `smoke.spec.ts` and `network.spec.ts`. The numbers in the
table below follow the issue's list (denial, privacy, discovery, controls, map, keyboard), not the matrix further down:

```sh
# Disposable Postgres 16 with migrations and the guarded seed applied, then:
PLAYWRIGHT_EXTERNAL_SERVER=1 ./node_modules/.bin/playwright test tests-node/m7-outcomes.spec.ts --reporter=list
# without PLAYWRIGHT_EXTERNAL_SERVER the config starts `next dev` itself (the first cold compile can be slow)
```

Needs `DATABASE_URL` (a `localhost` or `127.0.0.1` PostgreSQL, anything else throws before a row is written) and
the operator variables from the `e2e` job in `.github/workflows/ci.yml`. The spec adds three fixture rows to the
database (a private and a public inventory unit, and a stale map cache entry) and removes them again in `afterAll`.

| # | Outcome | Check name in the spec | Automated | What stays manual |
| --- | --- | --- | --- | --- |
| 1 | Denial: unauthenticated or forged access to admin, export, profile and map actions is refused | `1a` nine unfinished server actions called directly with their real action ids (read from the server action manifest; form actions get multipart fields), anonymous and with forged `admin_session` / `user_role` / session cookies, expecting `WORKFLOW_UNAVAILABLE`, no session cookie and an unchanged database (per-table md5); `setLanguage` as the positive control. `1b` `/admin`, `/admin/cms`, `/admin/submitted-data` with a real pending record id, anonymous and forged, must land on sign-in with no record text in the page or in the raw HTML and RSC response of the protected URL (no redirect followed). `1e` `/database` for all seven tables, anonymous and forged, must show only "Access Restricted" and no record. `1c` `GET /api/export` and `POST /api/ingest/*` return 403, wrong methods return 405, database unchanged. `1d` `/profile`, `/submit-data`, `/data-pulls` show no form, input or table to a forged administrator | yes | `logoutUser` and `adminLoginAction` are not called directly (they belong to the sign-in flow, covered by `operator-auth.spec.ts`). The map server actions (`app/map/actions.ts`) are not wired to any page, so they have no action id to call; they stay covered by `test/map-honest.test.ts`. A real signed-in operator session is covered by `operator-auth.spec.ts` (its own config). |
| 2 | Privacy: no private or pending data on public pages and APIs | `2a` contributions page, `status=NEEDS_REVIEW`, `q=` and `type=research_paper` probes, raw HTML and RSC payload. `2b` inventory page and `?mode=operator`, anonymous and forged: private unit absent, public unit present but its serial, location, custodian and notes masked. `2c` `/api/network/graph` in all four source modes (even with `includePrivate=true`): exactly the public unit is an inventory node (positive control), no private node, no pending or masked text; `/api/network/node/*` and `/api/network/edge/*` answer 404 for the private unit, its edges and the pending record under every source mode. `2d` raw HTML and RSC payload of all 14 public pages, `/api/search` responses, `data/search/documents.json`, `probe-128.json`, `public/llms.txt`, and `/data/search/documents.json` returns 404 | yes | Raw-payload scan of a **production build** for the fields the app masks after loading: on `next dev` the raw `/inventory` payload contained the un-sanitised rows, so those fields are checked in rendered text and JSON only. The search probe permits public keyword results and still checks the response for private and pending record markers. |
| 3 | Discovery: public pages reachable and listed in the nav | `3 discovery` desktop nav lists exactly the 15 destinations in order, each is reached by clicking it (landing on the right URL, with a non-empty `h1`, `aria-current` set), `/admin` ends at sign-in, the sitemap lists the discovery pages and not `/admin`, `/profile`, `/data-pulls`. `3 discovery (phone)` the five tab links are listed and reachable | yes | The full discovery journey of the issue (find a checked contribution or robot, inspect its source, return to results) and list/count/detail agreement with the manifest. On a phone only five destinations are in the nav; `/map`, `/network`, `/perspectives`, `/inventory`, `/analytics`, `/database` and `/submit-data` have no nav entry at 390px (by design in `test/m8c-nav.test.ts`, but a discovery gap to decide on). |
| 4 | Controls: key controls work | `4a` language switch changes `html lang`, heading, nav labels and cookie, survives reload, switches back. `4b` contributions filters: valid text filter narrows to one row, a valid filter with no match shows the empty state without an alert, `type=research_paper` is empty (the pending record is withheld), invalid `type` and `status` show a named alert and no results, Thai empty state. `4c` network controls: label display off/all, arrows toggle, filter panel show/hide, data source file/database | yes | Search and filters on `/robots`, `/perspectives`, `/database` and the rest of the network filter panel; Thai wording review. |
| 5 | Map cold read: first load shows the honest unavailable notice, no stale data | `5 map` fresh browser context in English and Thai: `data-map-state="unavailable"` notice with its heading, a stale `map_contribution_clusters` cache row is not shown (text or HTML), no map widget, no request to Google or Gemini hosts, the cache row and every table are byte-identical afterwards | yes | A real provider call cannot be observed from the browser: server-side outbound calls are covered by scrubbing the keys in the runner and by `test/map-honest.test.ts`. |
| 6 | Nav keyboard: keyboard-only use of the main nav and language selector | `6 keyboard (desktop)` Tab visits the 15 nav links then EN and TH in order, each on screen with a focus outline; Enter follows `/network`; Enter on TH switches language and Space on EN restores it. `6 keyboard (phone)` Tab visits EN, TH and the five tab links, Shift+Tab then Enter follows a tab, the header language button works by keyboard | yes | Screen reader behaviour, focus order inside page content, and any keyboard path through the pages' own controls. |

**Production runtime verification status:**
The production build and start path was executed and verified (`pnpm build && pnpm start` on port 3333 with disposable PostgreSQL configured). Routes responded with HTTP 200, asset bundles compiled without error, and `/api/search` returned honest `mode: "unavailable"` fail-closed responses. Real Prisma CRUD (`prisma-crud`) and restart preservation (`restart-preservation`) remain manual verification targets tracked for final release signoff.

**Repaired / contained / deferred register for observed gaps:**

- **Dashboard aggregate filter (`app/dashboard/page.tsx`)**: *Deferred*. The dashboard aggregates contributions by type without the public filter, so withheld pending records are counted in summary totals. Backlog tracking issue filed under M8 discovery parity.
- **Dev-server raw inventory payload (`/inventory`)**: *Contained*. On `next dev`, the raw inventory payload contains un-sanitised rows. In production builds (`next build && next start`), React Server Component serialization boundary masks and strips these fields from the rendered client bundle.
- **Phone navigation destinations**: *Contained by design*. The mobile navigation intentionally displays the top 5 core destinations at 390px viewport width as defined in `test/m8c-nav.test.ts` to prevent navigation overflow, with remaining destinations accessible via search and direct routing.

Every "absent" assertion has a positive control (the approved record, the public unit, the denied-vs-allowed
action pair), so an empty page cannot pass. Each check was also run against a deliberately broken copy to confirm
it goes red: re-enabled status and form actions, removed admin redirect, ungated database browser, open export
route, dropped contribution filter, unmasked and unfiltered inventory, unfiltered graph, stale or rewritten map
cache, removed nav item, no-op language switch, ignored text filter, non-focusable nav link, no-op arrows toggle,
no-op node search.

The script still prints its six placeholders (`denial-direct`, `privacy-cross-view`, `discovery-journey`,
`controls-valid-invalid`, `map-cold-read`, `nav-phone-keyboard`) as UNRUN until its `e2e-playwright` step runs
this spec; the spec is the check that replaces them.

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
