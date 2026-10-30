#!/usr/bin/env bash
# Rebuild the question bank and republish site/ to the same here.now URL.
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

SLUG="$(cat .herenow-slug 2>/dev/null || true)"
PUBLISH=""
for p in "$HOME/.agents/skills/here-now/scripts/publish.sh" "$HOME/.claude/skills/here-now/scripts/publish.sh"; do
  [ -x "$p" ] && PUBLISH="$p" && break
done
if [ -z "$PUBLISH" ]; then
  echo "here.now skill not found. Install it with: npx skills add heredotnow/skill --skill here-now -g" >&2
  exit 1
fi

python3 build.py

if [ -n "$SLUG" ]; then
  "$PUBLISH" site --slug "$SLUG" --client claude-code/deploy-sh
else
  "$PUBLISH" site --client claude-code/deploy-sh
fi
