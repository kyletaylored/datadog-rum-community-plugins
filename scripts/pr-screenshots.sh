#!/usr/bin/env bash
# Attach screenshots to a pull request (AGENTS.md § "Pull requests —
# screenshots for UI changes").
#
#   scripts/pr-screenshots.sh <pr-number> <image>... [--caption "text"]
#
# GitHub's API can't upload images to a PR, so the images are committed to the
# `pr-screenshots` branch (an orphan branch holding only screenshots, never
# merged) under <number>/, and a "Screenshots" section embedding them is
# appended to the PR body. Re-running for the same PR replaces files with the
# same name and replaces the section. Capture the images first with
# scripts/site-screenshots.mjs.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <pr-number> <image>... [--caption text]" >&2
  exit 1
fi

pr="$1"; shift
caption=""
images=()
while [ $# -gt 0 ]; do
  case "$1" in
    --caption) caption="$2"; shift 2 ;;
    *) images+=("$1"); shift ;;
  esac
done
case "$pr" in ''|*[!0-9]*) echo "PR number must be numeric" >&2; exit 1 ;; esac

repo_root=$(git rev-parse --show-toplevel)
slug=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
work=$(mktemp -d)
trap 'git -C "$repo_root" worktree remove --force "$work" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

if git -C "$repo_root" ls-remote --exit-code --heads origin pr-screenshots >/dev/null 2>&1; then
  git -C "$repo_root" fetch -q origin pr-screenshots
  git -C "$repo_root" worktree add -q --detach "$work" FETCH_HEAD
else
  git -C "$repo_root" worktree add -q --detach "$work"
  git -C "$work" checkout -q --orphan pr-screenshots-new
  git -C "$work" rm -rqf . >/dev/null 2>&1 || true
  printf '# PR screenshots\n\nImages embedded in pull request descriptions by scripts/pr-screenshots.sh. Never merged.\n' > "$work/README.md"
fi

mkdir -p "$work/$pr"
body="<!-- pr-screenshots -->"$'\n'"## Screenshots"
[ -n "$caption" ] && body+=$'\n\n'"$caption"
for img in "${images[@]}"; do
  name=$(basename "$img")
  cp "$img" "$work/$pr/$name"
  label=${name%.*}; label=${label//[-_]/ }
  body+=$'\n\n'"**${label}**"$'\n\n'"![${label}](https://github.com/${slug}/blob/pr-screenshots/${pr}/${name}?raw=true)"
done

git -C "$work" add -A
git -C "$work" commit -q -m "Screenshots for #${pr}"
git -C "$work" push -q origin HEAD:refs/heads/pr-screenshots
# Replace any earlier Screenshots section (from its marker to the end).
current=$(gh pr view "$pr" --json body --jq .body)
current=${current%%<!-- pr-screenshots -->*}
printf '%s\n\n%s\n' "${current%$'\n'}" "$body" > "$work/.body.md"
gh pr edit "$pr" --body-file "$work/.body.md" >/dev/null
count=${#images[@]}
echo "Attached ${count} screenshot(s) to #${pr}"
