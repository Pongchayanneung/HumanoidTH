# 🤖 Thailand Humanoid Atlas 🗺️

<p align="center">
<img width="1672" height="941" alt="ChatGPT Image Jul 3, 2026, 06_45_37 AM" src="https://github.com/user-attachments/assets/c9281d22-6d95-4956-90f7-3039bad08947" />
</p>

## Hackathon preparation

See [our Hackathon preparation documents](docs/Hackathon-preparation/README.md) for the feature proposal and technical design, both Hack Day plans and the baseline audits.

<p align="center">
  <a href="https://github.com/taechasith/HumanoidTH/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white&color=F59E0B" alt="License" />
  </a>
  <a href="https://github.com/taechasith/HumanoidTH/pulls">
    <img src="https://img.shields.io/badge/PRs-welcome-emerald.svg?style=for-the-badge&logo=git&logoColor=white&color=10B981" alt="PRs Welcome" />
  </a>
  <a href="#-setup--installation">
    <img src="https://img.shields.io/badge/Stack-Next.js%20%7C%20Prisma%20%7C%20Postgres-emerald?style=for-the-badge&logo=nextdotjs&logoColor=white&color=064E3B" alt="Stack" />
  </a>
  <a href="https://github.com/taechasith/HumanoidTH/issues">
    <img src="https://img.shields.io/badge/Status-Active-yellow?style=for-the-badge&logo=statuspage&logoColor=white&color=EAB308" alt="Status" />
  </a>
</p>

---

✨ **Thailand Humanoid Atlas** is a labor of love. I believe that the future of humanoid and social robotics belongs to the community. I designed this research database platform to help map, understand, and accelerate Thailand’s robotics ecosystem. 🇹🇭🤖

Whether it is cataloging companion robots caring for older adults, mapping academic publications by local researchers, or open-sourcing data structures, I want to create a transparent, reliable, and collaborative atlas for all. 📚💖

I open-source this project from the heart, and I invite you to hack, contribute, and build the future of embodied AI in Thailand together! 🤝🚀❤️

---

## 🗺️ The Four Core Ecosystem Layers

The platform collects, normalizes, classifies, and visualizes four connected layers of the robotics landscape:

| Layer | Focus | Key Indicators & Features |
| :--- | :--- | :--- |
| 🟢 **1. Perspectives** | 📣 **Public & Media Voice** | Stance analysis, sentiment, healthcare trust, job displacement, ethics |
| 🟡 **2. Contributions**| 💻 **Hacker & Researcher Directory** | Projects, papers, GitHub repositories, hardware builds, community events |
| 🟢 **3. Model Registry**| 🤖 **Robot Catalog** | Manufacturer specs, country of origin, Thailand deployment status |
| 🟡 **4. Inventory** | 📦 **Physical Assets** | Maintenance logs, custody tracking, condition, and availability |

---

## ⚡ Tech Stack & Architecture

I built this platform using a modern, scalable, and developer-friendly stack:

