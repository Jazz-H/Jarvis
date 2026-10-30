// GitHub Gist access. Only the Jarvis orchestrator receives a GistClient; sub-agents never do.
// Writes touch only the orchestrator's own files (jazz2-briefing.json, jazz2-week.json,
// jazz2-reviews.json, and pruning jazz2-push.json), so the app's jazz2-data.json is never rewritten.

export interface GistClient {
  readFile(name: string): Promise<string | null>;
  writeFile(name: string, content: string): Promise<void>;
}

export function gistClient(gistId: string, token: string, fetchImpl: typeof fetch = fetch): GistClient {
  if (!/^[0-9a-f]+$/i.test(gistId)) throw new Error("JARVIS_GIST_ID doesn't look like a gist id");
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const url = `https://api.github.com/gists/${gistId}`;
  return {
    async readFile(name) {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`GitHub API ${res.status} reading the gist`);
      const g = (await res.json()) as any;
      const f = g?.files?.[name];
      if (!f) return null;
      if (!f.truncated) return String(f.content ?? "");
      // Big files come back truncated; the raw URL has the full text (no token sent there)
      const raw = await fetchImpl(String(f.raw_url), { signal: AbortSignal.timeout(20_000) });
      if (!raw.ok) throw new Error(`Gist raw file HTTP ${raw.status}`);
      return raw.text();
    },
    async writeFile(name, content) {
      const res = await fetchImpl(url, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ files: { [name]: { content } } }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status} writing ${name}`);
    },
  };
}
