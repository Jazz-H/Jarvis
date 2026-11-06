// npm test: runs tests/regression.mjs as several processes at once, each taking every n-th section
// (TEST_SHARD=i/n), and adds up their results. Each process has its own browser and test server.
// TEST_SHARDS=n sets how many (default: the CPUs less two, at least 1, at most 6); TEST_SHARDS=1 is
// the same as `npm run test:serial`.
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const n = Math.max(1, Math.min(6, Number(process.env.TEST_SHARDS) || os.cpus().length - 2));
const started = Date.now();

function shard(i) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, "regression.mjs")], {
      env: { ...process.env, TEST_SHARD: `${i}/${n}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      // show a failing section as soon as it happens
      String(d)
        .split("\n")
        .filter((l) => l.startsWith("FAIL"))
        .forEach((l) => console.log(l));
    });
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      const m = /(\d+) checks passed, (\d+) failed/.exec(out);
      resolve({
        i,
        code,
        passed: m ? Number(m[1]) : 0,
        failed: m ? Number(m[2]) : 0,
        sections: (out.match(/^(ok {2}|FAIL)/gm) || []).length,
        failures: out.split("\n").filter((l) => l.startsWith("  ✗ ")),
        // a process that stopped before its summary (a crash) counts as a failure, with its output's end
        crashed: !m ? out.trim().split("\n").slice(-15).join("\n") : "",
      });
    });
  });
}

const results = await Promise.all(Array.from({ length: n }, (_, i) => shard(i)));
const passed = results.reduce((s, r) => s + r.passed, 0);
const failures = results.flatMap((r) => r.failures);
const crashed = results.filter((r) => r.crashed);
const sections = results.reduce((s, r) => s + r.sections, 0);
crashed.forEach((r) => console.log(`\nshard ${r.i + 1}/${n} stopped without a summary:\n${r.crashed}`));
console.log(
  `\n${passed} checks passed, ${failures.length} failed (${sections} sections, ${n} at a time, ${Math.round((Date.now() - started) / 1000)}s)`,
);
failures.forEach((f) => console.log(f));
if (failures.length || crashed.length || results.some((r) => r.code !== 0 && !r.failures.length)) process.exit(1);
