// Tracking links for Deliveries. Code finds a tracking number (or an Amazon order number) in a
// package's own emails and builds the link to the carrier's tracking page itself: a link inside an
// email is never used (email text is untrusted, and a link could point anywhere). Only these hosts.
// FedEx and DHL numbers are plain digits, like order numbers, so they only count from those carriers'
// own emails and next to the word "tracking". js/jarvis.js checks the host again (TRACK_HOSTS).

export const TRACK_HOSTS = [
  "www.ups.com",
  "tools.usps.com",
  "www.fedex.com",
  "www.dhl.com",
  "www.amazon.com",
  "informeddelivery.usps.com",
];

const TEMPLATES: Record<string, (n: string) => string> = {
  UPS: (n) => `https://www.ups.com/track?tracknum=${n}`,
  USPS: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  FedEx: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  DHL: (n) => `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}`,
};
// USPS's Informed Delivery dashboard, for the daily digest's packages (it keeps only the last 4 digits)
export const USPS_DASHBOARD = "https://informeddelivery.usps.com/box/pages/secure/DashboardAction_input.action";
const AMAZON_ORDERS = "https://www.amazon.com/gp/css/order-history";

const UPS = /\b(1Z[0-9A-Z]{16})\b/i;
const USPS = /\b(9[2-5]\d{20}(?:\d{4})?|[A-Z]{2}\d{9}US)\b/;
const NEAR_TRACKING = (digits: string) =>
  new RegExp(String.raw`track(?:ing)?(?:\s*(?:number|no\.?|#|id))?[^0-9A-Za-z]{0,6}(?:is\s+)?(${digits})\b`, "i");
const FEDEX = NEAR_TRACKING(String.raw`\d{12}|\d{15}|\d{20}|\d{22}`);
const DHL = NEAR_TRACKING(String.raw`\d{10}`);
const AMAZON_ORDER = /\b(\d{3}-\d{7}-\d{7})\b/;

// texts: the package's emails (subject, snippet and body); carrier: from its senders (carrierOf)
export function trackingLink(texts: string[], carrier: string | null): string | null {
  const all = texts.join("\n");
  const ups = UPS.exec(all);
  if (ups) return TEMPLATES.UPS(ups[1].toUpperCase());
  const usps = USPS.exec(all);
  if (usps) return TEMPLATES.USPS(usps[1]);
  if (carrier === "FedEx") {
    const m = FEDEX.exec(all);
    if (m) return TEMPLATES.FedEx(m[1]);
  }
  if (carrier === "DHL") {
    const m = DHL.exec(all);
    if (m) return TEMPLATES.DHL(m[1]);
  }
  if (carrier === "Amazon") {
    const m = AMAZON_ORDER.exec(all);
    return m ? `https://www.amazon.com/gp/your-account/order-details?orderID=${m[1]}` : AMAZON_ORDERS;
  }
  return null;
}
