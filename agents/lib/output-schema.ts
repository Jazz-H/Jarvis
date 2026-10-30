// Turns a zod schema into the JSON Schema sent as the agent's output format. Structured outputs
// don't support every constraint keyword, so length/range limits are stripped here and enforced
// afterwards by zod (an output that breaks them counts as invalid and is retried once).
import { z } from "zod";

const UNSUPPORTED = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "$schema",
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.has(k)) continue;
    out[k] =
      k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([p, s]) => [p, strip(s)])) : strip(v);
  }
  return out;
}

export function outputSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}