- 💻 **Frontend & Routing:** [Next.js 15 (App Router)](https://nextjs.org/) for highly responsive Server Components and dynamic layouts.
- 🗄️ **Database & Modeling:** [Prisma ORM](https://www.prisma.io/) with [PostgreSQL](https://www.postgresql.org/) for transparent, typed data structures.
- ⚙️ **Data Ingestion Adapters:** Multi-source background adapters retrieving records from **OpenAlex** 🎓, **GitHub** 🐙, **GDELT** 🌍, and **YouTube** 📺.
- 🧠 **AI Integration:** [Gemini API](https://ai.google.dev/) (`gemini-1.5-flash`) for automated relevance classification, stance extraction, and geographical contribution clustering.

---

## 🚀 Setup & Installation

Follow these simple steps to spin up the Thailand Humanoid Atlas on your local machine:

### 📥 1. Clone the repository and install dependencies
```bash
# Clone the repository
git clone https://github.com/taechasith/HumanoidTH.git
cd HumanoidTH

# Install dependencies using pnpm
pnpm install
```

### ⚙️ 2. Configure Environment Variables
Create a local `.env` file by copying the template:
```bash
cp .env.example .env
```

Ensure your `.env` contains the required database link and API keys:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/thailand_humanoid_atlas?schema=public"
YOUTUBE_API_KEY="your-youtube-api-key"
GITHUB_TOKEN="your-github-personal-access-token"
GEMINI_API_KEY="your-gemini-api-key"
```
> [!NOTE]
> 📺 `YOUTUBE_API_KEY` is required only for video ingestion. 🔑 `GEMINI_API_KEY` is required for AI-powered contribution mapping and source analysis. 🐙 `GITHUB_TOKEN` is optional but highly recommended to avoid API rate limiting.

### 🗄️ 3. Initialize & Seed the Database
```bash
# Generate Prisma client files
pnpm db:generate

# Push the schema to your local PostgreSQL
pnpm db:push

# Run seed script to populate sample robots, perspectives, and contributions
pnpm db:seed
```

### 🟢 4. Run Development Server
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) inside your browser to see the atlas alive! 🟢✨

---

## 🔌 API Ingestion & Data Pulls

The platform features built-in ingestion adapters. You can use the UI dashboard at `/data-pulls` or trigger the background ingest API endpoints directly using `curl`:

#### 🌾 Ingest Academic papers from OpenAlex 🎓
```bash
curl -X POST http://localhost:3000/api/ingest/openalex \
  -H "content-type: application/json" \
  -d '{"query":"humanoid robot Thailand","limit":10}'
```

#### 💻 Ingest Repositories from GitHub 🐙
```bash
curl -X POST http://localhost:3000/api/ingest/github \
  -H "content-type: application/json" \
  -d '{"query":"robotics thailand","limit":10}'
```

---

## 🌐 Product Routes Map

Explore the main app modules:
- `🟢 /` — 📊 Interactive overview of the corpus, statistics, and active tasks.
- `🟡 /robots` — 🤖 Registry of robot models deployed, researched, or observed in Thailand.
- `🟢 /perspectives` — 📣 Media coverage database, platform sentiment, and safety metrics.
- `🟡 /contributions` — 📂 Directory of open-source repositories, makers, and papers.
- `🟢 /map` — 🗺️ AI-powered ecosystem contribution map geolocating Thai robotics research and inventory.
- `🟢 /network` — 🔗 Dynamic Cytoscape network graph mapping connections between institutions, developers, and robots.
- `🟡 /analytics` — 📈 Statistics, sentiment graphs, and attention metrics over time.
- `🟢 /data-pulls` — 🔌 Control room to trigger data ingestion pipelines.
- `🟡 /submit-data` — 📥 Community submission form for sharing robot models and projects.

---

## 📚 Research Methodology Guide

This atlas is intended to support transparent, repeatable research rather than a one-time scrape. Researchers extending the dataset should follow a documented workflow so every record can be audited, corrected, and cited.

### 🎯 1. Define the Research Question
Start each research round with a narrow question, for example:
- ❓ Which humanoid or social robots have been publicly deployed in Thailand since 2020?
- ❓ Which Thai universities, labs, companies, or maker communities contribute to humanoid robotics?
- ❓ How does public/media sentiment frame eldercare, hospital, education, or service robots?
- ❓ Which robot models are observed in Thailand, imported for evaluation, locally developed, or owned by the project team?

Write the question, date range, inclusion rules, and source types before collecting data. 📝

### 📥 2. Source Collection Protocol
Use multiple source classes and keep provenance for each record:
- 🎓 **Academic indexes:** OpenAlex, university repositories, conference pages.
- 💻 **Code and hardware repositories:** GitHub, GitLab, project documentation.
- 📰 **News and public media:** Thai and international news, press releases, institutional announcements.
- 📺 **Video platforms:** YouTube demos, public talks, product launches.
- 👥 **Community submissions:** forms, field notes, correction requests, robot sightings.
- 📂 **Project records:** owned inventory, custody notes, maintenance logs, deployment logs.

For every source, store the canonical URL, title, platform, publication date, author or organization when available, short source excerpt, ingestion date, and any query terms used.

### ⚖️ 3. Inclusion and Exclusion Criteria
Include records when they have clear evidence for both robotics relevance and Thailand relevance.

**Include:**
- 🤖 Humanoid, social, companion, education, hospital, eldercare, museum, exhibition, or human-facing service robots.
- 🧪 Research prototypes, field deployments, demos, datasets, repositories, papers, and hardware builds.
- 🇹🇭 Thailand-based organizations or Thailand deployment/use/evaluation.

**Exclude or mark for review:**
- 🚫 Generic AI chatbot records with no embodied robot.
- 🚫 Industrial automation records with no human-facing robotics relevance.
- 🚫 Vendor claims without independent evidence.
- 🚫 Private personal data or content that cannot be ethically stored.
- 🚫 Full-text copyrighted material beyond short source excerpts.

### 🔍 4. Screening and Confidence Scoring
Each candidate record should be screened in two passes:
1. **Relevance pass:** decide whether the source is about humanoid/social/service robotics and connected to Thailand.
2. **Source pass:** verify that the record has enough source material to support classification.

Recommended confidence buckets:
- 🟢 `0.85-1.00`: strong evidence, source directly supports the claim.
- 🟡 `0.60-0.84`: plausible evidence, accepted but should be revisited.
- 🔴 `< 0.60`: weak or ambiguous evidence, keep in review or reject.

Do not publish generated or placeholder records as real data. If the database or API is unavailable, the UI should show an unavailable/empty state rather than substitute mock records. ⚠️

### 🏷️ 5. Coding Scheme
Use consistent labels so the dataset remains analyzable:
- 🚦 **Robot status:** `observed_in_thailand`, `developed_in_thailand`, `imported_for_evaluation`, `owned`, `retired`, `unknown`.
- 🗃️ **Contribution type:** research paper, repository, dataset, hardware build, event, field observation, media analysis, education module, repair, deployment.
- 🧠 **Perspective themes:** healthcare trust, job displacement, safety, privacy, education, accessibility, national innovation, entertainment, ethics.
- 📣 **Stance:** supportive, cautious supportive, neutral, skeptical, critical, mixed.
- 📁 **Source type:** primary source, institutional source, academic source, news article, social/video source, community submission.

When adding new labels, document why the existing taxonomy was insufficient.

### 🧹 6. Deduplication and Entity Resolution
Before analysis, deduplicate records:
- 🔗 Canonicalize URLs and remove tracking parameters.
- 🆔 Match platform IDs when available.
- 🔤 Compare normalized titles, organizations, robot model names, and dates.
- 📰 Merge syndicated news and repeated press releases when they describe the same event.
- 📂 Preserve all source URLs as evidence when merging duplicates.

Entity resolution should be conservative. If two names may refer to the same lab, company, robot, or project, mark them for review rather than merging automatically. 🧐

### 🔗 7. Relationship Modeling
Represent relationships as directed triplets:
```text
subject -> relation -> object
```

Examples:
```text
University Lab -> developed -> Robot Prototype
Source Article -> discusses -> Robot Model
Contribution -> uses -> Robot Model
Organization -> deployed_at -> Hospital/Event/School
Public Perspective -> concerns -> Safety/Privacy/Jobs
```

Each edge should carry source evidence, confidence, and timestamp metadata. Avoid graph links that are only inferred from vague similarity. 🕸️

### 🛡️ 8. Validation and Audit
For each research batch:
- 🔍 Sample accepted records and manually verify source evidence.
- 🔍 Review all low-confidence records.
- 🔍 Check for duplicated robot models and organizations.
- 🔍 Confirm that claims about ownership, deployment, or custody are supported by explicit evidence.
- ⚙️ Run automated checks before publishing:

```bash
pnpm check:no-mock-data
pnpm typecheck
pnpm build
```

### 🔒 9. Ethics, Privacy, and Legal Care
Use public, permissible sources only. Do not store private personal data, private account content, or sensitive location details unless there is a clear operational need and consent. For owned inventory, mask public location and serial information when appropriate. Store short excerpts for sources; link to original sources rather than redistributing full copyrighted text. ⚖️

### 📊 10. Reporting and Citation
When publishing analysis from the atlas, report:
- 📅 Dataset snapshot date.
- 🔌 Query terms and source adapters used.
- ⚖️ Inclusion/exclusion criteria.
- 📈 Number of records screened, accepted, rejected, and pending review.
- ⚠️ Known gaps and biases, such as language coverage, platform API limits, or overrepresentation of English-language sources.
- 🆔 Version or commit hash of the code used for analysis.

This makes future research rounds comparable and allows other researchers to reproduce or challenge the findings.

---

## ☁️ Vercel Deployment

This project is fully optimized for **Vercel** out-of-the-box using the provided `vercel.json` configuration.

### 🔑 Vercel Environment Variables
Set these variables in your Vercel project settings:
```env
DATABASE_URL="prisma+postgres://accelerate.prisma-data.net/?api_key=..."
NEXT_PUBLIC_APP_URL="https://your-project.vercel.app"
ADMIN_BASIC_USER="creativelab.co.th@gmail.com"
ADMIN_BASIC_PASSWORD="use-a-strong-password"
YOUTUBE_API_KEY="your-api-key"
GITHUB_TOKEN="your-token"
GEMINI_API_KEY="your-gemini-api-key"
```

> [!IMPORTANT]
> - 🔒 Production endpoints `/admin/*`, `/data-pulls`, and `/api/ingest/*` are protected with Basic Auth using `ADMIN_BASIC_USER` and `ADMIN_BASIC_PASSWORD`. Keep credentials safe!
> - ⚙️ The Vercel build command is configured to run `pnpm vercel-build` which automatically handles schema generation. Do **not** run `db:push` inside the Vercel build phase.

---

## 🛠️ Developer Scripts & CLI Tools

The platform provides a suite of developer utilities for testing, data integrity checking, database synchronization, and search engine optimization.

| Script Command | Purpose | Details |
| :--- | :--- | :--- |
| `pnpm dev` | Run full dev suite | Boots the Next.js local server *and* starts the background dataset hot-reloader. |
| `pnpm dev:next` | Next.js server only | Launches only the local Next.js client (`localhost:3000`). |
| `pnpm seed:watch` | Hot-reloading seed sync | Watches [thailand_humanoid_atlas_seed_records.json](file:///C:/Users/HP%20OMEN/HumanoidTH/thailand_humanoid_atlas_seed_records.json) for modifications and automatically synchronizes updates into PostgreSQL. |
| `pnpm check:no-mock-data` | Audit data integrity | Checks page components under `/app` to ensure no mock constants, fallback placeholders, or static records are used, enforcing active DB routing. |
| `pnpm seo:audit` | Audit metadata and tags | Scans Next.js dynamic routing structures to verify Title, Meta Descriptions, Canonicals, OpenGraph schemas, and headers. |
| `pnpm seo:optimize` | Auto-apply SEO fixes | Programmatically rewrites page component metadata blocks with audit-approved SEO structures. |
| `pnpm test` | Run test suite | Executes unit and integration test specs defined in the `test/` directory. |
| `pnpm db:generate` | Generate Prisma Client | Re-compiles types and schemas into `generated/prisma` client files. |
| `pnpm db:push` | Sync database schemas | Migrates model changes directly into the PostgreSQL database. |
| `pnpm db:seed` | Seed database manually | Performs a one-time import of the seed record file into the database. |

---

## 📁 Repository Structure Map

Below is a breakdown of the key files and folders in the project to help navigate:

```text
├── app/                      # Next.js App Router (pages and layouts)
│   ├── components/           # Reusable widgets (SidebarNav, LanguageSelector, etc.)
│   │   ├── FirstTimeLoader.tsx   # Fullscreen landing splash screen loader (Minimal style)
│   │   └── RobotViewer.tsx       # Interactive 3D robot model renderer (Three.js)
│   ├── loading.tsx           # Page routing transition loader
│   ├── globals.css           # Global custom stylesheet
│   └── page.tsx              # Home / Overview dashboard page
├── components/               # App-wide UI design system components
│   └── loading-ui/           # Reusable inline spinner components (Ring, DotsRing)
├── data/                     # Data feeds, pipeline configurations, and seed templates
├── lib/                      # Shared logic, configurations, and API clients
│   ├── prisma.ts             # Prisma Database client instance
│   ├── seo.ts                # Search Engine Optimization constants
│   └── translations.ts       # Bilingual translation catalog (EN/TH)
├── prisma/                   # Prisma database setup
│   ├── schema.prisma         # Unified entity relationships model definitions
│   └── seed.ts               # Core database seeder scripts
├── public/                   # Client static assets (logos, images, and model assets)
│   └── teal_v.2.glb          # Canonical 3D humanoid robot model mesh (Three.js)
├── scripts/                  # CLI background tasks and dev helpers
└── test/                     # Unit and integration test definitions
```

---

## 🌐 Dynamic Components & Architecture

### 🌀 Fullscreen Landing Splash vs Route Loader
- **First Time Landing Loader**: Configured in [FirstTimeLoader.tsx](file:///C:/Users/HP%20OMEN/HumanoidTH/app/components/FirstTimeLoader.tsx). Runs a fullscreen, modern dark-gradient splash screen once per user session (using `sessionStorage` tracking) with orbiting HUD rings, rotating logo details, and loading status progress messages.
- **Router Transition Loader**: A lightweight spinner configured in [loading.tsx](file:///C:/Users/HP%20OMEN/HumanoidTH/app/loading.tsx) that handles page-to-page Next.js transitions without blocky overlays.

### 🤖 3D Robot Viewer
- Powered by [Three.js](https://threejs.org/) inside [RobotViewer.tsx](file:///C:/Users/HP%20OMEN/HumanoidTH/app/components/RobotViewer.tsx). It dynamically loads the 3D model `public/teal_v.2.glb`, sets up lighting grids (ambient, fill, key, rim lights), supports click-and-drag rotation, and renders an interactive welcoming wave.

### 🇹🇭 Bilingual Localization Catalog
- Supports dynamic English (`en`) and Thai (`th`) language switching. Language settings are stored in the browser cookie (`lang`) and resolved using Next.js layouts alongside the dictionary catalog in [translations.ts](file:///C:/Users/HP%20OMEN/HumanoidTH/lib/translations.ts).

---

## 🤝 Join the Robotics Movement!

I believe that building a database for the Thailand robotics community should be a collective effort. Here is how you can help:
1. 🤖 **Add Robot Models:** Spatially document models, prototypes, or service robots you've encountered or built in Thailand.
2. 🔌 **Develop Adapters:** Help build connectors for localized Thai news portals, government research sites, or forums.
3. 🧠 **Refine Stance Models:** Help improve sentiment/stance classification rules so I can better map public trust.
4. 🛠️ **Fix Bugs & Improve UX:** Feel free to open issues or file PRs!

I look forward to seeing your pull requests! Keep building, keep sharing! 🤖💛💚

---

### 📝 Notes on Legacy Codebase
The original Python/FastAPI MVP remains in the `src/` directory for historical reference and potential background worker tasks, but the main Next.js web application is the active surface of the atlas project.

---

<p align="center">
  Made with 💚, 💛 and 🤖 in Thailand
</p>
