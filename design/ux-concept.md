# HumanoidTH UX/UI concept (draft v0)

Drafted 2026-11-06 from the open issues, `overviewpageuiref.png`, `app/globals.css`,
`app/components/*Nav*.tsx` and `docs/Hackathon-preparation/feature-technical-design.md`.
This draft is the input to the design studio. Its art-book frames and wireframes will
replace the ASCII sketches below.

## 1. Which issues have UX/UI work?

| Issue | UX weight | What the UX must deliver | Limit |
|---|---|---|---|
| **#19 F7** bilingual `/search` | **High**: a new page | Full concept → art book → wireframe → build | Feature phase, after F1 contracts |
| **#11 M8-C** mobile/keyboard/language nav | **Medium** | Fix the *existing* journey: reachability, focus, language switch, loading/error | "No general redesign", 30 min |
| **#6 M4** honest map | **Low** | One honest "map unavailable" state | 35 min, mostly backend |
| #10 M8-B (Suk-Nsr) | Low | Empty ≠ failure feedback in contribution filters | Share the state pattern in §4 |
| #21 F9 | Verify only | Mobile/keyboard/TH-EN checks on the hosted build | — |
| #3 M1, #12 M7, #14 F2, #24 S4, #25 R1 | None | — | — |

The design studio runs at full depth only for **F7**. M8-C and M4 reuse the shared state
system (§4) and must not restyle pages.

## 2. Product feel (from the existing reference)

- **Brand:** "Terra forest" research console, with dark forest-green panels (`--accent #4a7c59`,
  `--accent-strong #365b41`), warm cream ground (`--background #faf6f0`), gold highlight
  (the EN pill and "CORPUS SUMMARY"), and a green humanoid robot hero with golden orbit light.
- **Type:** Inter + IBM Plex Sans Thai. Headings are heavy uppercase Latin. Thai must never be
  uppercase-styled or letter-spaced.
- **Keep:** the green/cream/gold palette, glassy dark stat cards, and the robot as the identity mark.
- **Fix (honesty):** the reference shows "Displaying high-fidelity simulated research data".
  Under M3/M4/M5 the UI must never present simulated data as real. Unavailable means unavailable.
- **Mood words:** field-research console · trustworthy evidence · Thai-first warmth · calm, not sci-fi neon.
- **Ban list (avoid AI-generic look):** purple gradients, glowing circuit brains, stock "AI" sparkles,
  fake dashboards full of invented numbers, lorem ipsum, uppercase Thai.

## 3. F7 `/search`: concept

**User:** a Thai or international researcher, student or hackathon judge who wants "everything the
atlas knows about X" (e.g. `หุ่นยนต์ดูแลผู้สูงอายุ`, `social robot elderly care`) and needs
evidence they can open.

**Core loop:** type (TH/EN/mixed) → see grouped, labelled results → expand the original text →
open the source → come back with the query and filters intact (URL state).

```
Desktop (≥1024)                                   Mobile (390)
┌──────────┬──────────────────────────────────┐   ┌──────────────────────┐
│ Sidebar  │ [ ค้นหาในแอตลาส / Search atlas  ⏎]│   │ ☰  Atlas      [EN|TH]│
│ + Search │ Mode: ● Semantic  ○ Keyword only  │   │ [ ค้นหา…          ⏎]│
│  (new)   │ Coverage: 6,512 / 6,714 indexed   │   │ chips: All Paper Repo│
│          │ Index built 2026-11-06 14:20      │   │  Video Robot Org →   │
│          │ ┌Filters┐ All · Papers · Repos ·  │   │ Semantic · 97% index │
│          │ │       │ Videos · Robots · Orgs  │   ├──────────────────────┤
│          │ ├───────┴─────────────────────────┤   │ ▣ PAPER · EN         │
│          │ ▣ PAPER · EN · title/metadata only│   │ Title…               │
│          │   Title of the paper              │   │ "matched excerpt…"   │
│          │   "…matched stored excerpt…"      │   │ [Show original ▾]    │
│          │   [Show original ▾] [Source ↗]    │   │ [Source ↗]           │
│          │ ▣ ROBOT · TH  …                   │   ├──────────────────────┤
└──────────┴──────────────────────────────────┘   │ bottom tab: +Search  │
                                                   └──────────────────────┘
```

**Card anatomy:** kind badge (Paper/Repo/Video/Robot/Organization/News) · original-language tag
(TH/EN) · text-limit label (`full abstract` / `excerpt` / `title/metadata only`) · title ·
stored excerpt (never a generated summary) · "Show original" expander · safe source link
(http/https only, `rel="noopener noreferrer"`). Scores, vectors and tokens never reach the browser.

**Navigation:** add "Search / ค้นหา" as the first item in `SidebarNav` and replace one
`MobileTabNav` tab (proposal: Network → Search, so the bar keeps 5 items). Press `/` to focus search
on desktop.

## 4. Shared honest-state system (F7, M8-C, M4, M8-B)

| State | Visual | Copy (EN / TH) | Rule |
|---|---|---|---|
| Loading | skeleton cards, `aria-busy` | Searching… / กำลังค้นหา… | Superseded requests are cancelled |
| Empty | neutral cream panel | No matching public records. / ไม่พบข้อมูลสาธารณะที่ตรงกัน | Different component from failure |
| Failure | red-bordered panel + retry | Search is unavailable right now. / ขณะนี้ไม่สามารถค้นหาได้ | Never shows stale results as current |
| Keyword mode | amber banner | Meaning-based search is offline; showing keyword matches. / ระบบค้นหาเชิงความหมายไม่พร้อม แสดงผลแบบคำค้นตรงตัว | Honest fallback (F6) |
| Partial coverage | amber chip | 6,512 of 6,714 records indexed / จัดทำดัชนีแล้ว 6,512 จาก 6,714 รายการ | Always visible in semantic mode |
| Unavailable (map, M4) | full panel, no fake data | Map analysis is unavailable in this release. / การวิเคราะห์แผนที่ยังไม่เปิดใช้ในรุ่นนี้ | No model call or cache write |

## 5. M8-C: the minimal journey fix (no redesign)

Journey: Overview → Contributions or Robots → record → source → back to results.
- Every step is reachable from `SidebarNav` (desktop) and `MobileTabNav` / `MobileHeader` (390px).
  Today "Contributions" is missing from the mobile tab bar. Add it, or reach it from the header menu.
- The language selector is visible on mobile (currently only in the sidebar).
- `:focus-visible` rings (gold outline 2px) on nav, chips, cards and links. Every icon-only button gets an `aria-label`.
- Back-to-results preserves query and filters (URL state).

## 6. Questions for the art director (ChatGPT)

1. How should "evidence you can trust" look in a search card without looking like a legal document?
2. Should the robot appear on `/search` (small, as an empty-state companion), or be kept for Overview only?
3. How should the TH/EN tag and kind badges read at 390px without clutter?
4. Is there a non-alarming visual language for "keyword mode / partial coverage" that is still unmissable?
