import type { SourceType } from "../../generated/prisma";
import type { IngestResult, NormalizedSource } from "@/lib/ingest/types";
import { saveSources } from "@/lib/ingest/save";

type AdapterInput = {
  query: string;
  limit?: number;
  days?: number;
  fromYear?: number;
};

async function finish(adapter: SourceType, query: string, records: NormalizedSource[], missingKeys: string[] = []): Promise<IngestResult> {
  return {
    adapter,
    query,
    recordsFound: records.length,
    recordsSaved: records.length ? await saveSources(records) : 0,
    missingKeys
  };
}

export async function ingestOpenAlex({ query, limit = 25, fromYear = 2015 }: AdapterInput) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("filter", `from_publication_date:${fromYear}-01-01`);
  url.searchParams.set("per-page", String(Math.min(limit, 50)));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`OpenAlex ${response.status}`);
  const payload = await response.json();

  const records: NormalizedSource[] = (payload.results ?? []).map((work: any) => ({
    sourceType: "OPENALEX",
    title: work.display_name ?? "Untitled OpenAlex work",
    url: work.doi ?? work.id,
    excerpt: work.abstract_inverted_index ? "OpenAlex abstract metadata available." : "",
    publishedAt: work.publication_date
      ? new Date(work.publication_date)
      : (work.publication_year ? new Date(`${work.publication_year}-01-01`) : null),
    platform: "openalex",
    rawMeta: {
      openalexId: work.id,
      query,
      publicationDatePrecision: work.publication_date ? "day" : (work.publication_year ? "year" : "unknown")
    }
  }));

  return finish("OPENALEX", query, records);
}

export async function ingestGithub({ query, limit = 25 }: AdapterInput) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(Math.min(limit, 100)));

  const headers: HeadersInit = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const payload = await response.json();

  const records: NormalizedSource[] = (payload.items ?? []).map((repo: any) => ({
    sourceType: "GITHUB",
    title: repo.full_name,
    url: repo.html_url,
    excerpt: repo.description ?? "",
    author: repo.owner?.login ?? null,
    platform: "github",
    rawMeta: { stars: repo.stargazers_count, language: repo.language, query }
  }));

  return finish("GITHUB", query, records, token ? [] : ["GITHUB_TOKEN optional"]);
}

export async function ingestGdelt({ query, limit = 25, days = 30 }: AdapterInput) {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(Math.min(limit, 250)));
  url.searchParams.set("timespan", `${days}d`);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`GDELT ${response.status}`);
  const payload = await response.json();

  const records: NormalizedSource[] = (payload.articles ?? []).map((article: any) => ({
    sourceType: "GDELT",
    title: article.title ?? "Untitled GDELT article",
    url: article.url,
    excerpt: article.snippet ?? "",
    publishedAt: article.seendate ? new Date(article.seendate) : null,
    platform: article.domain ?? "gdelt",
    rawMeta: { query, source: article }
  }));

  return finish("GDELT", query, records);
}

export async function ingestYoutube({ query, limit = 25 }: AdapterInput) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return finish("YOUTUBE", query, [], ["YOUTUBE_API_KEY"]);
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(Math.min(limit, 50)));
  url.searchParams.set("key", key);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`YouTube ${response.status}`);
  const payload = await response.json();

  const records: NormalizedSource[] = (payload.items ?? []).map((item: any) => ({
    sourceType: "YOUTUBE",
    title: item.snippet?.title ?? "Untitled YouTube video",
    url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    excerpt: item.snippet?.description ?? "",
    publishedAt: item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null,
    author: item.snippet?.channelTitle ?? null,
    platform: "youtube",
    rawMeta: { query, videoId: item.id?.videoId }
  }));

  return finish("YOUTUBE", query, records);
}

export async function runAdapter(adapter: SourceType, input: AdapterInput) {
  switch (adapter) {
    case "OPENALEX":
      return ingestOpenAlex(input);
    case "GITHUB":
      return ingestGithub(input);
    case "GDELT":
      return ingestGdelt(input);
    case "YOUTUBE":
      return ingestYoutube(input);
    default:
      throw new Error(`Adapter ${adapter} is not implemented for API pulling yet.`);
  }
}
