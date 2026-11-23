// Problem-package importer (M1). Rules: packages/db/fixtures/problems/README.md
// Tests: ./import-problems.test.ts
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const ProblemYaml = z.strictObject({
  problem_format_version: z.literal("2025-09"),
  name: z.union([z.string().min(1), z.object({ en: z.string().min(1) })]),
  uuid: z.uuid(),
  type: z.literal("pass-fail").optional(),
  limits: z.strictObject({
    time_limit: z.number().positive(),
    memory: z.number().int().positive().optional(),
  }),
  keywords: z.array(z.string()).superRefine((kws, ctx) => {
    const diffs = kws.filter((k) => k.startsWith("difficulty:"));
    const [diff] = diffs;
    if (diffs.length !== 1 || diff === undefined || !/^difficulty:[1-5]$/.test(diff)) {
      ctx.addIssue({ code: "custom", message: 'need exactly one keyword "difficulty:N", N = 1-5' });
    }
  }),
});

const TestGroupYaml = z.object({
  output_validator_args: z.array(z.union([z.string(), z.number()])).optional(),
});

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

const isNotFound = (err: unknown) => err instanceof Error && "code" in err && err.code === "ENOENT";

async function readCaseFiles(
  slug: string,
  dir: string,
  isSample: boolean,
  orderIndex: number,
): Promise<ProblemPackageTestCase[]> {
  try {
    const label = isSample ? "data/sample" : "data/secret";
    const entries = await readdir(dir, { withFileTypes: true });
    const sub = entries.find((e) => e.isDirectory());
    if (sub) throw new ProblemPackageError(`${slug}: subfolder in ${label}: ${sub.name}`);

    const testCases: ProblemPackageTestCase[] = [];
    const names = new Set(entries.map((e) => e.name));
    const inputs = [...names].filter((n) => n.endsWith(".in")).sort();
    for (const inFile of inputs) {
      const base = inFile.slice(0, -3);
      const outFile = `${base}.ans`;
      if (!names.has(outFile)) throw new ProblemPackageError(`${slug}: ${label}/${inFile} has no ${outFile}`);
      const input = await readFile(path.join(dir, inFile), "utf8");
      const expectedOutput = await readFile(path.join(dir, outFile), "utf8");
      testCases.push({ input, expectedOutput, isSample, orderIndex: orderIndex++ });
    }

    for (const name of names) {
      const base = name.slice(0, -4);
      if (name.endsWith(".ans") && !names.has(`${base}.in`))
        throw new ProblemPackageError(`${slug}: ${label}/${name} has no ${base}.in`);
    }
    return testCases;
  } catch (err) {
    if (isSample && isNotFound(err)) return [];
    throw err;
  }
}

async function readFloatTolerance(slug: string, floatTolerancePath: string): Promise<number | null> {
  let raw: unknown;
  try {
    const text = await readFile(floatTolerancePath, "utf8");
    raw = parse(text);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw new ProblemPackageError(`${slug}: can't read test_group.yaml: ${(err as Error).message}`);
  }

  const testGroupYaml = TestGroupYaml.safeParse(raw);
  if (!testGroupYaml.success)
    throw new ProblemPackageError(
      `${slug}: test_group.yaml does not conform to the expected schema: ${z.prettifyError(testGroupYaml.error)}`,
    );

  const args = testGroupYaml.data.output_validator_args ?? [];
  if (args.includes("float_absolute_tolerance") || args.includes("float_relative_tolerance")) {
    throw new ProblemPackageError(
      `${slug}: test_group.yaml: output_validator_args must use "float_tolerance" instead of "float_absolute_tolerance" or "float_relative_tolerance"`,
    );
  }
  const i = args.indexOf("float_tolerance");
  if (i === -1) return null;
  const tolerance = Number(args[i + 1]);
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new ProblemPackageError(`${slug}: float_tolerance must be a positive number, got ${args[i + 1]}`);
  return tolerance;
}

/**
 * Reads and validates the problem package in `dir` (the folder name is the slug).
 * Pure apart from reading files: never touches the database.
 */
export async function loadProblemPackage(dir: string): Promise<ProblemPackage> {
  const slug = path.basename(dir);
  const yamlPath = path.join(dir, "problem.yaml");
  const samplesDir = path.join(dir, "data", "sample");
  const secretDir = path.join(dir, "data", "secret");
  const statementPath = path.join(dir, "statement", "problem.en.md");
  const floatTolerancePath = path.join(dir, "data", "secret", "test_group.yaml");

  let problemYaml: z.ZodSafeParseResult<z.infer<typeof ProblemYaml>>;
  try {
    const text = await readFile(yamlPath, "utf8");
    const raw = parse(text);
    problemYaml = ProblemYaml.safeParse(raw);
  } catch (err) {
    throw new ProblemPackageError(`${slug}: can't read problem.yaml: ${(err as Error).message}`);
  }

  if (!problemYaml.success) {
    throw new ProblemPackageError(
      `${slug}: problem.yaml does not conform to the expected schema: ${z.prettifyError(problemYaml.error)}`,
    );
  }
  const name = problemYaml.data.name;

  let problemStatement: string;
  try {
    problemStatement = await readFile(statementPath, "utf8");
  } catch (err) {
    throw new ProblemPackageError(`${slug}: can't read problem statement: ${(err as Error).message}`);
  }

  let testCases: ProblemPackageTestCase[] = [];
  try {
    const sampleCases = await readCaseFiles(slug, samplesDir, true, 0);
    const secretCases = await readCaseFiles(slug, secretDir, false, sampleCases.length);
    if (secretCases.length === 0)
      throw new ProblemPackageError(`${slug}: no secret test cases found, need at least one`);

    testCases = [...sampleCases, ...secretCases];
  } catch (err) {
    if (err instanceof ProblemPackageError) throw err;
    throw new ProblemPackageError(`${slug}: can't read test case directories: ${(err as Error).message}`);
  }

  const floatTolerance = await readFloatTolerance(slug, floatTolerancePath);

  const problemPackage: ProblemPackage = {
    slug,
    title: typeof name === "string" ? name : name.en,
    statementMarkdown: problemStatement,
    difficulty: Number(problemYaml.data.keywords.find((k) => k.startsWith("difficulty:"))?.slice(11)),
    timeLimitMs: Math.round(problemYaml.data.limits.time_limit * 1000),
    memoryLimitMb: problemYaml.data.limits.memory ?? 256,
    floatTolerance,
    testCases,
  };
  return problemPackage;
}
