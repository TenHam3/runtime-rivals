import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// The repo keeps a single .env at the root; Prisma 7 no longer loads it automatically.
// Real environment variables (CI, docker) win because loadEnvFile doesn't override them.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Not required for `prisma generate`, so CI can generate without a database.
    url: process.env.DATABASE_URL ?? "",
  },
});
