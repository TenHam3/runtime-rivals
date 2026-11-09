import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Self-contained server bundle for the Docker image (see apps/web/Dockerfile).
  output: "standalone",
  // Trace files from the monorepo root so workspace packages end up in the standalone bundle.
  outputFileTracingRoot: repoRoot,
  // Workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: ["@rr/shared-types"],
};

export default nextConfig;
