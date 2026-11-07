import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

// Shared Server Actions can be invoked from every application page. Verify the
// actual production artifacts, rather than only the next.config glob itself.
const root = resolve(".next/server/app");
async function pageTraces(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await pageTraces(path));
    else if (entry.name === "page.js.nft.json") found.push(path);
  }
  return found;
}

const traces = await pageTraces(root);
assert.ok(traces.length > 0, "Run the production build before checking authentication traces");
for (const trace of traces) {
  const { files } = JSON.parse(await readFile(trace, "utf8")) as { files: string[] };
  const paths = files.map(file => file.replaceAll("\\", "/"));
  const label = relative(root, trace);
  for (const name of ["package.json", "schema.prisma"]) {
    assert.ok(paths.some(file => file.endsWith(`/generated/prisma/${name}`)), `${label}: missing generated Prisma ${name}`);
  }
  assert.ok(paths.some(file => /\/generated\/prisma\/(?:lib)?query_engine[^/]*\.node$/.test(file)), `${label}: missing generated Prisma native engine`);
}
console.log(`Authentication runtime assets traced for ${traces.length} application pages.`);
