Create a design brief that transfers the current session's understanding to a future session. The goal is to close the gap between "stranger with a task list" and "someone who was in the room."

The user may specify a title in their prompt. If not, derive one from the problem statement.

## Step 1: Mine the Conversation

Scan the full conversation and extract raw material across six categories. Not all will be present in every session, but actively look for each.

### 1. The Problem
What was identified as wrong, missing, or improvable? Capture it in the user's framing:
- What triggered the investigation
- What was discovered (the actual shape of the problem)
- Why it matters

### 2. Options Explored
Every approach discussed, whether adopted or not. For each:
- What the option was
- Key trade-offs (just what mattered, not exhaustive)
- Whether it was adopted, rejected, or deferred — and why

A future session that only sees the chosen solution can't evaluate edge cases because it doesn't know what was ruled out.

### 3. The Decision and Why
- What was chosen
- The specific reasoning that made it win
- Constraints or conditions that shaped the choice
- The user's reaction — enthusiasm, hesitation, conditions

### 4. Key Insights
Realizations that emerged during discussion and would be expensive to re-derive. The "aha moments" that weren't obvious at the start.

### 5. Design Principles
Implicit or explicit principles that should guide implementation. These often emerge from reasoning rather than being stated directly.

### 6. Open Questions
Things flagged but not resolved, with enough context to pick them up cold.

**How to extract:**
- Read through the conversation chronologically
- Note where the user's thinking evolved or shifted
- Capture the user's actual words for preferences — don't paraphrase away nuance
- Watch for pushback moments (in either direction) — these reveal what matters

## Step 2: Write the Design Brief

Save to `docs/handoffs/<title>-handoff.md` using kebab-case filename.

Use this template:

```markdown
---
title: "<Title>"
date: <today>
type: handoff
status: ready
---

# <Title>

## The Problem

[What's wrong, why it matters, what triggered the investigation.
Write so someone with zero context understands the problem in 30 seconds.]

## Options Explored

[Each option as a subsection with trade-offs and verdict.]

### Option A: <Name>
<Description. Trade-offs. Verdict: adopted / rejected / deferred — and why.>

### Option B: <Name>
...

## The Approach

[What was chosen and the specific reasoning. Write as a narrative —
the reader should understand not just WHAT but WHY this won.]

## Key Insights

[Bullet list of realizations that would be expensive to re-derive.
Each should be self-contained.]

## Design Principles

[Implicit rules that should guide implementation. Help the future session
make judgment calls the plan doesn't explicitly cover.]

## Implementation Plan

[Steps to execute, with enough "why" context that the executor can adapt.
Group into phases if the work spans multiple sessions.]

### Phase 1: <Name>
1. **<Step>** — <what to do and why>
2. ...

## Open Questions

[Questions flagged but not resolved, with enough context to pick them up cold.]

## How to Start

[Concrete "first 5 minutes" guide. What to read first, what to build first,
what to validate before going further.]
```

Mark sections "N/A" if truly not applicable, but don't skip them.

## Done

Show the user where the brief was saved and a one-line summary of what it covers.
