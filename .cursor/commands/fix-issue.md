Fix the GitHub issue specified in the prompt.

1. Fetch the issue details with `gh issue view <number>`
2. Analyze the issue description, labels, and any linked PRs or comments
3. Search the codebase for relevant files based on the issue context
4. Create a new branch: `fix/<issue-number>-<short-description>`
5. Implement the fix, following project conventions in `.cursor/rules/`
6. Write or update tests to cover the fix
7. Run `pnpm typecheck` and `pnpm test` to verify nothing is broken
8. Commit with a message referencing the issue: "Fix #<number>: <description>"
9. Push the branch and create a PR linking to the issue
10. Return the PR URL when done
