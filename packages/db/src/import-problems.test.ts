import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProblemPackage, ProblemPackageError } from "./import-problems";

// Fixture packages + the rules they encode: packages/db/fixtures/problems/README.md
const FIXTURES = fileURLToPath(new URL("../fixtures/problems/", import.meta.url));
const fixture = (name: string) => FIXTURES + name;
const statementOf = (name: string) => readFileSync(fixture(`${name}/statement/problem.en.md`), "utf8");

describe("loadProblemPackage — valid packages", () => {
  it("loads valid-basic", async () => {
    expect(await loadProblemPackage(fixture("valid-basic"))).toEqual({
      slug: "valid-basic",
      title: "A Plus B",
      statementMarkdown: statementOf("valid-basic"),
      difficulty: 1,
      timeLimitMs: 1500,
      memoryLimitMb: 512,
      floatTolerance: null,
      testCases: [
        // samples first, lexicographic by name: 1, 10, 2
        { input: "1 2\n", expectedOutput: "3\n", isSample: true, orderIndex: 0 },
        { input: "10 20\n", expectedOutput: "30\n", isSample: true, orderIndex: 1 },
        { input: "2 2\n", expectedOutput: "4\n", isSample: true, orderIndex: 2 },
        // then secret
        { input: "5 7\n", expectedOutput: "12\n", isSample: false, orderIndex: 3 },
        { input: "-3 3\n", expectedOutput: "0\n", isSample: false, orderIndex: 4 },
        { input: "1000000000 1000000000\n", expectedOutput: "2000000000\n", isSample: false, orderIndex: 5 },
      ],
    });
  });

  it("loads valid-float-tolerance (name as a language map, default memory, float tolerance)", async () => {
    expect(await loadProblemPackage(fixture("valid-float-tolerance"))).toEqual({
      slug: "valid-float-tolerance",
      title: "Average",
      statementMarkdown: statementOf("valid-float-tolerance"),
      difficulty: 2,
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      floatTolerance: 1e-6,
      testCases: [
        { input: "1 2\n", expectedOutput: "1.5\n", isSample: true, orderIndex: 0 },
        { input: "1 4\n", expectedOutput: "2.5\n", isSample: false, orderIndex: 1 },
      ],
    });
  });
});

describe("loadProblemPackage — invalid packages", () => {
  const invalid = readdirSync(FIXTURES).filter((name) => name.startsWith("invalid-"));

  it("has invalid fixtures to test", () => {
    expect(invalid.length).toBeGreaterThanOrEqual(14);
  });

  it.each(invalid)("rejects %s", async (name) => {
    await expect(loadProblemPackage(fixture(name))).rejects.toBeInstanceOf(ProblemPackageError);
  });
});
