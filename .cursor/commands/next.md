Pick up the next task from the implementation roadmap, set up a branch, and implement it.

1. Read `docs/implementation-roadmap.md` and find the first unchecked task (`- [ ]`)
2. Read any `.cursor/rules/` files for project conventions
3. Check git state:
   - If on a feature branch with uncommitted changes, assume work is in progress — resume it instead of picking a new task
   - If the working tree is dirty on `main`, warn and stop
   - If clean, proceed to create a new branch
4. Create a feature branch from `main` with a conventional prefix: `feat/`, `fix/`, `chore/`, `refactor/`, `docs/` — branch name derived from the task description
5. Implement the task, following project conventions
6. When finished, check the task off in `docs/implementation-roadmap.md` (`- [x]`)
7. Summarize what was done and suggest running `/ship` as the next step
