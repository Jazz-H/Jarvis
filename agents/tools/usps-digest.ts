// USPS Informed Delivery's Daily Digest: plain code reads who each inbound package is from and when
// USPS expects it. Its snippet only says "1 inbound package(s) arriving soon", so a model would
// guess. No digest text goes to a model, and only a tracking number's last 4 digits are kept.
export type DigestBucket = "today" | "soon" | "awaiting";
export interface DigestPackage {
  from: string | null;
  last4: string;
  bucket: DigestBucket;
}

const BUCKETS: Record<string, DigestBucket | null> = {
  "expected today": "today",
  "expected 1-2 days": "soon",
  "awaiting from sender": "awaiting",
  outbound: null, // what you're sending
};

// By the From address too: a display name and subject are easy to fake. The header isn't proof of
// who sent it, but mail forging a usps.com address has to get past Gmail's own sender checks first.
export const isDigest = (m: { from: string; subject: string; address: string }) =>
  /informed delivery/i.test(m.from) &&
  /daily digest/i.test(m.subject) &&
  /^[^\s@,<>"]+@([a-z0-9-]+\.)*usps\.com$/.test(m.address);

export function parseDigest(text: string): DigestPackage[] {
  const at = text.indexOf("PACKAGES"); // the MAIL section above it has its own "Expected Today"
  if (at < 0) return [];
  const body = text.slice(at);
  const heads = [
    ...body.matchAll(/(Expected Today|Expected 1-2 Days|Awaiting From Sender|Outbound)\s+\d+\s+item\(s\)/gi),
  ];
  const out: DigestPackage[] = [];
  heads.forEach((h, i) => {
    const bucket = BUCKETS[h[1].toLowerCase()];
    if (!bucket) return;
    const section = body.slice(h.index + h[0].length, heads[i + 1]?.index ?? body.length);
    // each package shows its tracking number twice, after FROM: when USPS knows the sender
    for (const m of section.matchAll(/(?:FROM:\s*(.{1,60}?)\s+)?\b([A-Z0-9]{10,34})\s+\2\b/g))
      out.push({ from: m[1]?.trim() || null, last4: m[2].slice(-4), bucket });
  });
  return out.slice(0, 8);
}
