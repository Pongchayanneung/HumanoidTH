import type { SearchContentType, SearchRecordKind, SearchResponse } from '../../lib/search/types';
export const contentTypes: SearchContentType[] = ['paper','repository','video','news_web','source','robot','contribution','perspective','inventory','relationship','entity'];
export function safeSourceUrl(value: string | null) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function validRanges(text: string, ranges: {start: number; end: number}[] = []) {
  let end = 0;
  const boundary = (n: number) => n <= 0 || n >= text.length || !(text.charCodeAt(n) >= 0xDC00 && text.charCodeAt(n) <= 0xDFFF && text.charCodeAt(n - 1) >= 0xD800 && text.charCodeAt(n - 1) <= 0xDBFF);
  return [...ranges].sort((a,b) => a.start-b.start).filter(range => { if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < end || range.start < 0 || range.end <= range.start || range.end > text.length || !boundary(range.start) || !boundary(range.end)) return false; end = range.end; return true; });
}
export async function searchClient(query: string, type: SearchContentType | '', signal: AbortSignal): Promise<SearchResponse> {
  const kind = contentTypes.slice(0, 5).includes(type as SearchContentType) ? 'source' : type as SearchRecordKind;
  const response = await fetch('/api/search', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({query, ...(type ? {types: [kind]} : {})}), signal});
  if (!response.ok) throw new Error('Search unavailable');
  return response.json();
}
