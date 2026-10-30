import type { AgentSpec } from "../lib/run-agent.ts";
import type { Trace } from "../lib/trace.ts";

// What a sub-agent is handed: a way to fetch public data, a way to run its own model, and the trace.
// No Gist client, no notifier, no way to start another agent.
export interface SubagentDeps {
  fetchImpl: typeof fetch;
  run: <T>(spec: AgentSpec<T>) => Promise<T>;
  trace: Trace;
}
