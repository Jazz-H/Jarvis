// The one place that calls the Claude Agent SDK. Every agent (Jarvis and each sub-agent) runs as
// its own query() with: no built-in tools, no MCP servers, no filesystem settings or CLAUDE.md,
// no secrets in its environment except the Anthropic key, a turn cap, a cost cap and a timeout.
// Its JSON output is validated with zod; invalid output is retried once, then the run fails.
import { query, type Options, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { CostLedger } from "./cost.ts";
import type { Trace } from "./trace.ts";
import { outputSchema } from "./output-schema.ts";

export interface AgentSpec<T> {
  name: string;
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  effort?: EffortLevel;
  timeoutMs: number;
}

export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

export class AgentError extends Error {}

// Only what the SDK's subprocess needs to run and reach the API. Gist tokens and anything else
// in the Action's environment are left out, so an agent can't see them even indirectly.
export function agentEnv(src: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const keep = ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "LANG", "ANTHROPIC_API_KEY"];
  const env: Record<string, string | undefined> = { CLAUDE_AGENT_SDK_CLIENT_APP: "jazz-jarvis/1" };
  for (const k of keep) if (src[k] !== undefined) env[k] = src[k];
  return env;
}

export function agentOptions(spec: AgentSpec<unknown>, budgetUsd: number, signal: AbortController): Options {
  return {
    model: spec.model,
    systemPrompt: spec.system,
    effort: spec.effort,
    tools: [], // no built-in tools at all
    allowedTools: [],
    mcpServers: {},
    strictMcpConfig: true,
    settingSources: [], // don't load CLAUDE.md or any settings from the repo or home dir
    persistSession: false,
    permissionMode: "dontAsk",
    maxTurns: 3,
    maxBudgetUsd: budgetUsd,
    outputFormat: { type: "json_schema", schema: outputSchema(spec.schema) },
    env: agentEnv(),
    abortController: signal,
  };
}

export async function runAgent<T>(
  spec: AgentSpec<T>,
  ledger: CostLedger,
  trace: Trace,
  queryFn: QueryFn = query,
): Promise<T> {
  let lastProblem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const budget = ledger.budgetFor(spec.name);
    if (budget <= 0) throw new AgentError("no budget left under MAX_RUN_COST_USD");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), spec.timeoutMs);
    const started = Date.now();
    let result: SDKResultMessage | undefined;
    try {
      for await (const msg of queryFn({ prompt: spec.prompt, options: agentOptions(spec, budget, ac) })) {
        if (msg.type === "result") result = msg;
      }
    } catch (e) {
      lastProblem = ac.signal.aborted ? `timed out after ${Math.round(spec.timeoutMs / 1000)}s` : trace.publicError(e);
    } finally {
      clearTimeout(timer);
    }
    if (result) recordUsage(spec, result, ledger);
    trace.log(spec.name, "attempt", {
      attempt,
      ms: Date.now() - started,
      outcome: result ? result.subtype : "no result",
      costUsd: result ? Number(result.total_cost_usd.toFixed(4)) : 0,
    });
    if (!result) continue;
    // API failures (bad key, overload…) arrive as subtype "success" with is_error set
    if (result.is_error) {
      const status = "api_error_status" in result ? result.api_error_status : null;
      lastProblem = `Claude API error${status ? ` ${status}` : ""}`;
      if (status && status >= 400 && status < 500 && status !== 429) break; // retrying won't help
      continue;
    }
    if (result.subtype !== "success") {
      lastProblem = `agent stopped: ${result.subtype}`;
      if (result.subtype === "error_max_budget_usd") break; // a retry can't fit either
      continue;
    }
    const parsed = spec.schema.safeParse(result.structured_output ?? tryJson(result.result));
    if (parsed.success) return parsed.data;
    lastProblem = "output didn't match its schema";
    trace.log(spec.name, "invalid output", { issues: parsed.error.issues.length });
  }
  throw new AgentError(lastProblem || "agent failed");
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function recordUsage(spec: AgentSpec<unknown>, r: SDKResultMessage, ledger: CostLedger) {
  const models = Object.entries(r.modelUsage ?? {});
  if (!models.length) {
    ledger.record({
      agent: spec.name,
      model: spec.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: r.total_cost_usd || 0,
    });
    return;
  }
  for (const [model, u] of models)
    ledger.record({
      agent: spec.name,
      model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadInputTokens,
      cacheWriteTokens: u.cacheCreationInputTokens,
      costUsd: u.costUSD,
    });
}

// Wraps untrusted text so prompts can tell the model to treat it as data only.
export function dataBlock(label: string, value: unknown): string {
  const json = JSON.stringify(value, null, 1).replace(/<\/?untrusted_data[^>]*>/gi, "");
  return `<untrusted_data source="${label}">\n${json}\n</untrusted_data>`;
}
