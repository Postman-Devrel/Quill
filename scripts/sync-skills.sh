#!/usr/bin/env bash
# Pulls specific skill folders from the devrel-claude-code-skills repo into
# this project's skills/ folder, as plain file copies (no submodules/symlinks).
# Run manually, or on a schedule via .github/workflows/sync-skills.yml.
set -euo pipefail

UPSTREAM_REPO="https://github.com/Postman-Devrel/devrel-claude-code-skills.git"
SKILLS=(blog-copyeditor blog-ideas blog-write)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_SKILLS_DIR="$PROJECT_ROOT/skills"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Cloning $UPSTREAM_REPO..."
git clone --depth 1 --quiet "$UPSTREAM_REPO" "$WORK_DIR/upstream"

for skill in "${SKILLS[@]}"; do
  src="$WORK_DIR/upstream/skills/$skill"
  dest="$LOCAL_SKILLS_DIR/$skill"

  if [ ! -d "$src" ]; then
    echo "warning: '$skill' not found upstream at skills/$skill, skipping" >&2
    continue
  fi

  mkdir -p "$dest"
  rsync -a --delete "$src/" "$dest/"
  echo "synced $skill"
done

echo
echo "Done. Review changes with: git -C \"$PROJECT_ROOT\" status skills/"
