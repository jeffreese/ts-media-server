Create a pull request for the current changes.

1. Run `git diff` to see all staged and unstaged changes
2. Run `git status` to see untracked files
3. Stage all relevant changes (exclude .env, credentials, and database files)
4. Write a clear, concise commit message based on what changed — focus on the "why" not the "what"
5. Commit and push to the current branch (create remote branch with `-u` if needed)
6. Use `gh pr create` to open a pull request with a descriptive title and body
7. The PR body should include a Summary section (2-3 bullet points) and a Test Plan section
8. Return the PR URL when done
