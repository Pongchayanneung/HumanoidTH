import { test, expect } from "@playwright/test";

async function expectGraphEnvelope(response: Awaited<ReturnType<typeof fetch>> | any) {
  expect(response.status()).toBeLessThan(500);

  const graph = await response.json();
  expect(Array.isArray(graph.nodes)).toBe(true);
  expect(Array.isArray(graph.edges)).toBe(true);
  expect(Array.isArray(graph.clusters)).toBe(true);
  expect(graph.meta).toBeTruthy();
  expect(graph.meta.source_mode).toBeTruthy();
  expect(graph.meta.resolved_source).toBeTruthy();
  expect(Array.isArray(graph.meta.warnings)).toBe(true);

  for (const edge of graph.edges.slice(0, 10)) {
    expect(edge.source).toBeTruthy();
    expect(edge.target).toBeTruthy();
    expect(edge.relation).toBeTruthy();
    expect(typeof edge.confidence).toBe("number");
    expect("url" in edge).toBe(true);
    expect(edge.data_origin).toBeTruthy();
  }
  return graph;
}

test("network API returns graph envelope", async ({ request }) => {
  await expectGraphEnvelope(await request.get("/api/network/graph"));
});

test("network API supports source modes", async ({ request }) => {
  const file = await expectGraphEnvelope(await request.get("/api/network/graph?source=file"));
  expect(file.meta.resolved_source).toBe("file");
  expect(file.nodes.length).toBeGreaterThan(0);

  const auto = await expectGraphEnvelope(await request.get("/api/network/graph?source=auto"));
  expect(["database", "fallback_file"]).toContain(auto.meta.resolved_source);

  const hybrid = await expectGraphEnvelope(await request.get("/api/network/graph?source=hybrid"));
  expect(["hybrid", "database", "fallback_file"]).toContain(hybrid.meta.resolved_source);

  const databaseResponse = await request.get("/api/network/graph?source=database");
  const databaseStatus = databaseResponse.status();
  expect([200, 503]).toContain(databaseStatus);
  const database = await databaseResponse.json();
  if (databaseStatus === 200) {
    expect(database.meta.source_mode).toBe("database");
  } else {
    expect(typeof database.error).toBe("string");
    expect("meta" in database).toBe(false);
  }
});

test("network page renders graph UI and core controls", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(request.url());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/network");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: /relationship network/i })).toBeVisible();
  await expect(page.getByPlaceholder("Search node label...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset layout" })).toBeVisible();
  await expect(page.getByLabel("Label display")).toBeVisible();
  await expect(page.getByLabel("Graph density")).toBeVisible();
  await expect(page.getByRole("button", { name: "Focus mode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show filters" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show details" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrows" })).toBeVisible();
  await expect(page.getByLabel("Network data source")).toBeVisible();
  await expect(page.getByLabel("Interactive network graph")).toBeVisible({ timeout: 20000 });

  await page.getByLabel("Network data source").selectOption("file");
  await expect(page.getByText(/Data source: Import file/i)).toBeVisible({ timeout: 20000 });
  await page.getByLabel("Network data source").selectOption("auto");
  await expect(page.getByText(/Data source:/i)).toBeVisible({ timeout: 20000 });

  const graph = await (await page.request.get("/api/network/graph?source=file")).json();
  if (graph.nodes.length > 0) {
    await page.waitForFunction(() => document.querySelector("canvas") !== null, null, { timeout: 20000 });
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(box?.height ?? 0).toBeGreaterThan(200);

    await page.getByLabel("Label display").selectOption("off");
    const offLabelState = await page.evaluate(() => {
      const cy = (window as any).__networkCy;
      return {
        labels: cy.nodes(".show-label").length,
        firstLabel: cy.nodes()[0]?.style("label")
      };
    });
    expect(offLabelState.labels).toBe(0);
    expect(offLabelState.firstLabel).toBe("");

    await page.getByLabel("Label display").selectOption("all");
    const allLabelState = await page.evaluate(() => {
      const cy = (window as any).__networkCy;
      return {
        labels: cy.nodes(".show-label").length,
        nodeCount: cy.nodes().length,
        firstLabel: cy.nodes()[0]?.style("label"),
        arrowShape: cy.edges()[0]?.style("target-arrow-shape")
      };
    });
    expect(allLabelState.labels).toBe(allLabelState.nodeCount);
    expect(allLabelState.firstLabel).toBeTruthy();
    if (graph.edges.length > 0) expect(allLabelState.arrowShape).toBe("triangle");

    await page.getByLabel("Label display").selectOption("hover");
    const dragState = await page.evaluate(() => {
      const cy = (window as any).__networkCy;
      const node = cy.nodes()[0];
      node.emit("grab");
      node.position({ x: node.position("x") + 20, y: node.position("y") + 12 });
      node.emit("drag");
      node.emit("free");
      return {
        hasDraggingClass: node.hasClass("is-dragging"),
        dropped: node.hasClass("just-dropped"),
        nodeCount: cy.nodes().length
      };
    });
    expect(dragState.hasDraggingClass).toBe(false);
    expect(dragState.nodeCount).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Focus mode" }).click();
    await expect(page.getByLabel("Interactive network graph")).toBeVisible();
    await page.getByRole("button", { name: "Focus mode" }).click();
    await page.getByRole("button", { name: "Show details" }).click();

    const renderedLabel = await page.evaluate(() => {
      const cy = (window as any).__networkCy;
      return cy.nodes()[0]?.data("label") as string;
    });
    await page.getByPlaceholder("Search node label...").fill(renderedLabel);
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(page.getByText(renderedLabel, { exact: false })).toBeVisible({ timeout: 10000 });
  } else {
    await expect(page.getByText("No network relationships have been generated yet.")).toBeVisible();
  }

  expect(failedRequests).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("favicon"))).toEqual([]);
});

test("network page mobile layout does not overflow horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/network");
  await expect(page.getByPlaceholder("Search node label...")).toBeVisible({ timeout: 20000 });

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test("network page respects reduced motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/network");
  await page.locator("canvas").first().waitFor({ timeout: 20000 });
  const transitionDuration = await page.evaluate(() => {
    const cy = (window as any).__networkCy;
    return cy.nodes()[0]?.style("transition-duration");
  });
  expect([0, "0", "0ms", "0s"]).toContain(transitionDuration);
});
