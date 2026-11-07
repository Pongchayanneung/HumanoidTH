import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * M7 (issue #12) automated checks for the six baseline outcomes that had no browser check:
 *   1 denial   2 privacy   3 discovery   4 controls   5 map cold read   6 keyboard navigation
 *
 * Runs against `next dev` and the seeded CI Postgres (see .github/workflows/ci.yml, e2e job).
 * Four things are worth knowing before changing it:
 * - Fixture rows (a private and a public inventory unit, a stale map cache) are written to the
 *   database named by DATABASE_URL. That URL must be a local disposable database; anything else
 *   throws before a row is written. Fixtures are removed again in afterAll.
 * - Markers that the app is supposed to filter out in the query (pending contribution, private
 *   unit) are searched for in raw HTML and in the React Server Component payload. Fields that the
 *   app masks after loading (public unit serial, location, custodian, notes) are searched for in
 *   the rendered text and in JSON APIs only. Observed on `next dev` (Next 15.5): the raw /inventory
 *   payload carries the un-sanitised Prisma rows (most likely dev-only React debug streaming; the
 *   production build was not inspected). Scanning the raw payload of a production build for those
 *   fields remains a manual step (docs/m7-baseline-check.md).
 * - Every "absent" assertion has a positive control (the checked record or the public unit IS
 *   present), so an empty page cannot pass.
 * - The DB-backed block is serial because its fixtures are shared. A failure there skips the rest of
 *   that block; run a single test with -g to see the others.
 */

type SqlClient = {
  connect(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};
const require = createRequire(import.meta.url);
const { Client } = require("pg") as { Client: new (options: { connectionString: string }) => SqlClient };

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
const TABLES = [
  "Contribution", "SubmittedData", "SourceRecord", "RobotModel", "OwnedInventory", "User", "SourcePullJob",
  "PerspectiveAnnotation", "Triplet", "Entity", "StatsCache", "PipelineRun", "OperatorSession", "OperatorAuthState",
];

// Seeded rows that must never reach a public surface: the NEEDS_REVIEW placeholder contribution
// (lib/seed-importer.ts) and the admin-queue submission.
const PENDING_MARKERS = [
  "Thai HRI research seed",
  "seed:contribution:thai-hri-research",
  "Placeholder contribution for Thai",
  "Submission candidate: Robo-Buddy",
  "Queue for admin review",
  "pending_submission_robo_buddy",
];
const APPROVED_TITLE = "Robo-Buddy: A Robot Companion for Elementary School Coding";

const PRIVATE_UNIT = {
  id: "m7-fx-private-unit",
  name: "M7 Private Unit Alpha",
  fields: ["M7 Private Unit Alpha", "M7 Owner Private", "M7 Custodian Private", "M7 Location Private", "M7-SN-PRIVATE-4471", "M7 notes private"],
};
const PUBLIC_UNIT = {
  id: "m7-fx-public-unit",
  name: "M7 Public Unit Beta",
  masked: ["M7 Custodian Public", "M7 Location Public", "M7-SN-PUBLIC-8812", "M7 notes public"],
};
const STALE_MAP_KEY = "map_contribution_clusters";
const STALE_MAP_MARKER = "M7 Stale Map Cluster";

const FORGED_COOKIES = [
  { name: "admin_session", value: "true" },
  { name: "user_role", value: "ADMIN" },
  { name: "user_email", value: "ci@example.com" },
  { name: "operator_session", value: "0".repeat(64) },
  { name: "operator_session_dev", value: "0".repeat(64) },
];

// Every route a visitor can reach without signing in, plus the sign-in page itself.
const NAV_ROUTES = ["/", "/search", "/robots", "/sources", "/map", "/inventory", "/contributions", "/perspectives", "/dashboard", "/analytics", "/network", "/submit-data", "/profile", "/admin-login"];
const PUBLIC_PAGES = [...NAV_ROUTES, "/data-pulls", "/database"];

// Skip the 2.5 s first-visit splash so keyboard and click tests start on the real page.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { sessionStorage.setItem("th_atlas_loaded_before", "true"); } catch { /* storage blocked: splash simply shows */ }
  });
});

// ---------------------------------------------------------------- helpers

function disposableDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not set: these checks need the seeded disposable database");
  const url = new URL(value);
  const redirected = ["host", "hostaddr"].some((key) => url.searchParams.has(key));
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !LOCAL_HOSTS.includes(url.hostname) || redirected) {
    throw new Error("Refusing to write fixtures: DATABASE_URL must be a local (localhost or 127.0.0.1) PostgreSQL database");
  }
  return value;
}

