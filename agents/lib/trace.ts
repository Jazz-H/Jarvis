// A per-agent trace saved as a workflow artifact. Inputs are never recorded, only sizes, counts,
// timings and errors, and anything shaped like a credential is scrubbed before it's kept.

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

export function redact(s: string, secrets: string[] = []): string {
  let out = s;
  for (const v of secrets) if (v && v.length >= 8) out = out.split(v).join("[redacted]");
  for (const p of SECRET_PATTERNS) out = out.replace(p, "[redacted]");
  return out;
}

export interface TraceEvent {
  at: string;
  agent: string;
  event: string;
  detail?: Record<string, string | number | boolean | null>;
}

export class Trace {
  readonly events: TraceEvent[] = [];
  constructor(private secrets: string[] = []) {}

  log(agent: string, event: string, detail?: TraceEvent["detail"]) {
    const clean = detail
      ? Object.fromEntries(
          Object.entries(detail).map(([k, v]) => [
            k,
            typeof v === "string" ? redact(v, this.secrets).slice(0, 300) : v,
          ]),
        )
      : undefined;
    this.events.push({ at: new Date().toISOString(), agent, event, ...(clean ? { detail: clean } : {}) });
    console.log(`[${agent}] ${event}${clean ? " " + JSON.stringify(clean) : ""}`);
  }

  // Short, safe text for errors that end up in the briefing itself
  publicError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return redact(msg, this.secrets).slice(0, 160);
  }
}
