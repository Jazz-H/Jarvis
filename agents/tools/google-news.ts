// Google News RSS (no key). Plain code: fetch, parse, drop old/blocked/duplicate stories.
// Headline text is untrusted data: it is only ever passed to a model inside a data block.
import { XMLParser } from "fast-xml-parser";
import { NewsCandidate } from "../schemas/news.ts";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", htmlEntities: true });

const text = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "#text" in v ? String((v as any)["#text"]) : "";

// Google News titles end in " - Source"; drop that when it matches the <source> tag
export function splitTitle(raw: string, source: string): string {
  const t = raw.trim();
  const suffix = ` - ${source}`;
  return source && t.endsWith(suffix) ? t.slice(0, -suffix.length).trim() : t;
}

export function parseFeed(xml: string, topic: string): Omit<NewsCandidate, "id">[] {
  const doc = parser.parse(xml);
  let items = doc?.rss?.channel?.item ?? [];
  if (!Array.isArray(items)) items = [items];
  const out: Omit<NewsCandidate, "id">[] = [];
  for (const it of items) {
    const source = text(it?.source).trim() || "Google News";
    const title = splitTitle(text(it?.title), source);
    const link = text(it?.link).trim();
    const published = new Date(text(it?.pubDate));
    if (!title || !/^https?:\/\//.test(link) || Number.isNaN(published.getTime())) continue;
    out.push({
      topic,
      title: title.slice(0, 300),
      source: source.slice(0, 80),
      link,
      published: published.toISOString(),
    });
  }
  return out;
}

export const titleKey = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);

export interface NewsQuery {
  topics: Record<string, string>; // topic -> RSS URL
  blockedKeywords: string[];
  perTopic: number;
  maxAgeHours: number;
  now?: Date;
}

export interface NewsFetchResult {
  candidates: NewsCandidate[];
  failedTopics: string[];
}

export async function fetchNews(q: NewsQuery, fetchImpl: typeof fetch = fetch): Promise<NewsFetchResult> {
  const now = q.now ?? new Date();
  const blocked = q.blockedKeywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
  const topics = Object.entries(q.topics);
  const feeds = await Promise.all(
    topics.map(async ([topic, url]) => {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { topic, items: parseFeed(await res.text(), topic) };
      } catch {
        return { topic, items: null };
      }
    }),
  );
  const seen = new Set<string>();
  const candidates: NewsCandidate[] = [];
  const failedTopics: string[] = [];
  for (const { topic, items } of feeds) {
    if (!items) {
      failedTopics.push(topic);
      continue;
    }
    let kept = 0;
    const fresh = items
      .filter((s) => now.getTime() - Date.parse(s.published) <= q.maxAgeHours * 3600_000)
      .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    for (const s of fresh) {
      if (kept >= q.perTopic) break;
      const hay = `${s.title} ${s.source}`.toLowerCase();
      if (blocked.some((k) => hay.includes(k))) continue;
      const key = titleKey(s.title);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(NewsCandidate.parse({ ...s, id: `${topic}-${++kept}` }));
    }
  }
  return { candidates, failedTopics };
}
