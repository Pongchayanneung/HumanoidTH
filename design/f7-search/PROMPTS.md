# F7 `/search` art-director script for ChatGPT

For `art-director-liaison`. Paste the messages in order into one ChatGPT conversation. Save each returned
image to `design/f7-search/artbook/` as `A-desktop.png`, `A-mobile.png`, `B-…`, `C-…` (or `A-sheet.png`
if ChatGPT returns one combined canvas), and save the text answers as `artbook/chatgpt-notes.md`.

Rules for the liaison:
- Attach `overviewpageuiref.png` to Message 1. Attach nothing else from the repo: no `.env*`, no database rows, no seed file.
- Image models garble Thai glyphs. The frames are for **mood, layout and hierarchy only**. The real strings live in `brief.md` §5 and §7, and the wireframe will use them. Do not ask ChatGPT to "fix the Thai" more than once.
- Every frame must carry the stamp `ตัวอย่าง / EXAMPLE`. Reject any frame that shows a percentage match, score, rank number, "best match", or a purple/neon AI look.
- Paid image generation goes through the owner's own ChatGPT account. No API call is made from this script.

---

## Message 1: context

```
You are my art director for one page of a bilingual Thai/English web app. I will ask for three
distinct visual directions, then one image per direction. Read this context first and reply only
"Ready" plus three questions you need answered, if any.

PRODUCT
Thailand Humanoid Atlas: a public research console that indexes Thailand's robotics ecosystem
(papers, code repositories, videos, news, robot models, contributions, public perspectives, public
inventory, organizations). Attached is the current Overview page. Keep its identity: dark forest-green
sidebar (#0b1a15), terra-forest green accent (#4a7c59, strong #365b41), warm cream ground (#faf6f0),
gold highlight (the EN pill), and the green humanoid robot as the brand mark.
Type: IBM Plex Sans for Latin headings, IBM Plex Sans Thai for all Thai. Do not use Inter, Arial or Roboto.
Thai text is never uppercase-styled and never letter-spaced.

THE PAGE: /search
User: a Thai or international researcher, student or hackathon judge who wants "everything the atlas
knows about X", e.g. "หุ่นยนต์ดูแลผู้สูงอายุ" or "social robot elderly care", and needs evidence they can
open, not an AI summary.
Loop: type a Thai, English or mixed query -> Enter or Search button -> grouped, labelled results ->
expand the original stored text -> open the source in a new tab -> come back with query and filters kept.

Page order: title "Search the atlas / ค้นหาในแอตลาส" + one-line description -> search field with a
Search button -> a read-only STATUS LINE (search mode, index coverage, index build time) -> type
filter chips (All, Papers, Repositories, Videos, News & web, Robots, Contributions, Perspectives,
Inventory, Organizations, Relationships) -> result cards.

Result card = one GROUP. Header: kind badge and title only. Body: one or more evidence rows; EACH row
carries its own original-language tag (TH or EN), a text-limit label (Abstract excerpt / Repository
description / Video description / Catalog summary / Truncated text / Title/metadata only) and the
stored text quoted verbatim, because members of one group can differ in kind and language. A group may stack a paper, a public perspective about it (shown with
theme and stance tags, visually different from the quoted source text) and a stored relationship.
Actions: "Show original" expander, "Go to source" link (opens in new tab).

HONESTY RULES (non-negotiable)
- Never show a relevance score, percentage match, rank number, "best match" or "top result".
- The search mode is reported by the server, never chosen by the user. Modes: "Meaning + keyword
  search" (normal), "Keyword matches only" (fallback), "Unavailable".
- Fallback and partial coverage must be impossible to miss but must not look like an alarm.
- Never show simulated data as real. Every frame carries a small stamp "ตัวอย่าง / EXAMPLE", and all
  result titles are plainly example text.
- Text shown in a card is stored text, never a generated summary.

BAN LIST
Purple or blue-violet gradients, glowing brains, circuit-board patterns, AI sparkle icons, neon sci-fi,
fake dashboards full of invented numbers, lorem ipsum, uppercase Thai, emoji as icons, identical
rounded shadowed boxes for everything.

MOOD
Field-research console. Trustworthy evidence. Thai-first warmth. Calm, not sci-fi.
```

## Message 2: three directions with critique

```
Propose three DISTINCT visual directions for /search. Do not make three colour variants of one layout;
they must differ in how they make evidence feel trustworthy.

For each direction give:
1. A name (2-3 words) and a one-sentence thesis.
2. Layout at 1440px desktop and at 390px mobile (where status line, chips and cards sit).
3. How the result GROUP card looks, including how a perspective annotation differs from a quoted excerpt.
4. How "Keyword matches only" and partial coverage ("{indexed} of {eligible} records indexed") are shown.
5. Where the robot mascot appears on /search, if at all.
6. Its biggest risk, in one sentence.

Then critique all three against these questions and recommend one, with a reason:
Q1. How should "evidence you can trust" look in a search card without looking like a legal document?
Q2. Should the robot appear on /search (small, as an empty-state companion), or be kept for Overview only?
Q3. How should the TH/EN tag and kind badges read at 390px without clutter?
Q4. Is there a non-alarming visual language for "keyword mode / partial coverage" that is still unmissable?

Starting points if useful (you may replace them):
A "Field notebook": cream paper ground, evidence rows set like specimen labels with a thin green
   rule; status line as a quiet strip under the search field.
B "Console panel": keep the Overview's dark glass panels for the search+status block, cream results
   below; status as small instrument readouts.
C "Index cards": each group is a library catalogue card with a typed field column on the left
   (kind, language, text limit) and the quoted text on the right; filters as tabbed dividers.
```

