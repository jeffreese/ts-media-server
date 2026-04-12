Static security analysis on changed files. Catches secrets, injection vulnerabilities, and OWASP top-10 patterns before they ship.

The user can specify a path or `--all` in their prompt to override the default changed-files mode.

## Prerequisites

Requires `semgrep`. Check with `which semgrep`. If missing, fail with install instructions:
```
semgrep is not installed. Install it:
  brew install semgrep        # macOS
  pip install semgrep         # pip
  https://semgrep.dev/docs/getting-started/
```

## Steps

### 1. Determine scan target

- **Default (no user-specified path):** scan changed files only.
  Run `git diff --name-only $(git merge-base HEAD main)...HEAD`, `git diff --name-only`, and `git diff --name-only --cached`. Union all three, filter to files that still exist.
  If no changed files: report "Nothing to scan — no changed files detected." and exit clean.
- **User specifies a path:** scan that path.
- **User specifies `--all`:** scan the project root.

### 2. Run semgrep

```bash
semgrep --config p/default --config p/secrets --config p/owasp-top-ten --config p/javascript --config p/typescript --json --no-git-ignore <target>
```

For changed-files mode, pass file paths directly (not a directory).

### 3. Classify findings

| Semgrep severity | Action |
|---|---|
| ERROR | **Block** — must fix before shipping |
| WARNING | **Warn** — flag but don't block |
| INFO | **Warn** — flag but don't block |

### 4. Manual spot-checks

Go beyond what semgrep catches. For each, grep the scan target:

- **Dangerous DOM patterns:** `dangerouslySetInnerHTML`, `innerHTML`, `eval(`, `new Function(`
- **SQL injection vectors:** string interpolation in queries vs. parameterized — look for `.exec`, `.raw`, template-literal SQL
- **Hardcoded secrets:** common key prefixes (`sk-`, `sk_live`, `AKIA`, `ghp_`, `xoxb-`, `eyJ`) — distinguish real secrets from test fixtures
- **Committed config:** check that `.env` files are gitignored, no tokens in committed JSON/YAML

### 5. Report results

Always include a validation summary proving the scan did real work.

```
## Security Check Results

### Scan Summary
- **Files scanned:** <N> (<breakdown by extension>)
- **Rulesets:** p/default, p/secrets, p/owasp-top-ten, p/javascript, p/typescript
- **Scan target:** <"changed files", specific path, or "entire project">

### Manual Spot-Checks
- **Dangerous DOM patterns:** <found/none>
- **SQL injection vectors:** <found/none, with detail>
- **Hardcoded secrets:** <found/none, note test fixtures if applicable>
- **Environment/config files:** <found/none>

### Findings
<if clean>
No issues found.

<if findings exist, group by severity>
#### Blocking (<count>)
- **<rule-id>** — <message>
  `<file>:<line>` — <snippet context>

#### Warnings (<count>)
- **<rule-id>** — <message>
  `<file>:<line>` — <snippet context>
```

Keep snippet context to one line.

### 6. Exit behavior

- **Blocking findings:** report and stop. When called from `/ship`, this halts the pipeline.
- **Only warnings:** report and continue.
- **Clean:** proceed.
