import { describe, it, expect } from "vitest";
import { trackingLink, TRACK_HOSTS, USPS_DASHBOARD } from "../lib/tracking.ts";
import { samePackage, withoutHidden } from "../lib/brain.ts";

describe("tracking links (built by code from a number in the package's emails)", () => {
  it("finds UPS and USPS numbers anywhere, and builds the carrier's own link", () => {
    expect(trackingLink(["Your package 1z999aa10123456784 is on the way"], "Target")).toBe(
      "https://www.ups.com/track?tracknum=1Z999AA10123456784",
    );
    expect(trackingLink(["Tracking: 9400111899223197428490"], "USPS")).toBe(
      "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490",
    );
  });
  it("never uses a link from the email itself", () => {
    const link = trackingLink(["Track it here: https://evil.example/track?n=1Z999AA10123456784"], "UPS");
    expect(link).toBe("https://www.ups.com/track?tracknum=1Z999AA10123456784");
    expect(trackingLink(["Track it here: https://evil.example/track"], "Chewy")).toBeNull();
  });
  it("takes FedEx and DHL digits only from those carriers, next to 'tracking'", () => {
    expect(trackingLink(["Tracking number: 123456789012"], "FedEx")).toBe(
      "https://www.fedex.com/fedextrack/?trknbr=123456789012",
    );
    expect(trackingLink(["Order number: 123456789012"], "FedEx")).toBeNull();
    expect(trackingLink(["Tracking number: 123456789012"], "Best Buy")).toBeNull();
    expect(trackingLink(["Your DHL tracking # 1234567890"], "DHL")).toBe(
      "https://www.dhl.com/us-en/home/tracking.html?tracking-id=1234567890",
    );
  });
  it("Amazon: the order's page when there's an order number, else the orders list", () => {
    expect(trackingLink(["Your Amazon.com order #113-4567890-1234567 has shipped"], "Amazon")).toBe(
      "https://www.amazon.com/gp/your-account/order-details?orderID=113-4567890-1234567",
    );
    expect(trackingLink(["Arriving today"], "Amazon")).toBe("https://www.amazon.com/gp/css/order-history");
  });
  it("every link is https on an allowed host", () => {
    for (const u of [
      trackingLink(["1Z999AA10123456784"], null),
      trackingLink(["9400111899223197428490"], null),
      trackingLink(["Tracking number: 123456789012"], "FedEx"),
      trackingLink(["tracking 1234567890"], "DHL"),
      trackingLink(["x"], "Amazon"),
      USPS_DASHBOARD,
    ]) {
      const url = new URL(u as string);
      expect(url.protocol).toBe("https:");
      expect(TRACK_HOSTS).toContain(url.hostname);
    }
  });
});

describe("a dismissed package stays hidden when a later run renames it", () => {
  it("every word of the shorter name in the longer, two words at least", () => {
    expect(samePackage("Busy Bone dog treats", "Busy Bone Stufd variety pack dog treats")).toBe(true);
    expect(samePackage("Busy Bone Stufd variety pack dog treats", "Busy Bone dog treats")).toBe(true);
    expect(samePackage("Milk-Bone dog treats", "Busy Bone dog treats")).toBe(false);
    expect(samePackage("Treats", "Busy Bone dog treats")).toBe(false); // one word isn't enough
    // what happened on Nov 5: dismissed under one name, renamed by the 9 PM refresh
    expect(
      samePackage("Busy Bone Stufd dog treats, Chewy order #5240864417", "Busy Bone Stufd variety pack dog treats"),
    ).toBe(true);
  });
  it("withoutHidden uses it", () => {
    const pkgs = [{ item: "Busy Bone Stufd variety pack dog treats" }, { item: "Milk-Bone dog treats" }];
    expect(withoutHidden(pkgs, ["busy bone dog treats"]).map((p) => p.item)).toEqual(["Milk-Bone dog treats"]);
  });
});
