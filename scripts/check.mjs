// Dependency-free quality check: `npm run check`.
// 1. Syntax-checks sw.js, scripts/, tests/ and every app script (js/*.js, plus the concatenation).
// 2. Confirms every local path in sw.js ASSETS exists and every loaded script is precached.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
let checked = 0;

function nodeCheck(file, label) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  checked++;
  if (r.status !== 0) problems.push(`Syntax error in ${label}:\n${(r.stderr || r.stdout).trim()}`);
}

// Node tooling (ESM) is syntax-checked in place.
const files = [
  "sw.js",
  ...["scripts", "tests"].flatMap((dir) =>
    readdirSync(path.join(ROOT, dir))
      .filter((f) => /\.m?js$/.test(f))
      .map((f) => `${dir}/${f}`),
  ),
];
for (const f of files) nodeCheck(path.join(ROOT, f), f);

// App page: every <script> must be a classic script. External ones (js/*.js) are checked
// individually AND concatenated in page order, because classic scripts share one global
// scope: a duplicate top-level const/let/class across files is a runtime SyntaxError in the
// browser that per-file checks cannot see. Temp copies are always removed.
const html = readFileSync(path.join(ROOT, "jazz2.0.html"), "utf8");
const appScripts = []; // { label, src, code } in page order
for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  const attrs = m[1] || "";
  if (/\btype\s*=\s*["']?module/i.test(attrs)) {
    problems.push('jazz2.0.html: <script type="module"> found; the app is classic scripts (see README).');
    continue;
  }
  const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
  if (!src) {
    appScripts.push({ label: "jazz2.0.html inline <script>", code: m[2] });
    continue;
  }
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src[1])) continue; // remote script
  const rel = src[1].split(/[?#]/)[0];
  if (!existsSync(path.join(ROOT, rel))) {
    problems.push(`jazz2.0.html loads ${rel} but it does not exist.`);
    continue;
  }
  appScripts.push({ label: rel, src: rel, code: readFileSync(path.join(ROOT, rel), "utf8") });
}
if (appScripts.length === 0) problems.push("jazz2.0.html: no app <script> found.");
const loaded = new Set(appScripts.map((s) => s.src).filter(Boolean));
const jsDir = path.join(ROOT, "js");
if (existsSync(jsDir))
  for (const f of readdirSync(jsDir).filter((f) => /\.js$/.test(f))) {
    if (!loaded.has(`js/${f}`))
      problems.push(`js/${f} is not loaded by jazz2.0.html (orphan file or missing <script> tag).`);
  }
const tmp = mkdtempSync(path.join(tmpdir(), "jazz-check-"));
try {
  appScripts.forEach((s, i) => {
    const file = path.join(tmp, `s${i}.cjs`);
    writeFileSync(file, s.code);
    nodeCheck(file, s.label);
  });
  if (appScripts.length > 1) {
    const file = path.join(tmp, "all.cjs");
    writeFileSync(file, appScripts.map((s) => s.code).join("\n"));
    nodeCheck(file, "all app scripts concatenated in page order (cross-file redeclarations)");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Every script the page loads must be precached for offline use.
const sw = readFileSync(path.join(ROOT, "sw.js"), "utf8");
const block = /const ASSETS\s*=\s*\[([\s\S]*?)\]/.exec(sw);
if (!block) {
  problems.push("sw.js: could not find `const ASSETS = [...]`.");
} else {
  const assets = [...block[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  const norm = (a) => a.split(/[?#]/)[0].replace(/^\.\//, "");
  const cached = new Set(assets.map(norm));
  for (const s of appScripts)
    if (s.src && !cached.has(s.src))
      problems.push(`sw.js ASSETS is missing "./${s.src}" (loaded by jazz2.0.html, so offline would break).`);
  for (const a of assets) {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(a)) continue; // remote URL
    const rel = a.split(/[?#]/)[0];
    if (!existsSync(path.join(ROOT, rel)))
      problems.push(`sw.js ASSETS lists "${a}" but ${rel} does not exist. Fix the path or remove it.`);
  }
  checked += assets.length;
}

// Inline event-handler guard: the app must not use on* attributes at all (use data-action +
// delegated listeners instead). Handlers in the page markup are "static"; handlers inside the
// script templates (js/*.js) are "dynamic". Any occurrence fails the check so it can't regress.
const handlerRe = /\son([a-z]+)\s*=\s*\\?["']/gi;
const tally = (text) => {
  const byEvent = {};
  let total = 0;
  for (const m of text.matchAll(handlerRe)) {
    total++;
    byEvent[m[1].toLowerCase()] = (byEvent[m[1].toLowerCase()] || 0) + 1;
  }
  return { total, byEvent };
};
const fmt = (t) =>
  `${t.total}${
    t.total
      ? ` (${Object.entries(t.byEvent)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ")})`
      : ""
  }`;
const staticHandlers = tally(html);
const dynamicHandlers = tally(appScripts.map((s) => s.code).join("\n"));
console.log(
  `inline handlers in the app: static ${fmt(staticHandlers)}; dynamic ${fmt(dynamicHandlers)}; total ${staticHandlers.total + dynamicHandlers.total}`,
);
if (staticHandlers.total + dynamicHandlers.total > 0)
  problems.push(
    `app: ${staticHandlers.total + dynamicHandlers.total} inline on* handler attribute(s) found (static ${fmt(staticHandlers)}, dynamic ${fmt(dynamicHandlers)}). Use data-action with the SHELL_CLICK/SHELL_CHANGE/SHELL_KEYDOWN tables instead.`,
  );
if (problems.length) {
  console.error(problems.join("\n\n"));
  console.error(`\ncheck failed: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check ok: ${checked} items verified`);
