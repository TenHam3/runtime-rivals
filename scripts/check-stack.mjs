#!/usr/bin/env node
// Health check for the local docker compose stack: containers, Postgres, web via Caddy, Piston.
// Usage: pnpm stack:check   (reads .env if present; exits 1 if any check fails)
// Env:   CADDY_PORT (default 8080), JUDGE_API_URL (default http://localhost:2000),
//        POSTGRES_USER / POSTGRES_DB (defaults rr / runtime_rivals)

import { execFileSync } from "node:child_process";

const CADDY_URL = `http://localhost:${process.env.CADDY_PORT || 8080}`;
const JUDGE_API_URL = (process.env.JUDGE_API_URL || "http://localhost:2000").replace(/\/$/, "");
const PG_USER = process.env.POSTGRES_USER || "rr";
const PG_DB = process.env.POSTGRES_DB || "runtime_rivals";
const EXPECTED_SERVICES = ["caddy", "web", "postgres", "judge"];

// Sample programs: read two numbers, print their sum. Input "2 40" must produce "42".
const PROGRAMS = [
  {
    language: "c++",
    source: "#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;}",
  },
  { language: "python", source: "a,b=map(int,input().split())\nprint(a+b)" },
];

let failures = 0;
const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};
const section = (title) => console.log(`\n${title}`);

const docker = (args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function getJson(url, init) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function checkContainers() {
  section("Containers");
  let out;
  try {
    out = docker(["compose", "ps", "--all", "--format", "json"]);
  } catch (err) {
    fail(`docker compose ps failed (is Docker Desktop running?): ${err.stderr?.trim() || err.message}`);
    return new Set();
  }
  // Older Compose prints a JSON array, newer prints one JSON object per line.
  const trimmed = out.trim();
  const rows = !trimmed
    ? []
    : trimmed.startsWith("[")
      ? JSON.parse(trimmed)
      : trimmed.split(/\r?\n/).map((l) => JSON.parse(l));

  // Returns the set of services that are up, so later checks can skip ones that can't work.
  const up = new Set();
  for (const service of EXPECTED_SERVICES) {
    const row = rows.find((r) => r.Service === service);
    if (!row) {
      fail(`${service}: not created (run: docker compose up -d --build)`);
    } else if (row.State !== "running") {
      fail(`${service}: ${row.State} (${row.Status})`);
    } else if (row.Health && row.Health !== "healthy") {
      fail(`${service}: running but ${row.Health}`);
    } else {
      pass(`${service}: ${row.Status}`);
      up.add(service);
    }
  }
  return up;
}

function checkPostgres() {
  section("Postgres");
  try {
    const out = docker(["compose", "exec", "-T", "postgres", "pg_isready", "-U", PG_USER, "-d", PG_DB]);
    pass(out.trim());
  } catch (err) {
    fail(`pg_isready failed: ${(err.stdout || err.stderr || err.message).trim()}`);
  }
}

async function checkWeb() {
  section(`Web via Caddy (${CADDY_URL})`);
  try {
    const res = await fetch(CADDY_URL, { signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    if (res.status !== 200) fail(`HTTP ${res.status}`);
    else if (!body.includes("Runtime Rivals")) fail("HTTP 200 but page doesn't look like the web app");
    else pass("HTTP 200, web app page served");
  } catch (err) {
    fail(`request failed: ${err.message}`);
  }
}

async function checkPiston() {
  section(`Piston judge (${JUDGE_API_URL})`);
  let runtimes;
  try {
    runtimes = await getJson(`${JUDGE_API_URL}/api/v2/runtimes`);
  } catch (err) {
    fail(`could not reach Piston: ${err.message}`);
    return;
  }

  for (const { language, source } of PROGRAMS) {
    const runtime = runtimes.find((r) => r.language === language);
    if (!runtime) {
      fail(`${language}: runtime not installed (run: node scripts/install-piston-runtimes.mjs)`);
      continue;
    }
    try {
      const result = await getJson(`${JUDGE_API_URL}/api/v2/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language,
          version: runtime.version,
          files: [{ name: "main", content: source }],
          stdin: "2 40",
        }),
      });
      if (result.compile && result.compile.code !== 0) {
        fail(`${language} ${runtime.version}: compile failed\n${result.compile.stderr}`);
      } else if (result.run.stdout.trim() !== "42") {
        fail(
          `${language} ${runtime.version}: expected "42", got ${JSON.stringify(result.run.stdout)} ${result.run.stderr}`,
        );
      } else {
        pass(
          `${language} ${runtime.version}: ran sample program (cpu ${result.run.cpu_time} ms, wall ${result.run.wall_time} ms)`,
        );
      }
    } catch (err) {
      fail(`${language}: execute request failed: ${err.message}`);
    }
  }
}

const servicesUp = checkContainers();
if (servicesUp.has("postgres")) checkPostgres();
await checkWeb();
await checkPiston();

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
