#!/usr/bin/env bash
set -euo pipefail

case "$PWD" in
  *.old_copy.*|*.new_copy.*)
    exit 0
    ;;
esac

if git rev-parse --verify HEAD >/dev/null 2>&1; then
  exit 0
fi

STACK="$1"
VISIBILITY="$2"
ORG="$3"
PROJECT_NAME="$4"
DESCRIPTION="$5"
CREATE_REMOTE="$6"

mise trust
mise install

case "$STACK" in
  rust)
    mise x -- cargo generate-lockfile
    ;;
  uv)
    mise x -- uv lock
    mise x -- uv sync
    ;;
  bun)
    mise x -- bun install
    mise run build
    ;;
  base)
    ;;
  *)
    echo "error: unsupported stack: ${STACK}" >&2
    exit 1
    ;;
esac

git init -b main
mise x -- hk validate
mise x -- hk install --mise

for key in $(git config --local --name-only --get-regexp '^hook\.hk-.*\.command$' 2>/dev/null || true); do
  cmd=$(git config --local --get "$key")
  case "$cmd" in
    *"--silent -n"*)
      ;;
    *)
      git config --local "$key" "${cmd} --silent -n"
      ;;
  esac
done

if [ "$CREATE_REMOTE" != "true" ]; then
  git add -A
  mise run check
  git reset -q
  exit 0
fi

gh repo create "${ORG}/${PROJECT_NAME}" "--${VISIBILITY}" --description "${DESCRIPTION}"
git remote add origin "git@github.com:${ORG}/${PROJECT_NAME}.git"
git add LICENSE .gitignore
git commit -m "chore(repo): 初始化仓库许可证与忽略规则"
git push -u origin main

if [ "$VISIBILITY" = "public" ]; then
  gh repo edit "${ORG}/${PROJECT_NAME}" \
    --enable-auto-merge \
    --enable-squash-merge \
    --enable-merge-commit=false \
    --enable-rebase-merge=false \
    --delete-branch-on-merge
  gh api -X PATCH "repos/${ORG}/${PROJECT_NAME}" \
    -f squash_merge_commit_title=PR_TITLE \
    -f squash_merge_commit_message=BLANK >/dev/null
  gh api -X PUT "repos/${ORG}/${PROJECT_NAME}/private-vulnerability-reporting" >/dev/null
  gh api -X POST "repos/${ORG}/${PROJECT_NAME}/rulesets" --input .github/ruleset.json >/dev/null
else
  gh repo edit "${ORG}/${PROJECT_NAME}" \
    --enable-squash-merge \
    --enable-merge-commit=false \
    --enable-rebase-merge=false \
    --delete-branch-on-merge
  gh api -X PATCH "repos/${ORG}/${PROJECT_NAME}" \
    -f squash_merge_commit_title=PR_TITLE \
    -f squash_merge_commit_message=BLANK >/dev/null
fi

git checkout -b chore/init-infra
git add -A
mise run check
git commit -m "chore(infra): 初始化工程基建与静态门禁"
git push -u origin chore/init-infra

gh pr create \
  --title "chore(infra): 初始化工程基建与静态门禁" \
  --body $'## 变更说明\n\n初始化仓库工程基建、静态门禁与自动化流水线。'

for _ in $(seq 1 15); do
  count=$(gh pr checks --json name --jq 'length' 2>/dev/null || echo 0)
  if [ "${count:-0}" -gt 0 ]; then
    break
  fi
  sleep 2
done

gh pr checks --watch
gh pr merge --squash --delete-branch
git checkout main
git pull --ff-only
