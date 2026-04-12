Debug odd agent behavior by tracing it back to the config that caused it. The user will describe the symptom in their prompt — a quote, a pattern, or just "you keep doing X."

## Phase 1: Search config

Identify what config is relevant to the symptom. Search these locations for keywords from the symptom description:

1. **Rules** — `.cursor/rules/*.mdc`
2. **Commands** — `.cursor/commands/*.md`
3. **Skills** — `.cursor/skills/`
4. **Hooks** — `.cursor/hooks.json` and `.cursor/hooks/`
5. **Settings** — `.cursor/*.json` files

For each match, assess:
- Does it contradict another loaded piece of config?
- Is it ambiguous enough to be misinterpreted?
- Is it stale (references moved/renamed/deleted things)?
- Could it interact with something else to produce the symptom?

Present findings as a ranked list of suspects, most likely first.

## Phase 2: Recent changes

Check what changed recently in config:

```bash
git log --oneline -20 -- .cursor/
```

Correlate timing: if the behavior started recently, a recent change is the likely cause.

## Phase 3: Hypothesize and discuss

Present your theory:
- **Symptom:** What was observed
- **Suspect config:** Which file(s) and why
- **Mechanism:** How the config produces the behavior
- **Proposed fix:** What to change

If the fix is clear, propose it. If not, narrow it down with the user through conversation.

## Phase 4: Fix

On user approval, apply the fix. Then summarize what was changed and why.