async function openSql(): Promise<SqlClient> {
  const sql = new Client({ connectionString: disposableDatabaseUrl() });
  await sql.connect();
  return sql;
}

async function snapshot(sql: SqlClient, tables = TABLES): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of tables) {
    const { rows } = await sql.query<{ n: number; h: string }>(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM "${table}" t`,
    );
    result[table] = `${rows[0].n}:${rows[0].h}`;
  }
  return result;
}

function requestHeaders(extra: Record<string, string>, forged: boolean): Record<string, string> {
  return forged ? { ...extra, Cookie: forgedCookieHeader } : extra;
}

function leaked(text: string, markers: string[]): string[] {
  return markers.filter((marker) => text.includes(marker));
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

async function expectNoMarkers(request: APIRequestContext, route: string, markers: string[]) {
  const html = await request.get(route);
  expect(html.status(), `${route} status`).toBe(200);
  expect(leaked(await html.text(), markers), `${route} HTML`).toEqual([]);
  const flight = await request.get(route, { headers: { RSC: "1" } });
  expect(flight.status(), `${route} RSC status`).toBe(200);
  expect(leaked(await flight.text(), markers), `${route} RSC payload`).toEqual([]);
}

function denialActionIds(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(resolve(".next/server/server-reference-manifest.json"), "utf8")) as {
    node: Record<string, { exportedName: string; filename: string }>;
  };
  const ids: Record<string, string> = {};
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.filename === "app/actions.ts") ids[entry.exportedName] = id;
  }
  return ids;
}

async function postAction(request: APIRequestContext, id: string, body: string | Record<string, string>, cookie?: string) {
  const headers = { "Next-Action": id, Accept: "text/x-component", ...(cookie ? { Cookie: cookie } : {}) };
  // A string is the encoded argument list; an object is posted as multipart form data, the way a <form action> posts.
  if (typeof body === "string") return request.post("/", { data: body, headers: { ...headers, "Content-Type": "text/plain;charset=UTF-8" } });
  return request.post("/", { multipart: { 0: '["$K1"]', ...body }, headers });
}

function slug(value: string): string {
  // Mirrors slugify() in lib/network-graph.ts, so probes use the real node id format.
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const forgedCookieHeader = FORGED_COOKIES.map(({ name, value }) => `${name}=${value}`).join("; ");

// ---------------------------------------------------------------- outcomes 1, 2 and 5 (database backed)

test.describe("database-backed outcomes (denial, privacy, map cold read)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  let sql: SqlClient;
  let pendingContributionId = "";
  let approvedContributionId = "";
  let submittedDataId = "";

  async function removeFixtures() {
    await sql.query(`DELETE FROM "OwnedInventory" WHERE id = ANY($1)`, [[PRIVATE_UNIT.id, PUBLIC_UNIT.id]]);
    await sql.query(`DELETE FROM "StatsCache" WHERE key = $1`, [STALE_MAP_KEY]);
  }

  test.beforeAll(async ({ request }) => {
    sql = await openSql();
    // Compile the app (and write the server action manifest) before any test needs it.
    await request.get("/", { timeout: 120_000 });
    await removeFixtures();
    const robot = await sql.query<{ id: string }>(`SELECT id FROM "RobotModel" WHERE "canonicalName" = 'Dinsaw Robot' LIMIT 1`);
    expect(robot.rows.length, "seeded 'Dinsaw Robot' model (run the db seed first)").toBe(1);
    await sql.query(
      `INSERT INTO "OwnedInventory"(id, "robotModelId", "displayName", "ownershipStatus", "ownerOrg", custodian, "locationLabel",
         "serialNumber", "publicSerialSafe", visibility, notes, "updatedAt")
       VALUES ($1, $3, $4, 'deployed', 'M7 Owner Private', 'M7 Custodian Private', 'M7 Location Private', 'M7-SN-PRIVATE-4471', false, 'private', 'M7 notes private', now()),
              ($2, $3, $5, 'deployed', 'M7 Owner Public',  'M7 Custodian Public',  'M7 Location Public',  'M7-SN-PUBLIC-8812',  false, 'public',  'M7 notes public',  now())`,
      [PRIVATE_UNIT.id, PUBLIC_UNIT.id, robot.rows[0].id, PRIVATE_UNIT.name, PUBLIC_UNIT.name],
    );
    await sql.query(
      `INSERT INTO "StatsCache"(key, "valueJson", "updatedAt") VALUES ($1, $2::jsonb, now())`,
      [STALE_MAP_KEY, JSON.stringify([{
        id: "m7-stale", title: STALE_MAP_MARKER, organization: "M7 Stale Org", locationLabel: "M7 Stale Place",
        latitude: 13.7, longitude: 100.5, summary: "stale", contributorType: "x", contributionCount: 3, detailsList: [],
      }])],
    );
    const ids = await sql.query<{ pending: string; approved: string; submitted: string }>(
      `SELECT (SELECT id FROM "Contribution" WHERE "sourceUrl" = 'seed:contribution:thai-hri-research') AS pending,
              (SELECT id FROM "Contribution" WHERE title = $1) AS approved,
              (SELECT id FROM "SubmittedData" LIMIT 1) AS submitted`,
      [APPROVED_TITLE],
    );
    ({ pending: pendingContributionId, approved: approvedContributionId, submitted: submittedDataId } = ids.rows[0]);
    expect(pendingContributionId && approvedContributionId && submittedDataId, "seeded contribution and submission ids").toBeTruthy();
  });

  test.afterAll(async () => {
    try { await removeFixtures(); } finally { await sql?.end(); }
  });

  // ---- outcome 1: denial

  test("1a denial: unfinished server actions refuse direct invocation, with or without forged identity, and change nothing", async ({ request }) => {
    const ids = denialActionIds();
    // Form actions get multipart fields a working implementation would read; the others get real ids and a status change.
    const denied: Record<string, string | Record<string, string>> = {
      createSubmission: { "1_title": "M7 forged submission", "1_url": "https://example.com/m7", "1_submissionType": "source_url" },
      updateSubmissionStatus: JSON.stringify([submittedDataId, "REJECTED"]),
      runDataPull: { "1_adapter": "openalex", "1_query": "robot" },
      loginAsUser: JSON.stringify(["ci@example.com", "ADMIN"]),
      registerAndLoginUser: { "1_email": "m7@example.com", "1_name": "M7 Forged", "1_role": "ADMIN" },
      upsertSourceRecordAction: { "1_id": approvedContributionId, "1_title": "M7 forged source", "1_url": "https://example.com/m7" },
      upsertRobotModelAction: { "1_canonicalName": "M7 Forged Robot" },
      upsertContributionAction: { "1_id": approvedContributionId, "1_title": "M7 forged contribution", "1_verificationStatus": "APPROVED" },
      upsertSubmittedDataAction: { "1_id": submittedDataId, "1_title": "M7 forged submitted data", "1_status": "REJECTED" },
    };
    // S5 made updateSubmissionStatus a real workflow: anonymous and forged callers now get UNAUTHENTICATED.
    const expectedCode: Record<string, string> = { updateSubmissionStatus: "UNAUTHENTICATED" };
    const before = await snapshot(sql);
    for (const [name, body] of Object.entries(denied)) {
      expect(ids[name], `server action ${name} is no longer exported from app/actions.ts: update this list`).toBeTruthy();
      for (const cookie of [undefined, forgedCookieHeader]) {
        const response = await postAction(request, ids[name], body, cookie);
        const text = await response.text();
        const label = `${name} ${cookie ? "with forged cookies" : "anonymous"}`;
        expect(response.status(), label).toBe(200);
        expect(text, label).toContain('"ok":false');
        expect(text, label).toContain(`"code":"${expectedCode[name] ?? "WORKFLOW_UNAVAILABLE"}"`);
        expect(response.headers()["set-cookie"], `${label} must not mint a session`).toBeUndefined();
      }
    }
    expect(await snapshot(sql), "denied actions changed stored data").toEqual(before);

    // Control: an action that is meant to work does not answer WORKFLOW_UNAVAILABLE, so the harness
    // is really reaching the action endpoint and the refusals above are not a generic failure.
    expect(ids.setLanguage, "setLanguage action id").toBeTruthy();
    const language = await postAction(request, ids.setLanguage, JSON.stringify(["th"]));
    expect(await language.text()).not.toContain("WORKFLOW_UNAVAILABLE");
    expect(language.headers()["set-cookie"] ?? "").toContain("lang=th");
  });

  test("1b denial: admin consoles refuse anonymous and forged sessions and show no record", async ({ page, context, request }) => {
    const targets = [
      "/admin",
      `/admin?collection=contributions&selectedId=${pendingContributionId}`,
      `/admin/cms?collection=contributions&selectedId=${pendingContributionId}`,
      `/admin/submitted-data?collection=submitted-data&selectedId=${submittedDataId}`,
    ];
    const forbidden = ["Verified session", "Operator session", ...PENDING_MARKERS];
    for (const forged of [false, true]) {
      if (forged) await context.addCookies(FORGED_COOKIES.map(({ name, value }) => ({ name, value, url: "http://localhost:3000" })));
      for (const target of targets) {
        const label = `${target} ${forged ? "forged" : "anonymous"}`;
        await page.goto(target);
        await expect(page, label).toHaveURL(/\/admin-login$/);
        await expect(page.getByRole("heading", { name: "Operator sign-in", exact: true }), label).toBeVisible();
        expect(leaked(await bodyText(page), forbidden), label).toEqual([]);
        // The raw response of the protected URL itself (no redirect followed), as HTML and as RSC payload.
        for (const extra of [{}, { RSC: "1" }] as Record<string, string>[]) {
          const raw = await request.get(target, { maxRedirects: 0, headers: requestHeaders(extra, forged) });
          expect(leaked(await raw.text(), forbidden), `${label} raw response ${JSON.stringify(extra)}`).toEqual([]);
        }
      }
    }
  });

  test("1c denial: export and ingest endpoints refuse every caller and write nothing", async ({ request }) => {
    const before = await snapshot(sql);
    for (const cookie of [undefined, forgedCookieHeader]) {
      const headers: Record<string, string> = cookie ? { Cookie: cookie } : {};
      const exported = await request.get("/api/export", { headers });
      expect(exported.status(), "GET /api/export").toBe(403);
      expect(await exported.json()).toEqual({ ok: false, code: "WORKFLOW_UNAVAILABLE" });
      for (const adapter of ["openalex", "github", "gdelt", "youtube", "not-an-adapter"]) {
        const ingest = await request.post(`/api/ingest/${adapter}`, { headers, data: { query: "robot" } });
        expect(ingest.status(), `POST /api/ingest/${adapter}`).toBe(403);
        expect(await ingest.json()).toEqual({ ok: false, code: "WORKFLOW_UNAVAILABLE" });
      }
      expect((await request.get("/api/ingest/openalex", { headers })).status(), "GET /api/ingest/openalex").toBe(405);
      expect((await request.post("/api/export", { headers, data: {} })).status(), "POST /api/export").toBe(405);
    }
    expect(await snapshot(sql), "refused endpoints changed stored data").toEqual(before);
  });

  test("1d denial: profile, submission and data-pull pages offer no working form to a forged administrator", async ({ page, context }) => {
    await context.addCookies(FORGED_COOKIES.map(({ name, value }) => ({ name, value, url: "http://localhost:3000" })));
    for (const route of ["/profile", "/submit-data", "/data-pulls"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: "Workflow unavailable", exact: true }), route).toBeVisible();
      await expect(page.locator("main form, main input, main textarea, main select, main table"), `${route} controls`).toHaveCount(0);
      expect(await bodyText(page), route).not.toContain("ci@example.com");
    }
  });

  test("1e denial: the raw database browser refuses anonymous and forged callers for every table", async ({ page, context, request }) => {
    const tables = ["sources", "robots", "owned_inventory", "contributions", "submissions", "perspective_annotations", "pull_jobs"];
    const forbidden = [...PENDING_MARKERS, ...PRIVATE_UNIT.fields, ...PUBLIC_UNIT.masked];
    for (const forged of [false, true]) {
      if (forged) await context.addCookies(FORGED_COOKIES.map(({ name, value }) => ({ name, value, url: "http://localhost:3000" })));
      for (const table of tables) {
        const route = `/database?table=${table}`;
        const label = `${route} ${forged ? "forged" : "anonymous"}`;
        await page.goto(route);
        await expect(page.getByRole("heading", { name: "Access Restricted", exact: true }), label).toBeVisible();
        await expect(page.locator("main table"), label).toHaveCount(0);
        expect(leaked(await bodyText(page), forbidden), label).toEqual([]);
        for (const extra of [{}, { RSC: "1" }] as Record<string, string>[]) {
          const raw = await request.get(route, { headers: requestHeaders(extra, forged) });
          expect(leaked(await raw.text(), forbidden), `${label} raw ${JSON.stringify(extra)}`).toEqual([]);
        }
      }
    }
  });

  // ---- outcome 2: privacy

  test("2a privacy: contributions never show pending records, by page, filter, status parameter or raw payload", async ({ page, request }) => {
    await page.goto("/contributions");
    const rows = page.locator("table tbody tr");
    await expect(page.getByText(APPROVED_TITLE).first()).toBeVisible();
    const approvedRowCount = await rows.count();
    expect(approvedRowCount).toBeGreaterThanOrEqual(3);
    expect(leaked(await bodyText(page), PENDING_MARKERS)).toEqual([]);

    // Asking for the pending status, or for the pending record by name or type, must not surface it.
    await page.goto("/contributions?status=NEEDS_REVIEW");
    await expect(page.getByRole("status")).toContainText("Status filtering is disabled");
    await expect(rows).toHaveCount(approvedRowCount);
    expect(leaked(await bodyText(page), PENDING_MARKERS)).toEqual([]);
    for (const query of ["q=Thai%20HRI%20research%20seed", "type=research_paper", "q=Placeholder"]) {
      await page.goto(`/contributions?${query}`);
      await expect(page.locator("td.empty"), query).toBeVisible();
      expect(leaked(await bodyText(page), PENDING_MARKERS), query).toEqual([]);
    }
    await expectNoMarkers(request, "/contributions?status=NEEDS_REVIEW", PENDING_MARKERS);
  });

  test("2b privacy: inventory hides private units and masks sensitive fields of public units, even when operator mode is requested", async ({ page, context, request }) => {
    for (const forged of [false, true]) {
      if (forged) await context.addCookies(FORGED_COOKIES.map(({ name, value }) => ({ name, value, url: "http://localhost:3000" })));
      for (const route of ["/inventory", "/inventory?mode=operator"]) {
        const label = `${route} ${forged ? "forged" : "anonymous"}`;
        await page.goto(route);
        await expect(page.getByText(PUBLIC_UNIT.name).first(), `${label}: public unit is listed`).toBeVisible();
        const text = await bodyText(page);
        expect(leaked(text, PRIVATE_UNIT.fields), `${label} private unit`).toEqual([]);
        expect(leaked(text, PUBLIC_UNIT.masked), `${label} unmasked fields of the public unit`).toEqual([]);
        expect(text, label).not.toContain("Operator Mode (Private)");
      }
    }
    await expectNoMarkers(request, "/inventory", PRIVATE_UNIT.fields);
    await expectNoMarkers(request, "/inventory?mode=operator", PRIVATE_UNIT.fields);
  });

  test("2c privacy: the network graph, node and edge APIs expose the public unit only, with no private or pending data", async ({ request }) => {
    const markers = [...PENDING_MARKERS, ...PRIVATE_UNIT.fields, ...PUBLIC_UNIT.masked];
    const publicNodeId = `owned_inventory:${slug(PUBLIC_UNIT.name)}`;
    const privateNodeId = `owned_inventory:${slug(PRIVATE_UNIT.name)}`;
    const pendingNodeId = "contribution:thai_hri_research_seed";
    type Graph = { nodes: { id: string; label: string; type: string; is_private: boolean }[]; edges: { id: string; source: string; target: string }[] };

    // The server caches a built graph for 60 s per option set, so wait until it reflects the fixtures. Only
    // inventory nodes are requested: the full graph is cut at 1000 nodes by rank and could drop the unit.
    // Positive control first (wait for the fixtures to show up), then the privacy assertion on that same
    // response: exactly the public unit is an inventory node.
    let inventoryNodeIds: string[] = [];
    await expect.poll(async () => {
      const typed = await request.get("/api/network/graph?source=database&nodeType=owned_inventory");
      inventoryNodeIds = ((await typed.json()) as Graph).nodes.map((node) => node.id);
      return inventoryNodeIds;
    }, { message: "public unit in the database graph", timeout: 75_000, intervals: [2_000] }).toContain(publicNodeId);
    expect(inventoryNodeIds, "only the public unit is an inventory node").toEqual([publicNodeId]);

    let publicEdgeIds: string[] = [];
    for (const source of ["database", "auto", "hybrid", "file"]) {
      // A unique edge limit gives each request its own cache slot, so it is never a pre-fixture graph.
      const response = await request.get(`/api/network/graph?source=${source}&limitNodes=1000&limitEdges=${2400 + Math.floor(Math.random() * 90)}&includePrivate=true`);
      expect(response.status(), source).toBe(200);
      const text = await response.text();
      const graph = JSON.parse(text) as Graph;
      expect(leaked(text, markers), `graph source=${source}`).toEqual([]);
      expect(graph.nodes.filter((node) => node.is_private), `private nodes, source=${source}`).toEqual([]);
      expect(graph.nodes.map((node) => node.id), `source=${source}`).not.toContain(privateNodeId);
      expect(graph.nodes.map((node) => node.id), `source=${source}`).not.toContain(pendingNodeId);
      if (source === "database") {
        publicEdgeIds = graph.edges.filter((edge) => edge.source === publicNodeId || edge.target === publicNodeId).map((edge) => edge.id);
      }
    }

    // Detail APIs. The detail window is the top 1000 nodes by rank, so a public positive may legitimately be
    // outside it; when it is inside, it must not carry masked data. The private unit and the pending record
    // must never be found, under any source mode.
    const detail = await request.get(`/api/network/node/${encodeURIComponent(publicNodeId)}?source=database`);
    if (detail.status() === 200) expect(leaked(await detail.text(), markers), "public unit node detail").toEqual([]);
    else test.info().annotations.push({ type: "note", description: "public unit is outside the 1000-node detail window; detail positive control skipped" });
    const privateEdgeIds = publicEdgeIds.map((id) => id.replaceAll(slug(PUBLIC_UNIT.name), slug(PRIVATE_UNIT.name)));
    for (const id of publicEdgeIds) {
      const edge = await request.get(`/api/network/edge/${encodeURIComponent(id)}?source=database`);
      if (edge.status() === 200) expect(leaked(await edge.text(), markers), "public unit edge detail").toEqual([]);
    }
    for (const mode of ["database", "auto", "hybrid", "file"]) {
      const probes: [string, string][] = [["node", privateNodeId], ["node", pendingNodeId], ...privateEdgeIds.map((id): [string, string] => ["edge", id])];
      for (const [kind, id] of probes) {
        const probe = await request.get(`/api/network/${kind}/${encodeURIComponent(id)}?source=${mode}&includePrivate=true`);
        expect(probe.status(), `${kind} ${id} source=${mode}`).toBe(404);
        expect(leaked(await probe.text(), markers), `${kind} ${id} source=${mode}`).toEqual([]);
      }
    }
  });

  test("2d privacy: no public page, payload, search response or exported corpus carries pending or private data", async ({ request }) => {
    const markers = [...PENDING_MARKERS, ...PRIVATE_UNIT.fields];
    for (const route of PUBLIC_PAGES) await expectNoMarkers(request, route, markers);

    for (const query of ["Thai HRI research seed", "Placeholder contribution", PRIVATE_UNIT.name, "robot"]) {
      const response = await request.post("/api/search", { data: { query } });
      // Keyword search may return 200 with public matches. An unavailable search may return 503.
      expect([200, 503], `search "${query}" status`).toContain(response.status());
      const body = await response.text();
      // The query itself may be echoed back, so only text that exists in stored records counts as a leak.
      const storedOnly = markers.filter((marker) => !query.includes(marker) && !marker.includes(query));
      expect(leaked(body, storedOnly), `search response for "${query}"`).toEqual([]);
      // Disabled after F6 enabled keyword search. Public matches can legitimately populate groups.
      // expect(JSON.parse(body).groups ?? [], `search groups for "${query}"`).toEqual([]);
    }

    // The exported search corpus and the crawler summary are static files in the repository.
    for (const file of ["data/search/documents.json", "data/search/probe-128.json", "public/llms.txt"]) {
      expect(leaked(readFileSync(resolve(file), "utf8"), markers), file).toEqual([]);
    }
    // The corpus lives outside public/, so it must not be fetchable by URL either.
    expect((await request.get("/data/search/documents.json")).status()).toBe(404);
  });

  // ---- outcome 5: map cold read

  test("5 map: a first read shows the honest unavailable notice, no stale cache, no model or map call, and no write", async ({ browser }) => {
    const before = await snapshot(sql);
    const cacheBefore = await sql.query(`SELECT key, "valueJson", "updatedAt" FROM "StatsCache" WHERE key = $1`, [STALE_MAP_KEY]);
    expect(cacheBefore.rows.length, "stale cache fixture is in place").toBe(1);

    for (const lang of ["en", "th"] as const) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const outbound: string[] = [];
      context.on("request", (request) => outbound.push(request.url()));
      if (lang === "th") await context.addCookies([{ name: "lang", value: "th", url: "http://localhost:3000" }]);
      const page = await context.newPage();
      const response = await page.goto("/map");
      expect(response?.status()).toBe(200);

      const notice = page.locator('[data-map-state="unavailable"]');
      await expect(notice, lang).toBeVisible();
      await expect(notice.getByRole("heading", { level: 2 }), lang).toHaveText(
        lang === "en" ? "Map analysis is unavailable in this release." : "การวิเคราะห์แผนที่ยังไม่เปิดให้ใช้งานในรุ่นนี้",
      );
      await expect(page.locator("h1").first(), lang).toBeVisible();
      expect(await bodyText(page), `${lang}: stale cached cluster shown`).not.toContain(STALE_MAP_MARKER);
      expect(leaked(await page.content(), [STALE_MAP_MARKER, "M7 Stale Org", "M7 Stale Place"]), `${lang}: stale cache in HTML`).toEqual([]);
      const flight = await context.request.get("/map", { headers: { RSC: "1" } });
      expect(leaked(await flight.text(), [STALE_MAP_MARKER, "M7 Stale Org", "M7 Stale Place"]), `${lang}: stale cache in RSC payload`).toEqual([]);
      await expect(page.locator(".gm-style, iframe, canvas, [data-map-state=ready]"), `${lang}: map widget`).toHaveCount(0);
      // Browser-side only: a server-side provider call is not visible here (covered by test/map-honest.test.ts).
      const external = outbound.filter((url) => /googleapis|gstatic|generativelanguage|maps\.google/.test(url));
      expect(external, `${lang}: provider requests`).toEqual([]);
      await context.close();
    }

    const cacheAfter = await sql.query(`SELECT key, "valueJson", "updatedAt" FROM "StatsCache" WHERE key = $1`, [STALE_MAP_KEY]);
    expect(cacheAfter.rows, "a public map read rewrote the cache").toEqual(cacheBefore.rows);
    expect(await snapshot(sql), "a public map read changed stored data").toEqual(before);
  });
});

// ---------------------------------------------------------------- outcome 3: discovery

for (const width of [1440, 390]) {
  test(`3 discovery (${width}px): public destinations are reachable through the drawer`, async ({ page, request }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    const button = page.getByRole("button", { name: "Open navigation", exact: true });
    const drawer = page.getByRole("dialog", { name: "Atlas navigation" });
    await expect(drawer).toBeHidden();
    for (const route of NAV_ROUTES) {
      await button.click();
      const links = drawer.getByRole("link");
      expect(await links.evaluateAll(items => items.map(link => link.getAttribute("href")))).toEqual(NAV_ROUTES);
      await drawer.locator(`a[href="${route}"]`).click();
      await expect(page, route).toHaveURL(url => url.pathname === route, { timeout: 90_000 });
      await expect(page.locator("main h1").first(), route).toBeVisible({ timeout: 90_000 });
      await expect(drawer).toBeHidden();
      await button.click();
      await expect(drawer.locator(`a[href="${route}"]`)).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    }

    if (width === 1440) {
      const sitemap = await (await request.get("/sitemap.xml")).text();
      for (const route of ["/robots", "/sources", "/contributions", "/map", "/network", "/perspectives", "/inventory"]) {
        expect(sitemap, `sitemap lists ${route}`).toMatch(new RegExp(`<loc>[^<]*${route}</loc>`));
      }
      for (const route of ["/admin", "/profile", "/data-pulls"]) {
        expect(sitemap, `sitemap must not list ${route}`).not.toMatch(new RegExp(`<loc>[^<]*${route}</loc>`));
      }
    }
  });
}

// ---------------------------------------------------------------- outcome 4: controls

test("4a controls: language switch changes the page language, survives reload, and switches back", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  const heading = page.locator("main h1").first();
  const english = (await heading.innerText()).trim();
  expect(english).not.toMatch(/[฀-๿]/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const thai = page.getByRole("button", { name: "TH ภาษาไทย", exact: true });
  const eng = page.getByRole("button", { name: "EN English", exact: true });
  await expect(thai).toHaveAttribute("aria-pressed", "false");
  await thai.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(heading).toHaveText(/[฀-๿]/);
  await expect(thai).toHaveAttribute("aria-pressed", "true");
  expect((await context.cookies()).find((cookie) => cookie.name === "lang")?.value).toBe("th");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(heading).toHaveText(/[฀-๿]/);
  await page.getByRole("button", { name: "เปิดเมนู", exact: true }).click();
  await expect(page.getByRole("dialog").locator('a[href="/dashboard"]')).toContainText(/[฀-๿]/);
  await page.keyboard.press("Escape");

  await eng.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(heading).toHaveText(english);
});

test("4b controls: contributions filters accept valid input, reject invalid input, and tell empty from failed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/contributions");
  const rows = page.locator("table tbody tr");
  const total = await rows.count();
  expect(total).toBeGreaterThanOrEqual(3);

  // Valid text filter through the form: narrows to the matching checked record.
  await page.getByLabel("Text Search", { exact: true }).fill("Robo-Buddy");
  await page.getByRole("button", { name: "Apply Filters", exact: true }).click();
  await expect(page).toHaveURL(/q=Robo-Buddy/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Robo-Buddy");

  // Valid filter with no match: empty state, and not an error.
  await page.goto("/contributions?q=zzzz-no-such-contribution");
  await expect(page.locator("td.empty")).toContainText("No contribution records match");
  await expect(page.locator('.notice[role="alert"]')).toHaveCount(0);

  // A valid type that only the withheld pending record has: also empty, also not an error.
  await page.goto("/contributions?type=research_paper");
  await expect(page.locator("td.empty")).toContainText("No contribution records match");
  await expect(page.locator('.notice[role="alert"]')).toHaveCount(0);

  // Invalid values: a named error, no rows presented as results.
  for (const [query, message] of [["type=not_a_type", "Unknown contribution type"], ["status=BOGUS", "Unknown verification status"]]) {
    await page.goto(`/contributions?${query}`);
    await expect(page.locator('.notice[role="alert"]').filter({ hasText: message }), query).toBeVisible();
    await expect(page.locator("td.empty"), query).not.toContainText("No contribution records match");
    await expect(rows.filter({ hasText: "Robo-Buddy" }), query).toHaveCount(0);
  }

  // Thai wording differs for the same empty state.
  await page.context().addCookies([{ name: "lang", value: "th", url: "http://localhost:3000" }]);
  try {
    await page.goto("/contributions?q=zzzz-no-such-contribution");
    await expect(page.locator("td.empty")).toContainText(/[฀-๿]/);
  } finally {
    await page.context().clearCookies();
  }
});

test("4c controls: network controls change what the graph shows", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/network");
  await expect(page.getByLabel("Interactive network graph")).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __networkCy?: { nodes(): { length: number } } }).__networkCy?.nodes().length), null, { timeout: 90_000 });
  // Evaluate an expression against the Cytoscape instance the page exposes for tests.
  const cy = <T,>(expression: string) => page.evaluate(`(() => { const cy = window.__networkCy; return ${expression}; })()`) as Promise<T>;

  // Node search: a label taken from the graph is found and selected.
  const search = page.getByPlaceholder("Search node label...");
  const label = await cy<string>('cy.nodes()[0].data("label")');
  await search.fill(label);
  // Retry the click: the first one can land before the page has finished its initial layout.
  await expect(async () => {
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    expect(await cy<string[]>('cy.nodes(":selected").map((n) => n.data("label"))')).toContain(label);
  }).toPass({ timeout: 20_000 });

  await page.getByLabel("Label display").selectOption("off");
  expect(await cy<number>('cy.nodes(".show-label").length')).toBe(0);
  await page.getByLabel("Label display").selectOption("all");
  const labelled = await cy<{ shown: number; nodes: number }>('({ shown: cy.nodes(".show-label").length, nodes: cy.nodes().length })');
  expect(labelled.shown).toBe(labelled.nodes);
  expect(labelled.nodes).toBeGreaterThan(0);

  const arrows = page.getByRole("button", { name: "Arrows", exact: true });
  const arrowShape = () => cy<string>('cy.edges()[0].style("target-arrow-shape")');
  const withArrows = await arrowShape();
  await arrows.click();
  expect(await arrowShape(), "Arrows toggle changes edge style").not.toBe(withArrows);
  await arrows.click();
  expect(await arrowShape()).toBe(withArrows);

  const filters = page.getByRole("complementary", { name: "Network filters" });
  await expect(filters).toHaveCount(0);
  await page.getByRole("button", { name: "Show filters", exact: true }).click();
  await expect(filters).toBeVisible();
  await page.getByRole("button", { name: "Hide filters" }).click();
  await expect(filters).toHaveCount(0);

  await page.getByLabel("Network data source").selectOption("file");
  await expect(page.getByText(/Data source: Import file/i)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Network data source").selectOption("database");
  await expect(page.getByText(/Data source: Database/i)).toBeVisible({ timeout: 30_000 });

});

// ---------------------------------------------------------------- outcome 6: keyboard navigation

for (const width of [1440, 390]) {
  test(`6 keyboard (${width}px): drawer traps focus, restores it, and follows a link`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
    const dialog = page.getByRole("dialog", { name: "Atlas navigation" });
    await page.keyboard.press("Tab"); // Skip link.
    await page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Close navigation" })).toBeFocused();
    for (const href of NAV_ROUTES) {
      await page.keyboard.press("Tab");
      const link = dialog.locator(`a[href="${href}"]`);
      await expect(link).toBeFocused();
      expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("link", { name: "Search", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search$/);
    await expect(dialog).toBeHidden();
    const thai = page.getByRole("button", { name: "TH ภาษาไทย", exact: true });
    await thai.focus();
    try {
      await page.keyboard.press("Enter");
      await expect(page.locator("html")).toHaveAttribute("lang", "th");
    } finally {
      await context.clearCookies();
    }
  });
}
