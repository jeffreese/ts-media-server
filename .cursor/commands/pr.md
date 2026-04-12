Create a pull request for the current changes.

1. Run `git diff` to see all staged and unstaged changes
2. Run `git status` to see untracked files
3. Stage all relevant changes (exclude .env, credentials, and database files)
4. Write a clear, concise commit message based on what changed — focus on the "why" not the "what"
5. Commit (respect hooks — never `--no-verify`)
6. Give the user the `git push -u origin <branch>` command to run manually (pushing is blocked from the agent)
7. Once the user confirms the push succeeded, run `gh pr create` with a descriptive title and body
8. The PR body should include a Summary section (2-3 bullet points) and a Test Plan section
9. Return the PR URL when done
