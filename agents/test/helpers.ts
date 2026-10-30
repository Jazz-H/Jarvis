// Test helpers: a fake fetch that serves canned responses by URL and records every call.
// Any URL without a handler fails the test, so nothing can reach the network.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { QueryFn } from "../lib/run-agent.ts";
import type { GistClient } from "../tools/gist.ts";

export interface Call {
  url: string;
  init?: RequestInit;
}
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function fakeFetch(routes: [RegExp | string, Handler][]) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = routes.find(([m]) => (typeof m === "string" ? url.startsWith(m) : m.test(url)));
    if (!hit) throw new Error(`unexpected fetch in test: ${url}`);
    return hit[1](url, init);
  }) as typeof fetch;
  return { impl, calls };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export const text = (body: string, status = 200) => new Response(body, { status });

// A fake Agent SDK query(): each call yields one result message from the list, in order.
export function fakeQuery(results: Partial<Extract<SDKMessage, { type: "result" }>>[] | (() => never)) {
  const seen: Parameters<QueryFn>[0][] = [];
  let i = 0;
  const fn: QueryFn = (params) => {
    seen.push(params);
    if (typeof results === "function") return results();
    const r = results[Math.min(i++, results.length - 1)];
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        total_cost_usd: 0.001,
        modelUsage: {},
        ...r,
      } as SDKMessage;
    })();
  };
  return { fn, seen };
}

// An in-memory Gist: reads from `files`, records every write. Nothing touches the network.
export function memoryGist(files: Record<string, string> = {}) {
  const writes: [string, string][] = [];
  const gist: GistClient = {
    readFile: async (n) => files[n] ?? null,
    writeFile: async (n, c) => {
      writes.push([n, c]);
      files[n] = c;
    },
  };
  return { gist, writes, files };
}
