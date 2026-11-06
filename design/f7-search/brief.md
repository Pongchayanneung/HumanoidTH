# F7 `/search` design brief (step 1, draft v1)

Issue #19 F7, blocked from start by #13 F1. This is a design-only brief: no app code, built on frozen fixtures later.
Extends `design/ux-concept.md` §2–§4 (read from the main repo copy `/Users/neung/HumanoidTH/design/ux-concept.md`; the worktree has none).
Where the concept and `docs/Hackathon-preparation/feature-technical-design.md` (TD) disagree, **TD wins** and the change is marked ⟶.

assumed: display type is **IBM Plex Sans** (Latin headings) + **IBM Plex Sans Thai** (all Thai, body). The concept says Inter for headings, which breaks the owner rule "never Inter/Arial/Roboto as display font". Swapping the font in `app/layout.tsx` is site-wide and outside F7; the lead decides whether it ships with F7 or separately.

## 1. User and task
A Thai or international researcher, student or hackathon judge wants "everything the atlas knows about X" (`หุ่นยนต์ดูแลผู้สูงอายุ`, `social robot elderly care`) and needs **evidence they can open**, not a summary.
Core loop: type TH/EN/mixed → Enter or button → grouped, labelled results → expand original text → open source (new tab) → return with query + filters intact from the URL.

## 2. Layout
- Breakpoint is **860px** (`globals.css`), not the concept's 1024. Desktop keeps the dark sidebar; ≤860 uses `MobileHeader` + `MobileTabNav`.
- Order on both widths: H1 + one-line description → search form → **status line** (mode · coverage · index time) → type-filter chips → results / state panel.
- 390px: chips sit in their own `overflow-x:auto` row; the page body never scrolls sideways. The submit button stays visible (no Enter-only on phones).

## 3. Status line (⟶ mode is reported, never chosen)
The concept's "● Semantic ○ Keyword only" radio is dropped. The API returns `hybrid | keyword | unavailable` (TD §6) and stays in keyword mode until the cutoff policy exists (TD §5). Mode is a read-only status, not a control. Never use the word "Semantic" for what the API does.

## 4. Result group card (⟶ groups, not single records)
One group can hold a source, its perspective and its relationship, each with its own evidence (TD §5).
- **Header:** kind badge of the lead record · title (`lang` = original language).
- **Evidence rows (1..n):** each row carries its own kind badge when it differs from the header, original-language tag (TH/EN), text-limit label (e.g. "Abstract excerpt", "Repository description") and stored text as plain text with its own `lang`. Members of one group can differ in kind and language (TD §3 puts limit and coverage on each evidence item). Literal highlight only where the API gives a range. Perspective annotation labels (theme, stance) render as tags, visibly different from the quoted source text.
- **Actions:** "Show original" expander (`aria-expanded`) · source link (http/https only, no embedded credentials, `rel="noopener noreferrer"`, label adds "opens in new tab").
- Kinds (⟶ wider than the concept): Paper, Repository, Video, News/Web, Source (generic fallback), Robot, Contribution, Perspective, Inventory, Relationship, Organization/Entity.
- Text-limit labels (⟶ "full abstract" removed, since the build never fetches full papers): `Abstract excerpt`, `Repository description`, `Video description`, `Catalog summary`, `Truncated text`, `Title/metadata only`.
- Browse results (blank query) carry **no** match wording.

## 5. States (shared honest-state system, concept §4)
| State | Trigger | Visual | EN / TH |
|---|---|---|---|
| Browse | blank query | neutral header, no match claim | Public records, not matched to a query. / ข้อมูลสาธารณะ ยังไม่ได้จับคู่กับคำค้น |
| Loading | request in flight | skeleton cards, `aria-busy` on results | Searching… / กำลังค้นหา… |
| Results, hybrid | `mode=hybrid` | status line, green dot | Meaning + keyword search / ค้นหาตามความหมายและคำค้น |
| Keyword mode | `mode=keyword` | amber banner above results | Meaning-based search is offline; showing keyword matches. Thai queries may miss English records, and the reverse. / ระบบค้นหาเชิงความหมายไม่พร้อม แสดงผลแบบคำค้นตรงตัว คำค้นภาษาไทยอาจไม่พบข้อมูลภาษาอังกฤษ และกลับกัน |
| Partial coverage | coverage < eligible | amber chip, always visible when not full | {indexed} of {eligible} records indexed / จัดทำดัชนีแล้ว {indexed} จาก {eligible} รายการ |
| Empty | 0 groups | cream panel, no padding results | No matching public records. / ไม่พบข้อมูลสาธารณะที่ตรงกัน |
| Failure / unavailable | network error or `mode=unavailable` | red-bordered panel + Retry, `role="alert"`, old results removed | Search is unavailable right now. / ขณะนี้ไม่สามารถค้นหาได้ · Retry / ลองอีกครั้ง |
| Stale guard | new query while old shown | old list removed at once and replaced by skeletons; only the latest response renders; clearing the query fetches fresh browse data | Index built {time} / สร้างดัชนีเมื่อ {time} |

