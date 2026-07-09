#!/bin/bash

FILE=$(cat | jq -r '.tool_input.file_path')

if [ -z "$FILE" ] || [ "$FILE" == "null" ]; then
  exit 0
fi

case "$FILE" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

LINT_OUTPUT=$(npx eslint --fix "$FILE" 2>&1)
LINT_STATUS=$?

if [ $LINT_STATUS -eq 0 ]; then
  exit 0
else
  echo "$LINT_OUTPUT" >&2
  exit 2
fi
