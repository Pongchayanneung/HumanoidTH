import { FROZEN_SEMANTIC_POLICY, isProfileCompatibleWithPolicy, type SemanticRetrievalPolicy } from "./semantic-policy";
import { cosineSimilarity, l2Normalize } from "./vector-io";
import type { ModelProfile } from "./vector-types";

/**
 * Atlas Search ranking (F5). Pure functions only: no network, no model call, no I/O.
 * Scores and similarities are internal; callers must not put them in a response.
 */

const segmenter = new Intl.Segmenter("th", { granularity: "word" });
// NFKC splits Thai sara am (U+0E33) into U+0E4D U+0E32; recompose it so segmentation and keys agree
// whichever form the text or the request arrived in.
const SARA_AM_PARTS = /\u0E4D\u0E32/g;
const fold = (text: string) => text.normalize("NFKC").toLowerCase().replace(SARA_AM_PARTS, "\u0E33");

// Function words are excluded from lexical eligibility only. The query copy sent to an
// embedding model keeps them, and keeps negation, so the full request is still embedded.
const NEGATIONS = new Set(["no", "not", "non", "never", "without", "cannot", "don't", "doesn't", "isn't", "aren't", "can't", "won't", "ไม่", "ไม่มี", "ปราศจาก", "ไร้"]);
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "with", "by", "from", "as", "is", "are", "was", "were", "be",
  "that", "this", "it", "its", "about", "into", "which", "what", "who", "how",
  "ที่", "ของ", "และ", "ใน", "ซึ่ง", "หรือ", "กับ", "เป็น", "จาก", "โดย", "ให้", "ได้", "แก่", "นี้", "นั้น",
]);

export interface WordSegment { norm: string; start: number; end: number }

/** Word segments of the ORIGINAL text. `start`/`end` are UTF-16 offsets into `text`; `norm` is the folded form used for matching. */
export function wordSegments(text: string): WordSegment[] {
  // Segment a copy with sara am recomposed, and map offsets back to the original (identity when nothing changed).
  const offsets: number[] = [];
  let canon = "";
  for (let i = 0; i < text.length; i++) {
    const merges = text.startsWith("\u0E4D\u0E32", i);
    canon += merges ? "\u0E33" : text[i];
    offsets.push(i);
    if (merges) i++;
  }
  offsets.push(text.length);
  const out: WordSegment[] = [];
  for (const part of segmenter.segment(canon)) {
    if (part.isWordLike) out.push({ norm: fold(part.segment), start: offsets[part.index], end: offsets[part.index + part.segment.length] });
  }
  return out;
}

export interface PreparedQuery {
  /** Normalized copy for an embedding model: NFKC, collapsed whitespace, case folded. Negation words are kept. */
  embeddingText: string;
  /** Every word of the request, folded, in order (used for exact title/name comparison). */
  words: string[];
  /** Distinct meaningful words: function words and negation words removed. Lexical eligibility only. */
  tokens: string[];
  hasNegation: boolean;
  /** Blank or generic-only: there is nothing to match, so the response is a labelled browse view. */
  isBrowse: boolean;
}

export function prepareQuery(raw: string): PreparedQuery {
  const words = wordSegments(raw).map((segment) => segment.norm);
  const tokens = Array.from(new Set(words.filter((word) => !FUNCTION_WORDS.has(word) && !NEGATIONS.has(word))));
  return {
    embeddingText: fold(raw).replace(/\s+/g, " ").trim(),
    words,
    tokens,
    hasNegation: words.some((word) => NEGATIONS.has(word)),
    isBrowse: tokens.length === 0,
  };
}

export interface KeywordItem { id: string; title: string; texts: string[] }
export interface KeywordHit { id: string; exactTitle: boolean; evidenceIndex: number; ranges: { start: number; end: number }[]; score: number }

