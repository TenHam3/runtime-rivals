// @rr/db — Prisma client + types for the problem bank (Problem/TestCase). See PLAN.MD.
export { createPrismaClient } from "./client";
export type { PrismaClient, Problem, TestCase } from "./generated/prisma/client";

// Placeholder export kept until the placeholder test is replaced by the importer tests (M1 step 4).
export const PACKAGE_NAME = "@rr/db";
