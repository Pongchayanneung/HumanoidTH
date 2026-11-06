#!/usr/bin/env node
// Generate one image with the Gemini API and save it as a PNG.
// Usage: node .claude/team/bin/gemini-image.mjs <out.png> "<prompt>"
// Env:   GEMINI_API_KEY (required), GEMINI_IMAGE_MODEL (default below; override if renamed)
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const [out, ...rest] = process.argv.slice(2);
const prompt = rest.join(" ").trim();
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

if (!out || !prompt) {
  console.error('usage: gemini-image.mjs <out.png> "<prompt>"');
  process.exit(2);
}
if (!key) {
  console.error("GEMINI_API_KEY is not set; use the PROMPTS.md hand-off instead.");
  process.exit(3);
}

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  },
);
if (!res.ok) {
  console.error(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}
const json = await res.json();
const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
if (!part) {
  console.error("No image in response:", JSON.stringify(json).slice(0, 500));
  process.exit(1);
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, Buffer.from(part.inlineData.data, "base64"));
console.log(`saved ${out} (${part.inlineData.mimeType}, model ${model})`);
