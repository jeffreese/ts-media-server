Persist a breadcrumb so the next session can resume where this one left off. Lightweight alternative to `/handoff` for mid-task breaks.

The breadcrumb is written to `.cursor/rules/resume.mdc` with `alwaysApply: true`, so it loads automatically in every new session.

## Behavior

### Saving

If the user provides context in their prompt, use it as the core of the breadcrumb. Enrich it lightly from conversation context if useful (e.g., add file paths or next steps that are clearly relevant).

If the user just says "remember" with no specifics, synthesize from the conversation:
- What were we working on?
- What just got completed?
- What's next?
- Any key context that would be lost (file paths, decisions, blockers)

If you aren't confident in your synthesis, ask rather than guess. The breadcrumb is the only thing the next session will see — accuracy matters more than completeness.

**Always confirm before writing.** Present the breadcrumb first:

```
I'll remember this for next session:
- **Working on:** [what]
- **Completed:** [what just got done]
- **Next:** [what to do next]
- **Key context:** [file paths, decisions, blockers — only if they'd be hard to reconstruct]

Look right?
```

On approval, write `.cursor/rules/resume.mdc` with this format:

```
---
description: Session resume context — present this to the user immediately and delete this file after acknowledgment
alwaysApply: true
---

# IMPORTANT: Resume Context From Previous Session

Present the following context to the user at the start of the conversation. After the user acknowledges, delete this file.

## Working on
[what]

## Completed
[what just got done]

## Next
[what to do next]

## Key context
[file paths, decisions, blockers — only what's needed]
```

### Recalling

If `.cursor/rules/resume.mdc` exists when a session starts, the rule will auto-load and instruct the agent to:

1. Present the context naturally: "Last session you were working on X. You completed Y. Next up: Z. Ready to continue?"
2. When the user confirms (or redirects), **delete** `.cursor/rules/resume.mdc`
3. Proceed with the work

## Rules

- **One breadcrumb at a time.** Writing a new one overwrites the old one.
- **Always confirm before writing.**
- **Delete on resume.** The breadcrumb is ephemeral — once surfaced, it's gone.
- **Don't editorialize.** Capture state, not commentary. Future sessions need facts, not opinions.
