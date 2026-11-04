// Google Drive, read-only (scope drive.readonly). Plain code: search the owner's Drive and read a
// file as text. Google Docs and Slides come back as plain text, Sheets as CSV, text files as they
// are; anything else (PDFs, images) is listed but not read. Everything returned is the owner's
// data but untrusted (shared files can come from anyone), trimmed and capped.
export interface DriveFile {
  id: string;
  name: string;
  type: string; // "doc" | "sheet" | "slides" | "pdf" | "text" | "other"
  modified: string; // YYYY-MM-DD
  link: string | null; // https://docs.google.com/... (null when Drive gives none)
}
export interface Drive {
  search(query: string, max?: number): Promise<DriveFile[]>;
  read(id: string): Promise<{ name: string; text: string; truncated: boolean }>;
}

export const DRIVE_READ_MAX = 20_000; // characters of one file given to the model
const BASE = "https://www.googleapis.com/drive/v3/files";
const EXPORT: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};
const kind = (mime: string) =>
  mime === "application/vnd.google-apps.document"
    ? "doc"
    : mime === "application/vnd.google-apps.spreadsheet"
      ? "sheet"
      : mime === "application/vnd.google-apps.presentation"
        ? "slides"
        : mime === "application/pdf"
          ? "pdf"
          : /^text\/|json|csv/.test(mime)
            ? "text"
            : "other";
const clean = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .slice(0, n);
const SAFE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

// Drive's query language: words are quoted, with quotes and backslashes escaped
export function driveQuery(text: string): string {
  const words = String(text)
    .replace(/[\u0000-\u001f]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.slice(0, 40).replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
  const terms = words.map((w) => `(name contains '${w}' or fullText contains '${w}')`);
  return [...terms, "trashed = false"].join(" and ");
}

export function driveClient(accessToken: string, fetchImpl: typeof fetch = fetch): Drive {
  const get = async (url: string) => {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 403 || res.status === 401)
      throw new Error("Drive isn't connected yet: redo the Google sign-in with Drive (SETUP.md → Google)");
    if (!res.ok) throw new Error(`Drive HTTP ${res.status}`);
    return res;
  };
  return {
    async search(query, max = 10) {
      const p = new URLSearchParams({
        q: driveQuery(query),
        pageSize: String(Math.min(20, Math.max(1, max))),
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
      });
      const j = (await (await get(`${BASE}?${p}`)).json()) as any;
      return (Array.isArray(j.files) ? j.files : [])
        .filter((f: any) => f && SAFE_FILE_ID.test(String(f.id)))
        .map((f: any) => ({
          id: String(f.id),
          name: clean(f.name, 120) || "Untitled",
          type: kind(String(f.mimeType || "")),
          modified: String(f.modifiedTime || "").slice(0, 10),
          link:
            typeof f.webViewLink === "string" && f.webViewLink.startsWith("https://")
              ? f.webViewLink.slice(0, 500)
              : null,
        }));
    },
    async read(id) {
      if (!SAFE_FILE_ID.test(id)) throw new Error("not a Drive file id");
      const meta = (await (await get(`${BASE}/${id}?fields=name,mimeType,size&supportsAllDrives=true`)).json()) as any;
      const mime = String(meta.mimeType || "");
      const name = clean(meta.name, 120) || "Untitled";
      let text: string;
      if (EXPORT[mime])
        text = await (await get(`${BASE}/${id}/export?mimeType=${encodeURIComponent(EXPORT[mime])}`)).text();
      else if (kind(mime) === "text") {
        if (Number(meta.size) > 2_000_000) throw new Error("that file is too big to read");
        text = await (await get(`${BASE}/${id}?alt=media&supportsAllDrives=true`)).text();
      } else
        throw new Error(
          `a ${kind(mime) === "pdf" ? "PDF" : "file of that type"} can't be read here: the owner can send it with the 📎 in Console`,
        );
      const full = clean(text, DRIVE_READ_MAX + 1);
      return { name, text: full.slice(0, DRIVE_READ_MAX), truncated: full.length > DRIVE_READ_MAX };
    },
  };
}
