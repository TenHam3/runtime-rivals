#!/usr/bin/env node
// Installs the language runtimes Runtime Rivals needs into the Piston judge (it ships with none).
// Idempotent: already-installed packages are skipped. Installed packages persist in the
// `piston_packages` docker volume, so this only needs re-running after that volume is deleted.
//
// Usage: node scripts/install-piston-runtimes.mjs   (judge must be up: docker compose up -d judge)
// Env:   JUDGE_API_URL (default http://localhost:2000)

const JUDGE_API_URL = (process.env.JUDGE_API_URL ?? "http://localhost:2000").replace(/\/$/, "");

// Piston package name -> optional major-version prefix to stay within.
// Keep in sync with the language registry in packages/shared-types (arrives in M4).
const WANTED = [
  { pkg: "gcc", versionPrefix: "" }, // provides c++ (g++)
  { pkg: "python", versionPrefix: "3." },
];

const compareVersions = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

async function api(path, init) {
  const res = await fetch(`${JUDGE_API_URL}/api/v2${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  return JSON.parse(body);
}

async function main() {
  console.log(`Piston at ${JUDGE_API_URL}`);
  let packages;
  try {
    packages = await api("/packages");
  } catch (err) {
    console.error(`Could not reach Piston. Is it running? (docker compose up -d judge)\n${err.message}`);
    process.exit(1);
  }

  for (const { pkg, versionPrefix } of WANTED) {
    const candidates = packages
      .filter((p) => p.language === pkg && p.language_version.startsWith(versionPrefix))
      .sort((a, b) => compareVersions(b.language_version, a.language_version));
    const latest = candidates[0];
    if (!latest) throw new Error(`No Piston package found for ${pkg} ${versionPrefix}*`);

    const installed = candidates.find((p) => p.installed);
    if (installed) {
      console.log(`✓ ${pkg} ${installed.language_version} already installed`);
      continue;
    }
    console.log(`… installing ${pkg} ${latest.language_version} (can take a few minutes)`);
    await api("/packages", {
      method: "POST",
      body: JSON.stringify({ language: pkg, version: latest.language_version }),
    });
    console.log(`✓ ${pkg} ${latest.language_version} installed`);
  }

  const runtimes = await api("/runtimes");
  console.log("\nAvailable runtimes:");
  for (const r of runtimes) console.log(`  ${r.language} ${r.version}  (aliases: ${r.aliases.join(", ") || "-"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
