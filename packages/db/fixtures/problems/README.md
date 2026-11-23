# Importer fixtures

Test-only problem packages for the importer tests (M1). `valid-*` must import; each `invalid-*` has exactly one defect (named by the folder) and must be rejected. Real problems live in the repo-root `problems/`.

## Importer rules (our subset of Kattis format 2025-09)

**`problem.yaml`** — unknown keys are an error (per spec).

- `problem_format_version`: must be `2025-09`.
- `name`: required. A string, or a map that includes `en` → `Problem.title`.
- `uuid`: required string.
- `type`: optional, `pass-fail` only (the default). Anything else (`scoring`, `interactive`, …) is rejected.
- `limits.time_limit`: **required by us** (spec-optional), seconds → `timeLimitMs = round(time_limit * 1000)`.
- `limits.memory`: optional MiB → `memoryLimitMb`, default **256**.
- `keywords`: list of strings. **Difficulty** (not in the spec) is exactly one keyword `difficulty:N`, N an integer 1–5 → `Problem.difficulty`. Missing or out of range is an error.

**Package files**

- `slug` = package folder name.
- `statement/problem.en.md` required → `statementMarkdown` (verbatim).
- `data/sample/` optional, `data/secret/` required with at least one test case.
- A test case is `<name>.in` + `<name>.ans`; an `.in` without `.ans` and vice versa are errors. Contents are stored verbatim.
- Test data groups (any subfolder of `data/sample/` or `data/secret/`) are not supported and are an error.

**Ordering**

- `orderIndex`: samples first, then secret, each in lexicographic order of name. Starts at 0, contiguous.

**Float tolerance**

- From `output_validator_args` in `data/secret/test_group.yaml` (the only `test_group.yaml` allowed; other keys in it are ignored). Only `float_tolerance ε` is supported → `floatTolerance`. Absent → `null`. Combining it with `float_absolute_tolerance`/`float_relative_tolerance` is an error (per spec).
