// Renders icon.svg to jarvis-icon-192.png and jarvis-icon-512.png (new names make installed apps fetch the new icon) (`npm run icons`).
// Uses Playwright's Chromium (already a dev dependency for the tests) so the SVG's glow filters
// and the self-hosted Rajdhani font render exactly as in the app. Each size is rendered from the
// vector source rather than downsampled.
//   node scripts/render-icons.mjs [outDir]   (default: repo root)
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || ROOT);
const svg = await readFile(path.join(ROOT, "icon.svg"), "utf8");
// embedded as a data URL: a page set from a string can't load local font files
const font =
  "data:font/woff2;base64," + (await readFile(path.join(ROOT, "fonts", "rajdhani-700.woff2"))).toString("base64");

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><style>
      @font-face { font-family: "Rajdhani"; font-weight: 700; src: url("${font}") format("woff2"); }
      html, body { margin: 0; background: #02060b; }
      svg { display: block; width: ${size}px; height: ${size}px; }
    </style>${svg}`,
    { waitUntil: "load" },
  );
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(outDir, `jarvis-icon-${size}.png`);
  await page.screenshot({ path: file, omitBackground: false });
  console.log("wrote", path.relative(process.cwd(), file));
  await page.close();
}
await browser.close();
