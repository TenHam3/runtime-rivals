// Problem-package importer (M1). Rules: packages/db/fixtures/problems/README.md
// Tests: ./import-problems.test.ts

/** One test case, ready to insert as a `TestCase` row (minus ids). */
export interface ProblemPackageTestCase {
  input: string;
  expectedOutput: string;
  isSample: boolean;
  orderIndex: number;
}

/** A validated problem package, ready to upsert as a `Problem` row + its test cases. */
export interface ProblemPackage {
  slug: string;
  title: string;
  statementMarkdown: string;
  difficulty: number;
  timeLimitMs: number;
  memoryLimitMb: number;
  floatTolerance: number | null;
  testCases: ProblemPackageTestCase[];
}

/** Thrown for any invalid package. The message should say which package and what's wrong. */
export class ProblemPackageError extends Error {
  override name = "ProblemPackageError";
}

/**
 * Reads and validates the problem package in `dir` (the folder name is the slug).
 * Pure apart from reading files: never touches the database.
 */
export async function loadProblemPackage(_dir: string): Promise<ProblemPackage> {
  throw new Error("TODO(M1 step 5): implement loadProblemPackage");
}
