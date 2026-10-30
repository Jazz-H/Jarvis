import { z } from "zod";

export const PackageStatus = z.enum(["ordered", "shipped", "out", "delivered"]);
export type PackageStatus = z.infer<typeof PackageStatus>;

// What the Shopper sub-agent returns from Amazon order/shipping emails
export const DeliveryRead = z.object({
  packages: z
    .array(
      z.object({
        ids: z.array(z.string()).min(1).max(6), // the emails this package came from (m1, m2…)
        item: z.string().min(1).max(80), // short item name
        status: PackageStatus,
        eta: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        etaText: z.string().max(40).nullable(), // e.g. "by 8 PM"
      }),
    )
    .max(8),
});
export type DeliveryRead = z.infer<typeof DeliveryRead>;

export const DeliveryCard = z.object({
  packages: z
    .array(
      z.object({
        item: z.string(),
        status: PackageStatus,
        eta: z.string().nullable(),
        etaText: z.string().nullable(),
        shoppingMatch: z.string().nullable(), // the Shopping item it matches (from code)
      }),
    )
    .max(8),
});
export type DeliveryCard = z.infer<typeof DeliveryCard>;
