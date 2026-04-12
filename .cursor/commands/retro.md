End-of-session retrospective. Analyze the session to surface learnings, codify conventions, and track recurring patterns.

## Steps

### 1. Gather session context
- Run `git diff main...HEAD` or `git log --oneline main..HEAD` to see what was done
- Review conversation context for decisions, struggles, discoveries, and patterns

### 2. Classify findings

- **Apply now** — coding conventions that should become rules, patterns to codify
- **Skill candidates** — repeating patterns that could become commands or skills
- **Already captured** — confirm existing rules/conventions that worked well
- **ADR-worthy** — architectural decisions made during implementation that should be recorded

### 3. Act on findings

**Apply now:**
- Create or update files in `.cursor/rules/` for new conventions or patterns

**Skill candidates:**
- Read `.cursor/skill-watch.md` (create if it doesn't exist)
- If the pattern is already listed, increment its observation count
- If new, append it with count 1
- Patterns with 3+ observations are **strong candidates** — flag them prominently in the summary

Format for `.cursor/skill-watch.md`:
```
# Skill Watch

Recurring patterns observed during retros. Patterns with 3+ observations are strong candidates for becoming commands or skills.

## Patterns

### <pattern-name>
- **Observations:** <N>
- **Description:** <what the pattern is>
- **Last seen:** <date>
- **Notes:** <any context>
```

**ADR-worthy:**
- For each, create a new ADR in `docs/adr/` following the existing numbering convention (e.g. `018-<title>.md`)
- Use the same format as existing ADRs in that directory

### 4. Summarize
- Brief report of what was found and acted on
- Highlight any strong skill candidates (3+ observations)
- Suggest next steps (clear context, start fresh, etc.)
