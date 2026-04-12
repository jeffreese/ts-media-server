Review the current changes for quality and correctness.

1. Run `pnpm typecheck` to check for TypeScript errors
2. Run `pnpm test` to verify all tests pass
3. Run `git diff` to review all uncommitted changes
4. For each changed file, check for:
   - Type safety issues (any casts, missing null checks)
   - Error handling gaps (unhandled promise rejections, missing try/catch at boundaries)
   - Security concerns (SQL injection, path traversal, missing auth checks)
   - Performance issues (unbounded Promise.all, missing p-limit, N+1 queries)
   - Missing or broken tests for new functionality
5. Summarize findings with specific file locations and suggested fixes
