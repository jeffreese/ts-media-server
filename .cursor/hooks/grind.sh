#!/usr/bin/env bash
# Stop hook: keeps the agent iterating until tests and typecheck pass.
# Reads JSON from stdin with { status, loop_count, conversation_id }.
# Returns { followup_message } to continue, or {} to stop.

set -euo pipefail

INPUT=$(cat)
STATUS=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
LOOP_COUNT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('loop_count',0))" 2>/dev/null || echo "0")
MAX_ITERATIONS=5

if [ "$STATUS" != "completed" ] || [ "$LOOP_COUNT" -ge "$MAX_ITERATIONS" ]; then
  echo '{}'
  exit 0
fi

if [ -f ".cursor/scratchpad.md" ]; then
  if grep -q "DONE" .cursor/scratchpad.md 2>/dev/null; then
    echo '{}'
    exit 0
  fi
fi

ERRORS=""

if [ -f "tsconfig.json" ] && command -v npx &> /dev/null; then
  TSC_OUTPUT=$(npx tsc --noEmit 2>&1) || true
  TSC_ERRORS=$(echo "$TSC_OUTPUT" | grep -c "error TS" || true)
  if [ "$TSC_ERRORS" -gt 0 ]; then
    ERRORS="${ERRORS}TypeScript: ${TSC_ERRORS} error(s). "
  fi
fi

if [ -f "package.json" ] && grep -q '"test"' package.json 2>/dev/null; then
  if ! pnpm test --run 2>&1 > /dev/null; then
    ERRORS="${ERRORS}Tests: some tests failed. "
  fi
fi

if [ -z "$ERRORS" ]; then
  echo '{}'
  exit 0
fi

ESCAPED_ERRORS=$(echo "$ERRORS" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
echo "{\"followup_message\": \"[Iteration $((LOOP_COUNT + 1))/${MAX_ITERATIONS}] ${ESCAPED_ERRORS}Please fix these issues and try again.\"}"
