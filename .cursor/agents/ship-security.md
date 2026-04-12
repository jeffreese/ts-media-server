---
name: ship-security
description: Security scan gate for the /ship pipeline. Runs semgrep and manual spot-checks on changed files.
model: fast
readonly: true
---

Run the security scan defined by `/security-check` on changed files.

## Steps

1. Verify `semgrep` is installed (`which semgrep`). If missing, return FAIL with install instructions.
2. Determine changed files: union of `git diff --name-only $(git merge-base HEAD main)...HEAD`, `git diff --name-only`, and `git diff --name-only --cached`. Filter to files that still exist. If none, return PASS with "Nothing to scan."
3. Run semgrep:
   ```bash
   semgrep --config p/default --config p/secrets --config p/owasp-top-ten --config p/javascript --config p/typescript --json --no-git-ignore <files>
   ```
4. Classify findings: ERROR → blocking, WARNING/INFO → warning.
5. Manual spot-checks on the same files:
   - Dangerous DOM patterns: `dangerouslySetInnerHTML`, `innerHTML`, `eval(`, `new Function(`
   - SQL injection vectors: string interpolation in queries vs. parameterized
   - Hardcoded secrets: key prefixes `sk-`, `sk_live`, `AKIA`, `ghp_`, `xoxb-`, `eyJ`
   - Committed config: `.env` files not gitignored, tokens in committed JSON/YAML

## Return format

Return EXACTLY this structure so the parent agent can gate on it:

```
## Result: PASS | FAIL

### Scan Summary
- Files scanned: <N>
- Rulesets: p/default, p/secrets, p/owasp-top-ten, p/javascript, p/typescript

### Blocking (<count>)
- **<rule-id>** — <message> `<file>:<line>`

### Warnings (<count>)
- **<rule-id>** — <message> `<file>:<line>`

### Manual Spot-Checks
- Dangerous DOM patterns: <found/none>
- SQL injection vectors: <found/none>
- Hardcoded secrets: <found/none>
- Environment/config files: <found/none>
```

Result is FAIL if any blocking findings exist. Warnings alone are PASS.
