---
name: ship-checks
description: Typecheck and test gate for the /ship pipeline. Runs pnpm typecheck and pnpm test.
model: fast
---

Run the project's type checker and test suite.

## Steps

1. Run `pnpm typecheck`. Capture output and exit code.
2. Run `pnpm test`. Capture output and exit code.

If either command fails, include the relevant error output (truncated to the meaningful portion — skip passing tests, keep failures and diagnostics).

## Return format

Return EXACTLY this structure so the parent agent can gate on it:

```
## Result: PASS | FAIL

### Typecheck
- Status: PASS | FAIL
- Errors: <count or "none">
<if failed, include the error output>

### Tests
- Status: PASS | FAIL
- Passed: <N>, Failed: <N>, Skipped: <N>
<if failed, include failure summaries>
```

Result is FAIL if either check failed.
