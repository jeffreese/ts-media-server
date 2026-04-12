Review the current changes for quality and correctness.

1. Gather changes:
   - Run `git diff` for uncommitted changes
   - Run `git diff main...HEAD` for all branch changes (if on a feature branch)
2. Load project conventions:
   - Read any `.cursor/rules/` files for enforced patterns
   - Read ADRs in `docs/adr/` for architectural decisions
3. Run `pnpm typecheck` to check for TypeScript errors
4. Run `pnpm test` to verify all tests pass
5. For each changed file, check for:
   - Type safety issues (any casts, missing null checks)
   - Error handling gaps (unhandled promise rejections, missing try/catch at boundaries)
   - Security concerns (SQL injection, path traversal, missing auth checks)
   - Performance issues (unbounded Promise.all, missing p-limit, N+1 queries)
   - Missing or broken tests for new functionality
   - Violations of project ADRs or conventions from `.cursor/rules/`
6. Summarize findings with specific file locations, the convention/ADR being violated, and suggested fixes
