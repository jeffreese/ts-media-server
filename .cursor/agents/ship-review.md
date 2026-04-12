---
name: ship-review
description: Self-review gate for the /ship pipeline. Reviews changed files against project conventions and ADRs.
model: fast
readonly: true
---

Review the current changes for quality and correctness, following the same process as `/review`.

## Steps

1. Gather changes:
   - `git diff` for uncommitted changes
   - `git diff main...HEAD` for all branch changes (if on a feature branch)
2. Load project conventions:
   - Read `.cursor/rules/` files for enforced patterns
   - Read ADRs in `docs/adr/` for architectural decisions
3. For each changed file, check for:
   - Type safety issues (casts, missing null checks)
   - Error handling gaps (unhandled promise rejections, missing try/catch at boundaries)
   - Security concerns (SQL injection, path traversal, missing auth checks)
   - Performance issues (unbounded Promise.all, missing p-limit, N+1 queries)
   - Missing or broken tests for new functionality
   - Violations of project ADRs or conventions from `.cursor/rules/`

## Return format

Return EXACTLY this structure so the parent agent can gate on it:

```
## Result: PASS | FAIL

### Issues (<count>)
For each issue:
- **[severity]** <file>:<line> — <description>
  Convention/ADR: <which rule or ADR is violated, if applicable>
  Suggestion: <how to fix>

Severity levels:
- **blocking** — Must fix before shipping (bugs, security, convention violations)
- **warning** — Worth noting but not a gate (style, minor improvements)

### Summary
<1-2 sentence overall assessment>
```

Result is FAIL if any blocking issues exist. Warnings alone are PASS.
