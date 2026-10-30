// Reads jazz2-reviews.json. Shared by the Weekly Review (review.ts) and the Ask context.
import { WeeklyReview } from "../schemas/review.ts";

// The stored reviews that still pass the schema (anything else is dropped, never trusted)
export function readReviews(raw: string | null): { reviews: WeeklyReview[]; junk: boolean } {
  if (!raw) return { reviews: [], junk: false };
  let j: any;
  try {
    j = JSON.parse(raw);
  } catch {
    return { reviews: [], junk: true };
  }
  const list = Array.isArray(j?.reviews) ? j.reviews.slice(0, 50) : [];
  const reviews: WeeklyReview[] = [];
  for (const r of list) {
    const p = WeeklyReview.safeParse(r);
    if (p.success && !reviews.some((x) => x.id === p.data.id)) reviews.push(p.data);
  }
  return { reviews, junk: reviews.length < list.length || !Array.isArray(j?.reviews) };
}