/**
 * Lexical match of one record. `texts` are the displayable evidence texts; the one equal to
 * `title` is the title field (weight 4), the rest are body fields (weight 1). A record only
 * qualifies through a meaningful query word found in text it can actually show.
 */
export function keywordMatch(query: PreparedQuery, item: KeywordItem, weights = FROZEN_SEMANTIC_POLICY.lexicalWeights): KeywordHit | null {
  if (query.isBrowse) return null;
  const wanted = new Set(query.tokens);
  const fields = item.texts.map((text) => {
    const segments = wordSegments(text);
    return { text, segments, found: new Set(segments.map((segment) => segment.norm).filter((norm) => wanted.has(norm))) };
  });
  const titleFound = new Set<string>();
  const bodyFound = new Set<string>();
  fields.forEach((field) => field.found.forEach((norm) => (field.text === item.title ? titleFound : bodyFound).add(norm)));
  if (titleFound.size + bodyFound.size === 0) return null;

  let evidenceIndex = -1;
  let best = 0;
  fields.forEach((field, index) => {
    const priority = field.found.size * (field.text === item.title ? weights.title : weights.body);
    if (priority > best) { best = priority; evidenceIndex = index; }
  });
  const chosen = fields[evidenceIndex];
  const ranges: { start: number; end: number }[] = [];
  for (const segment of chosen.segments) {
    if (!wanted.has(segment.norm)) continue;
    const last = ranges[ranges.length - 1];
    if (last && /^\s*$/.test(chosen.text.slice(last.end, segment.start))) last.end = segment.end;
    else ranges.push({ start: segment.start, end: segment.end });
  }
  const titleWords = wordSegments(item.title).map((segment) => segment.norm);
  const exactTitle = titleWords.length > 0 && titleWords.length === query.words.length && titleWords.every((word, i) => word === query.words[i]);
  return { id: item.id, exactTitle, evidenceIndex, ranges, score: (weights.title * titleFound.size + weights.body * bodyFound.size) / query.tokens.length };
}

/** Keyword ranking: exact full title/name first, then weighted score; ties keep input order. */
export function rankKeyword(query: PreparedQuery, items: KeywordItem[], weights = FROZEN_SEMANTIC_POLICY.lexicalWeights): KeywordHit[] {
  return items
    .map((item) => keywordMatch(query, item, weights))
    .filter((hit): hit is KeywordHit => hit !== null)
    .sort((a, b) => Number(b.exactTitle) - Number(a.exactTitle) || b.score - a.score);
}

export interface SemanticCandidate { id: string; vector: Float32Array | null | undefined }
export type SemanticRanking = { status: "unavailable"; ranked: [] } | { status: "available"; ranked: string[]; compatibleCount: number };

/**
 * Exact cosine retrieval over caller-supplied vectors. The caller applies the type filter
 * first and supplies the query vector; this never embeds anything. Semantic retrieval is
 * `unavailable` for an incompatible profile, a query vector of the wrong size, or when no
 * candidate has a compatible vector. Admission uses the policy cutoff, which is provisional
 * and uncalibrated until F8 measures it with a real model.
 */
export function semanticRank(input: {
  queryVector: Float32Array | null | undefined;
  candidates: SemanticCandidate[];
  profile: ModelProfile | null | undefined;
  policy?: SemanticRetrievalPolicy;
}): SemanticRanking {
  const policy = input.policy ?? FROZEN_SEMANTIC_POLICY;
  const { profile, queryVector } = input;
  const unavailable: SemanticRanking = { status: "unavailable", ranked: [] };
  if (!profile || !isProfileCompatibleWithPolicy(profile, policy) || !queryVector || queryVector.length !== profile.dimensions) return unavailable;
  let query: Float32Array;
  try { query = l2Normalize(queryVector); } catch { return unavailable; }
  const scored: { id: string; similarity: number }[] = [];
  let compatibleCount = 0;
  for (const { id, vector } of input.candidates) {
    if (!vector || vector.length !== profile.dimensions) continue;
    // Candidates are normalized here, so a stored vector of any magnitude compares by direction only.
    // A zero-norm or non-finite candidate has no direction and is skipped.
    let unit: Float32Array;
    try { unit = l2Normalize(vector); } catch { continue; }
    const similarity = cosineSimilarity(query, unit);
    if (!Number.isFinite(similarity)) continue;
    compatibleCount++;
    if (similarity >= policy.semanticCutoffThreshold) scored.push({ id, similarity });
  }
  if (compatibleCount === 0) return unavailable;
  scored.sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
  return { status: "available", ranked: scored.map((item) => item.id), compatibleCount };
}

