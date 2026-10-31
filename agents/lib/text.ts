// Code checks on model-written text: no links, one line of plain text, capped.
// Used on the Weekly Review (review.ts) and Ask answers (ask.ts).

export const URLISH = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi;

// Links removed, whitespace collapsed, cut to n characters
export const tidy = (s: string, n: number) => s.replace(URLISH, "").replace(/\s+/g, " ").trim().slice(0, n);

// Like tidy, and also takes out Markdown the app would show literally: [label](link) keeps the
// label, emphasis and code marks, headings, quote marks and list markers go. Paragraph breaks
// (a blank line) are kept as one newline so a longer answer stays readable.
export function plainText(s: string, n: number): string {
  const out = String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(URLISH, "")
    .replace(/<[^>]{0,200}>/g, "") // stray HTML tags (the app escapes anyway)
    .replace(/(\*\*|__|`+|~~)/g, "")
    .replace(/(^|\s)[*_](\S[^*_\n]*\S|\S)[*_](?=\s|[.,;:!?]|$)/g, "$1$2")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+•]\s+|\d{1,2}[.)]\s+)/, "")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return out.slice(0, n).trim();
}

// Calendar text (titles, places) for jazz2-calendar.json and Ask: control and bidi characters,
// links and email addresses taken out, whitespace collapsed, cut to n characters without
// splitting a surrogate pair.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
const EMAILISH = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;
export function eventText(s: unknown, n: number): string {
  let out = String(s ?? "")
    .replace(CONTROLS, " ")
    .replace(URLISH, "")
    .replace(EMAILISH, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
  if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);
  return out.trim();
}
