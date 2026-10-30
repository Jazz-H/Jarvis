// One-time Google sign-in for Jarvis's Gmail access (read-only). Run on your own computer:
//
//   cd agents && npm run google-auth
//
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in agents/.env (a "Desktop app" OAuth client;
// see docs/jarvis/SETUP.md). It opens Google's sign-in page, catches the reply on 127.0.0.1, and
// prints the refresh token in this terminal only, never to a file, a log or the network.
// Paste it into the GOOGLE_REFRESH_TOKEN GitHub secret.
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

const here = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(here, ".env"))) process.loadEnvFile(path.join(here, ".env"));
const clientId = process.env.GOOGLE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in agents/.env first (docs/jarvis/SETUP.md → Google).");
  process.exit(1);
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const done = (msg: string) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(msg);
    server.close();
  };
  if (url.searchParams.get("state") !== state) return done("State mismatch. Run npm run google-auth again.");
  const code = url.searchParams.get("code");
  if (!code) return done(`Sign-in was cancelled (${url.searchParams.get("error") ?? "no code"}).`);
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }).toString(),
  });
  const j = (await tokenRes.json().catch(() => ({}))) as any;
  if (!j.refresh_token) {
    done(
      "Google didn't return a refresh token. Remove Jarvis's access at myaccount.google.com/permissions and try again.",
    );
    console.error("No refresh token in Google's reply:", j.error ?? tokenRes.status);
    process.exitCode = 1;
    return;
  }
  done("Done. Go back to the terminal for the token, then close this tab.");
  console.log("\nAdd this as the GitHub secret GOOGLE_REFRESH_TOKEN (don't paste it anywhere else):\n");
  console.log(j.refresh_token);
  console.log("");
});

let redirectUri = "";
server.listen(0, "127.0.0.1", () => {
  const port = (server.address() as any).port;
  redirectUri = `http://127.0.0.1:${port}/callback`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  console.log("Opening Google sign-in. If it doesn't open, visit:\n" + auth.href);
  const opener =
    process.platform === "win32"
      ? `start "" "${auth.href}"`
      : process.platform === "darwin"
        ? `open "${auth.href}"`
        : `xdg-open "${auth.href}"`;
  exec(opener);
});
