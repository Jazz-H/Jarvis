// GitHub Gist access. Only the Jarvis orchestrator receives a GistClient; sub-agents never do.
// Writes touch only the orchestrator's own files (jazz2-briefing.json, jazz2-week.json, jazz2-calendar.json,
// jazz2-reviews.json, jazz2-answers.json, and pruning jazz2-push.json), so the app's
// jazz2-data.json and jazz2-ask.json are never rewritten. The one exception is deleting a
// question's photo or PDF (jazz2-file-*.json) once that question is no longer open.

export interface GistClient {
  readFile(name: string): Promise<string | null>;
  writeFile(name: string, content: string): Promise<void>;
  // One read of the whole gist: every file's name, and each file's text as of that same read. The
  // Ask run decides what to delete from this, so its answer can't mix an old file with a newer one.
  snapshot?(): Promise<{ names: string[]; read(name: string): Promise<string | null> }>;
  // Removes files the Ask run is done with: only a question's photo or PDF (jazz2-file-*.json)
  deleteFiles?(names: string[]): Promise<void>;
}

export function gistClient(gistId: string, token: string, fetchImpl: typeof fetch = fetch): GistClient {
  if (!/^[0-9a-f]+$/i.test(gistId)) throw new Error("JARVIS_GIST_ID doesn't look like a gist id");
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const url = `https://api.github.com/gists/${gistId}`;
  const readGist = async () => {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`GitHub API ${res.status} reading the gist`);
    const files = ((await res.json()) as any)?.files;
    // Not an empty gist: callers would take every file as missing, and start the month's spending over
    if (!files || typeof files !== "object") throw new Error("GitHub returned a gist with no files");
    return files as Record<string, any>;
  };
  const textOf = async (f: any): Promise<string | null> => {
    if (!f) return null;
    if (!f.truncated) {
      // A file with no content isn't an empty one: callers would take it as having nothing in it
      if (typeof f.content !== "string") throw new Error("GitHub returned a gist file with no content");
      return f.content;
    }
    // Big files come back truncated; the raw URL has the full text (no token sent there)
    const raw = await fetchImpl(String(f.raw_url), { signal: AbortSignal.timeout(20_000) });
    if (!raw.ok) throw new Error(`Gist raw file HTTP ${raw.status}`);
    return raw.text();
  };
  return {
    async readFile(name) {
      return textOf((await readGist())[name]);
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
    async snapshot() {
      const files = await readGist();
      return { names: Object.keys(files), read: (name) => textOf(files[name]) };
    },
    async deleteFiles(names) {
      const ok = names.filter((n) => /^jazz2-file-[a-z0-9-]{8,40}\.json$/.test(n));
      if (!ok.length) return;
      const res = await fetchImpl(url, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ files: Object.fromEntries(ok.map((n) => [n, null])) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status} deleting files`);
    },
  };
}