Coverage numbers are templates. 6,714 is the seed source count (TD §1); the concept's 6,512 appears in no source, so any rendered figure is labelled illustrative.

## 6. Navigation
- `SidebarNav`: "Search / ค้นหา" as the first item (above Overview).
- `MobileTabNav`: the concept swaps Network → Search to keep 5 tabs. **Conflict:** #11 M8-C wants Contributions reachable on mobile too, and `MobileHeader` has no language switch. Open decision, see the end.
- `/` focuses search on desktop. Match `event.code === "Slash"`, not `event.key`: on the Thai Kedmanee layout that key types "ฝ" (assumed from layout knowledge, verify on a real Thai keyboard). Ignore it while any input/textarea has focus.

## 7. Copy (new translation keys; `lib/translations.ts` has none yet)
| key | EN | TH |
|---|---|---|
| search | Search | ค้นหา |
| searchTitle | Search the atlas | ค้นหาในแอตลาส |
| searchDesc | Find related public papers, repositories, videos, robots and records in Thai or English. | ค้นหางานวิจัย คลังโค้ด วิดีโอ หุ่นยนต์ และข้อมูลสาธารณะที่เกี่ยวข้อง ได้ทั้งภาษาไทยและอังกฤษ |
| searchPlaceholder | e.g. social robot elderly care | เช่น หุ่นยนต์ดูแลผู้สูงอายุ |
| searchSubmit | Search | ค้นหา |
| filterAll | All | ทั้งหมด |
| showOriginal / hideOriginal | Show original / Hide original | แสดงต้นฉบับ / ซ่อนต้นฉบับ |
| goToSource | Go to source (opens in new tab); not "Open source", which reads as open-source code | เปิดแหล่งที่มา (เปิดในแท็บใหม่) |
| relatedNote | Related information, not a verified answer. | ข้อมูลที่เกี่ยวข้อง ไม่ใช่คำตอบที่ยืนยันแล้ว |
| langTag | Original: English / Original: Thai | ต้นฉบับ: อังกฤษ / ต้นฉบับ: ไทย |
Plus the state strings in §5 and kind/limit labels in §4 (TH: งานวิจัย, คลังโค้ด, วิดีโอ, ข่าวและเว็บ, แหล่งข้อมูล, หุ่นยนต์, ผลงานร่วมพัฒนา, มุมมองสาธารณะ, รายการอุปกรณ์, ความสัมพันธ์, องค์กร/หน่วยงาน; ข้อความบางส่วนจากบทคัดย่อ, คำอธิบายคลังโค้ด, คำอธิบายวิดีโอ, สรุปจากแคตตาล็อก, ข้อความถูกตัด, มีเฉพาะชื่อเรื่อง/ข้อมูลกำกับ). Thai is never uppercased or letter-spaced. Thai copy needs a native-speaker read before build.

## 8. Accessibility and keyboard order
Order: skip link → nav → search input → submit → filter chips (toggle buttons, `aria-pressed`) → status line → each card: title/link → Show original → Go to source → next card.
- Landmarks: `<main>`, `<form role="search">` with a real `<label>`, results in `<section aria-labelledby>`, each group an `<article>`.
- Every title and evidence block gets `lang="th"` or `lang="en"` from the **record**, not from the UI language.
- Status changes announce in one polite live region ("12 groups found" / "พบ 12 กลุ่ม"); failure uses `role="alert"`. Focus stays in the input after submit.
- Focus ring: `:focus-visible` 2px. On dark surfaces, the current `--warning #705c30` on `#0b1a15` is about 2.8:1 by hand calculation, under 3:1. Add a light-gold focus token for dark surfaces (the gold of the reference EN pill). Not measured with a tool.
- Targets ≥ 44px on 390px; `prefers-reduced-motion` disables skeleton shimmer.

## 9. Never render (ban list)
Data: vectors, vector row offsets, relevance/cosine/RRF scores, rank numbers, "% match", "best match", "top result", model name/endpoint/credentials, release hashes and checksums, raw query logs; `rawMeta`, `sourceMeta`, reviewer notes, robot `primaryUseCase`; inventory custodian, location, serial, acquisition, notes and arbitrary JSON; users, contact details, unpublished submissions, jobs, pipeline records. Release ID/time is allowed.
Visual: purple gradients, glowing brains/circuits, AI sparkles, invented dashboard numbers, simulated data shown as real, lorem ipsum, uppercase Thai, a generated summary in place of stored text.