## Message 3, 4, 5: one image per direction

Send each separately and replace `<DIRECTION NAME + THESIS>` with ChatGPT's own wording from Message 2.
If ChatGPT cannot fit both frames legibly on one canvas, ask for the desktop and mobile frames as two images.

### Message 3: Direction A

```
Generate one image for Direction A: <DIRECTION NAME + THESIS>.
Canvas 2400x1400, light neutral background, two UI frames side by side, flat screen mockups, no device
bezels, no perspective tilt:
- LEFT: desktop browser frame 1440 wide, English UI.
- RIGHT: mobile frame 390 wide, Thai UI.
Small stamp "ตัวอย่าง / EXAMPLE" in the top-right corner of each frame.

DESKTOP (English UI, state = normal results with partial coverage):
Dark green sidebar on the left; first item "Search" is active with a gold left edge; below it Overview,
Dashboard, Robots, Contributors, Network. EN/TH pill at the bottom with EN active.
Main area: heading "Search the atlas", line "Find related public papers, repositories, videos, robots
and records in Thai or English." Search field containing "social robot elderly care" with a "Search"
button. Status line: "Meaning + keyword search · 6,512 of 6,714 records indexed (example) · Index built
6 Nov 2026, 14:20". Amber chip on the coverage part. Filter chips: All (selected), Papers, Repositories,
Videos, News & web, Robots, Contributions, Perspectives.
Three result group cards:
1. Badge "PAPER", title "Example paper title about social robots in elder care"; evidence row with
   tag "EN", label "Abstract excerpt" and two lines of example text; nested second row with
   badge "PERSPECTIVE", tags "Theme: care work" and "Stance: neutral", one quoted line; buttons
   "Show original" and "Go to source ↗".
2. Badge "ROBOT", Thai title "ตัวอย่างชื่อรุ่นหุ่นยนต์บริการ"; evidence row with tag "TH", label
   "Catalog summary" and one line of Thai example text.
3. Badge "PAPER", title "Example paper listed by title only"; row with tag "EN" and label
   "Title/metadata only", no excerpt, small grey note "Only the title and metadata are stored."
No scores, no percentages on cards, no rank numbers.

MOBILE (Thai UI, state = keyword fallback):
Top header with the atlas logo and a TH/EN switch. Heading "ค้นหาในแอตลาส". Search field containing
"หุ่นยนต์ดูแลผู้สูงอายุ" with a "ค้นหา" button. Amber banner: "ระบบค้นหาเชิงความหมายไม่พร้อม
แสดงผลแบบคำค้นตรงตัว" with a second line "คำค้นภาษาไทยอาจไม่พบข้อมูลภาษาอังกฤษ และกลับกัน". Horizontally scrolling chips: ทั้งหมด, งานวิจัย, คลังโค้ด, วิดีโอ, หุ่นยนต์.
Two stacked cards with badge + TH/EN tag on one line, title, two lines of quoted text, and full-width
"แสดงต้นฉบับ" and "เปิดแหล่งที่มา ↗" controls. Bottom tab bar of 5 icons with "ค้นหา" active.
Thai text must not be uppercase or letter-spaced.

Apply the direction's palette and type within: forest green #4a7c59, deep green #0b1a15, cream #faf6f0,
gold highlight, amber #705c30 for warnings, IBM Plex Sans / IBM Plex Sans Thai look.
Avoid: purple, neon, glowing brains, circuit patterns, AI sparkles, emoji, invented charts.
```

### Message 4: Direction B

Same as Message 3 with these changes:
- First line: `Generate one image for Direction B: <DIRECTION NAME + THESIS>.`
- Desktop state: **keyword fallback**. Replace the status line with an amber banner
  "Meaning-based search is offline; showing keyword matches. Thai queries may miss English records,
  and the reverse." and the status
  "Keyword matches only · Index built 6 Nov 2026, 14:20".
- Mobile state: **empty result**. Search field "หุ่นยนต์ดำน้ำลึก", a cream panel
  "ไม่พบข้อมูลสาธารณะที่ตรงกัน" with a link "ลองค้นคำอื่น หรือดูทุกประเภท", and no result cards. If the
  direction puts the robot on /search, a small robot sits beside this panel.

### Message 5: Direction C

Same as Message 3 with these changes:
- First line: `Generate one image for Direction C: <DIRECTION NAME + THESIS>.`
- Desktop state: **loading after a new query** (stale guard). Search field "humanoid robot Thailand
  university", status "Searching…", three skeleton cards; the previous query's results are already
  removed, not dimmed.
- Mobile state: **failure**. Red-bordered panel "ขณะนี้ไม่สามารถค้นหาได้" with a button "ลองอีกครั้ง".
  No old results under it.

## Message 6: closing question

```
Looking at the three images together:
1. Which direction best answers Q1-Q4, and what would you take from the other two?
2. List every place an image shows a score, percentage, rank or invented figure that is not labelled
   as an example, so I can drop it.
3. Name one detail at 390px that will break with real Thai text (longer words, stacked vowels and
   tone marks, no spaces between words).
```

---

Frame-to-state map for `artbook/README.md` later:

| Frame | Desktop state | Mobile state |
|---|---|---|
| A | results (hybrid) + partial coverage, grouped card with perspective | keyword fallback |
| B | keyword fallback | empty (+ robot question) |
| C | loading / stale guard | failure / unavailable |

Browse (blank query) is not in any frame; the wireframe covers it.
