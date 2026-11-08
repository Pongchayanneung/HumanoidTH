# UI/UX improvement: from an operator console to a search-first atlas

HRI Hackathon Thailand 2026, submission item 6. Written 8 November 2026 (Asia/Bangkok) about draft PR [#79](https://github.com/Pongchayanneung/HumanoidTH/pull/79), branch `ui/atlas-revamp`.

**Links asked for in item 6**

- **CI (continuous integration), green run on the UI branch:** [workflow run 42434199260, commit `5105feb`](https://github.com/Pongchayanneung/HumanoidTH/actions/runs/42434199260), conclusion success. The same checks (`checks`, `e2e`, `no-mock-data`) are green on `main` after search merged: [run 42434033111, commit `50c1ea4`](https://github.com/Pongchayanneung/HumanoidTH/actions/runs/42434033111).
- **CI (corporate identity) and mood board:** [mood-board.md](design/mood-board.md): palette, typography, logo, references, before and after.

Status you should know first: PR #79 is a **draft and not merged into `main`** at the time of writing. Until the team merges it, the revamp lives on the `ui/atlas-revamp` branch. Describe it as "implemented on the branch, verified by CI, awaiting merge" unless that changes.

## The problem we found

A UI and UX study of the baseline (7 November 2026, `design-plans/2026-11-07-hri-atlas-ui-ux-audit.md`, fork commit `8a69d64`, desktop 1440x900 and phone 390x844, local data) gave three findings:

1. **Overview put the operator's workflow ahead of the reader's.** On desktop the filled primary action was "Run data pull", and four actions wrapped to a second row. At 860 px and below the Overview hid all its actions and the bottom bar had no Database entry, so a phone visitor had no direct way to start searching.
2. **Browsing records and checking evidence were split across two weak surfaces.** Registry cards had no search or filters and showed literal values such as `observed_in_thailand`. The Database page exposed storage field names in a raw wide table.
3. **Database promised more than it did.** Its search box implied broad field coverage but searched titles only; the same "No records found" message appeared after a query error; an Export button appeared although the endpoint returned HTTP 403.

The audit's recommendation: give public discovery one visible entry on desktop and phone first, before any reskin.

## What changed (PR #79: 41 files, +978 / -2,694)

- **One drawer navigation for every screen size** (`AtlasNavigation`) replaces the sidebar, mobile header and mobile tab bar. Same destinations on phone and desktop; language switch EN / TH in the header.
- **Search-first home.** The home page is now "Atlas Search": one labelled field and button, an example record with its supporting source, and plain links to Robots, Research contributions and Sources.
- **Results that show their evidence.** Each result shows record type, title, language tag, the matched words highlighted, a "Show original" toggle, "View robot record" and "Go to source" links, and the note "Related information, not a verified answer."
- **Honest fallback label.** When meaning-based search is unavailable the page says so in English and Thai ("Meaning-based search is offline; showing keyword matches..."), instead of showing an empty or misleading result.
- **New `/sources` and rebuilt `/robots`**, a "View robot record" link from search cards, and simpler error and not-found pages.
- **Removed:** the 3D robot stage, spinning rings and glow on the home page, and the timer-driven splash loader (no longer mounted; its component file remains unused).

Screenshots: [before and after in the mood board](design/mood-board.md#before-and-after).

## How we checked it

| Check | Result | Where it ran |
|---|---|---|
| GitHub Actions on `5105feb`: typecheck, unit tests, no-mock-data scan, Playwright (smoke, network, M7 outcomes) and the blocking axe scan | Success | [run 42434199260](https://github.com/Pongchayanneung/HumanoidTH/actions/runs/42434199260) |
| Typecheck after merging current `main` | Clean | Local, 8 Nov |
| Unit tests after that merge, with a throwaway PostgreSQL | 381 run, 367 pass, 0 fail, 14 skipped | Local, 8 Nov |
| Playwright e2e (smoke, network, M7 outcomes), journey and search UI specs | 23/23, 4/4 and 8/8 passed | Independent checkout at `8321911` (PR description) |
| axe accessibility scan, 7 routes at 390 and 1440 px | 14/14 passed | Same, `8321911` |
| Keyboard use in a real browser at both widths | Skip link, drawer opens from the keyboard, focus stays inside the drawer, Escape returns focus, no horizontal overflow, no console errors | Same, `8321911` |

## Limits we are stating plainly

- **Keyboard tests were reduced in this revamp.** The PR description discloses that the rewritten M7 tests no longer assert that each focused control is on screen and not covered by another element, no longer check the tab order of the language buttons, and no longer include the phone Shift+Tab walk-back or Space-key activation of the EN button. The privacy and denial suites were kept and strengthened. The keyboard journey now covers all seven destinations through the drawer on both widths. Restoring the dropped assertions is open work.
- **Not run:** a production build (`next build`) of this branch by the checker, a Vercel preview of it, real-device testing, a Thai screen reader, and the admin inspection and operator-auth specs (they use a separate config outside CI).
- **axe coverage:** CI scans 7 routes; `/sources` and `/admin-login` are not scanned.
- **Meaning-based search was off** in the checks and captures above, so the hybrid label was not exercised there.
- **Screenshots** come from local development builds with seeded or synthetic data. The "after" images are from the UI agent's working folder without a recorded commit; re-capture them from the deployed preview for the final record.
- **No user study.** The audit worked from the repository's stated audience (researchers and students); nobody has timed or interviewed real users. The proposed measure is time to first relevant source, task completion, repeated searches and reported effort.

## Where this goes next

Merge decision for #79 (owner), re-capture screenshots from the deployed site, restore the dropped keyboard assertions, add `/sources` and `/admin-login` to the axe scan, then run the first task test with five researchers or students. See the plan in the business model and next steps document.
