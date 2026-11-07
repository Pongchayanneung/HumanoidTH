import { createHash } from "node:crypto";
import type { LanguageTag, SearchEvidence } from "./types";
import { MAX_BODY_CODE_POINTS, KNOWN_PLACEHOLDERS, isKnownPlaceholder } from "./policy";

export { MAX_BODY_CODE_POINTS, KNOWN_PLACEHOLDERS, isKnownPlaceholder };

/**
 * Cleans substantive excerpt text:
 * - Omits known placeholders and boilerplates
 * - Normalizes excessive whitespace
 * - Caps substantive excerpt at 2,000 Unicode code points
 */
export function cleanSearchText(text: string | null | undefined): {
  cleanedText: string;
  isPlaceholderOmitted: boolean;
  isTruncated: boolean;
} {
  if (!text) {
    return { cleanedText: "", isPlaceholderOmitted: false, isTruncated: false };
  }

  const trimmed = text.trim();

  // Check if the text matches or begins with known placeholders
  if (isKnownPlaceholder(trimmed)) {
    return { cleanedText: "", isPlaceholderOmitted: true, isTruncated: false };
  }

  // Normalize excessive whitespace
  const normalized = trimmed.replace(/\s+/g, " ");

  // Count and slice by Unicode code points rather than raw bytes/utf16 code units
  const codePoints = Array.from(normalized);
  const isTruncated = codePoints.length > MAX_BODY_CODE_POINTS;
  const cleanedText = isTruncated
    ? codePoints.slice(0, MAX_BODY_CODE_POINTS).join("")
    : normalized;

  return { cleanedText, isPlaceholderOmitted: false, isTruncated };
}

/**
 * Detects whether a string is primarily Thai, English, or Mixed.
 */
export function detectLanguage(text: string): LanguageTag {
  if (!text || !text.trim()) {
    return "unknown";
  }

  const thaiCount = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latinCount = (text.match(/[a-zA-Z]/g) || []).length;

  if (thaiCount > 5 && latinCount > 5) {
    return "mixed";
  }
  if (thaiCount > 0) {
    return "th";
  }
  if (latinCount > 0) {
    return "en";
  }

  return "unknown";
}

/**
 * Computes a deterministic SHA-256 hash of public searchable fields.
 * Used for drift detection, current-record revalidation, and caching.
 */
export function computeContentHash(data: {
  typedId: string;
  title: string;
  body: string;
  url: string | null;
  metadata?: Record<string, unknown>;
}): string {
  const metaString = data.metadata ? JSON.stringify(data.metadata) : "";
  return createHash("sha256")
    .update(`${data.typedId}::${data.title}::${data.body}::${data.url ?? ""}::${metaString}`)
    .digest("hex");
}

/**
 * Computes a deterministic SHA-256 hash of dependent parent/joined fields.
 */
export function computeDependencyHash(parentTypedId: string | null, parentState: string = ""): string {
  return createHash("sha256")
    .update(`${parentTypedId ?? "none"}::${parentState}`)
    .digest("hex");
}

/**
 * Creates evidence with exact UTF-16 offset ranges into the original text.
 */
export function createSearchEvidence(params: {
  fieldName: string;
  originalText: string;
  label: string;
  isTitleOnly?: boolean;
  isTruncated?: boolean;
}): SearchEvidence {
  const coverage = params.isTitleOnly
    ? "title-only"
    : params.isTruncated
      ? "partial"
      : "full";

  return {
    fieldName: params.fieldName,
    originalText: params.originalText,
    label: params.label,
    coverage,
    startOffset: 0,
    endOffset: params.originalText.length
  };
}
