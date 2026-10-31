// Ask Jarvis's Google Drive tools: an in-process MCP server with two read-only tools. The Drive
// client (and its Google token) stays in this process: the model only sees tool results, and each
// file's text comes back wrapped as untrusted data. Every call is counted, so code can tell that an
// answer used Drive (such an answer can't take actions, like one that searched the web).
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Drive } from "../tools/drive.ts";
import { dataBlock } from "./run-agent.ts";

export const DRIVE_TOOLS = ["mcp__drive__search_drive", "mcp__drive__read_drive_file"];

export function driveServer(getDrive: () => Promise<Drive>, usage: { driveReads: number }) {
  const fail = (e: unknown) => ({
    content: [{ type: "text" as const, text: `Drive didn't answer: ${e instanceof Error ? e.message : "error"}`.slice(0, 300) }],
    isError: true,
  });
  return createSdkMcpServer({
    name: "drive",
    version: "1.0.0",
    tools: [
      tool(
        "search_drive",
        "Search the owner's Google Drive (read-only) by a few words. Returns up to 10 files: id, name, type (doc, sheet, slides, pdf, text, other), last modified date and link, newest first.",
        { query: z.string().min(1).max(200) },
        async ({ query }) => {
          usage.driveReads++;
          try {
            const files = await (await getDrive()).search(query, 10);
            return { content: [{ type: "text" as const, text: dataBlock("drive-search", files) }] };
          } catch (e) {
            return fail(e);
          }
        },
      ),
      tool(
        "read_drive_file",
        "Read one Google Drive file as text, by an id from search_drive (Docs, Sheets as CSV, Slides and text files; up to 20,000 characters).",
        { id: z.string().min(10).max(200) },
        async ({ id }) => {
          usage.driveReads++;
          try {
            const f = await (await getDrive()).read(id);
            return {
              content: [
                { type: "text" as const, text: dataBlock("drive-file", { name: f.name, truncated: f.truncated, text: f.text }) },
              ],
            };
          } catch (e) {
            return fail(e);
          }
        },
      ),
    ],
  });
}
