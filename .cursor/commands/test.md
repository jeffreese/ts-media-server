Run the relevant tests for the current changes.

1. Run `git diff --name-only` to identify changed files
2. For each changed source file in `src/`, find the corresponding test file in `test/` or a co-located `.test.ts` file
3. If matching test files exist, run them with `pnpm vitest run <test-files>`
4. If no matching test files exist, run the full test suite with `pnpm test`
5. If any tests fail, analyze the failures and suggest fixes
6. After fixing, re-run the failing tests to confirm they pass
