End-to-end shipping pipeline. Idempotent — detect current state and resume from the right phase.

Always use this command to ship work. The value is the bundled hygiene, not the individual steps. Never skip it for "small" changes.

## Pipeline

### Phase 1: Detect state
- Run `git status`, check for uncommitted changes, unpushed commits
- Run `gh pr list --head $(git branch --show-current)` to check for existing PRs
- Determine which phase to start from (skip already-completed phases)

### Phase 2: Security scan
- Run `/security-check` on changed files
- If blocking findings exist, stop immediately
- Warnings are reported but don't block

### Phase 3: Run checks
- Run `pnpm typecheck` and `pnpm test`
- If either fails, report failures and stop — don't ship broken code

### Phase 4: Self-review
- Run the same review process as `/review`:
  - Check changed files against `.cursor/rules/`, ADRs in `docs/adr/`, and project conventions
  - Flag type safety issues, error handling gaps, security concerns, performance issues, missing tests
- If issues are found, report them and stop for the user to address

### Phase 5: Session audit
Catch documentation and config gaps before they ship. Scan the conversation for decisions, discoveries, conventions, and corrections made during this session.

**What to look for:**
- Choices between alternatives ("let's go with X instead of Y")
- Debugging discoveries ("the issue was...")
- Conventions established or reinforced
- Workarounds needed
- Milestones reached

**Cross-reference against existing docs and present findings:**

- **Must-update** — Knowledge that will cause problems if lost. For each: what, where, suggested content.
  - Architectural decisions with tradeoffs → `docs/adr/`
  - Roadmap progress, completed phases/tasks → `docs/implementation-roadmap.md`
  - Stale status markers (features completed but still marked incomplete in docs)
  - Stale values (if code changed constants/config, grep docs for old values)
- **Nice-to-have** — Useful but not critical. Brief list.
  - Implementation patterns, guides
  - New coding conventions → `.cursor/rules/`
  - Pattern discoveries, gotchas → `.cursor/rules/`
- **Already captured** — Decisions checked and confirmed accurate.

If nothing found, say so briefly and proceed.

User approves which items to act on — updates get bundled into the commit. If user says "skip" or "just ship it," proceed without updates.

### Phase 6: Commit
- Stage all relevant changes (including any doc/config updates from phase 5)
- Generate a conventional commit message from the work done
- Commit (respect hooks — never `--no-verify`)

### Phase 7: Push and create PR
- Give the user the `git push -u origin <branch>` command to run manually (pushing is blocked from the agent)
- Once the user confirms the push succeeded, run `gh pr create` with a descriptive title and body
- Body should include a Summary section (2-3 bullet points) and a Test Plan section
- Report the PR URL when done