/**
 * Semantic-first order for the demo policy. The pilot evaluation found semantic ranking beat the
 * keyword/RRF blend and that only the semantic cutoff can suppress unrelated queries, so ids the
 * cutoff did not admit are dropped. An exact full title/name keyword match is kept in front.
 * Returns each id once, with members of a group adjacent.
 */
export function semanticFirstRanking(
  keyword: KeywordHit[],
  semanticIds: string[],
  groupOf: (id: string) => string = (id) => id,
): string[] {
  const ids = Array.from(new Set([...keyword.filter((hit) => hit.exactTitle).map((hit) => hit.id), ...semanticIds]));
  const members = new Map<string, string[]>();
  for (const id of ids) members.set(groupOf(id), [...(members.get(groupOf(id)) ?? []), id]);
  return Array.from(members.values()).flat();
}

/**
 * Reciprocal rank fusion: sum of 1 / (k + rank) over the top candidates of each branch.
 * Ranks are taken over groups (`groupOf`, identity by default): in each branch a group is
 * ranked by its best-ranked member, so extra copies of one identity cannot take branch ranks or
 * cap slots, or change the fused score or order of any other group. An exact full title/name
 * match keeps priority over the fused order. All matching members of admitted groups are kept.
 * The result lists each record id once, with
 * the members of a group adjacent and groups in fused order.
 */
export function fuseRankings(
  keyword: KeywordHit[],
  semanticIds: string[],
  policy: SemanticRetrievalPolicy = FROZEN_SEMANTIC_POLICY,
  groupOf: (id: string) => string = (id) => id,
): string[] {
  const { rrfConstantK: k, limits } = policy;
  const keywordIds = keyword.map((hit) => hit.id);
  // Members of each group in first-seen order (keyword branch, then semantic branch), each id once.
  const members = new Map<string, string[]>();
  for (const id of [...keywordIds, ...semanticIds]) {
    const group = groupOf(id);
    const list = members.get(group);
    if (!list) members.set(group, [id]);
    else if (!list.includes(id)) list.push(id);
  }
  const groupRanking = (ids: string[]) => Array.from(new Set(ids.map(groupOf)));
  const keywordGroups = groupRanking(keywordIds);
  const semanticGroups = groupRanking(semanticIds);
  const rrf = new Map<string, number>();
  const addBranch = (groups: string[]) => groups.slice(0, limits.candidatesPerBranch).forEach((group, i) => rrf.set(group, (rrf.get(group) ?? 0) + 1 / (k + i + 1)));
  addBranch(keywordGroups);
  addBranch(semanticGroups);
  const exact = new Set(keyword.filter((hit) => hit.exactTitle).map((hit) => groupOf(hit.id)));
  const fused = Array.from(rrf.keys()).sort((a, b) => Number(exact.has(b)) - Number(exact.has(a)) || rrf.get(b)! - rrf.get(a)!);
  const seen = new Set(rrf.keys());
  const overflow: string[] = [];
  for (const group of [...keywordGroups, ...semanticGroups]) {
    if (!seen.has(group)) {
      seen.add(group);
      overflow.push(group);
    }
  }
  return [...fused, ...overflow].flatMap((group) => members.get(group)!);
}
