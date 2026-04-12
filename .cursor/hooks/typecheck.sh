#!/usr/bin/env bash
# Runs TypeScript type-checking after file edits.
# Returns type errors as context so the agent can fix them immediately.

set -euo pipefail

if [ ! -f "tsconfig.json" ]; then
  echo '{}' 
  exit 0
fi

if ! command -v npx &> /dev/null; then
  echo '{}'
  exit 0
fi

OUTPUT=$(npx tsc --noEmit 2>&1) || true

if [ -z "$OUTPUT" ]; then
  echo '{}'
  exit 0
fi

ERROR_COUNT=$(echo "$OUTPUT" | grep -c "error TS" || true)

if [ "$ERROR_COUNT" -gt 0 ]; then
  ESCAPED_OUTPUT=$(echo "$OUTPUT" | head -50 | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
  echo "{\"message\": \"TypeScript found ${ERROR_COUNT} error(s):\n${ESCAPED_OUTPUT}\"}"
else
  echo '{}'
fi
