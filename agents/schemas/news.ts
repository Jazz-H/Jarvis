import { z } from "zod";

// A headline as code fetched it (tools/google-news.ts). Links come only from here.
export const NewsCandidate = z.object({
  id: z.string(),
  topic: z.string(),
  title: z.string(),
  source: z.string(),
  link: z.url({ protocol: /^https?$/ }),
  published: z.string(), // ISO
});
export type NewsCandidate = z.infer<typeof NewsCandidate>;

// What the News sub-agent returns: which candidates, in what order, and a short summary.
export const NewsPicks = z.object({
  stories: z
    .array(z.object({ id: z.string(), summary: z.string().min(1).max(320) }))
    .min(1)
    .max(8),
});
export type NewsPicks = z.infer<typeof NewsPicks>;

export const NewsStory = NewsCandidate.extend({ summary: z.string() });
export const NewsCard = z.object({ stories: z.array(NewsStory).min(1).max(8) });
export type NewsCard = z.infer<typeof NewsCard>;
