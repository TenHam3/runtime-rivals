import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

/**
 * Creates a Prisma client for the problem bank. The caller owns its lifecycle
 * (call `$disconnect()` when done). The URL is passed in rather than read from
 * process.env so env parsing stays in `@rr/config`.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
