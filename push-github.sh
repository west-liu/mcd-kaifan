#!/usr/bin/env bash
# 开饭参谋 · 一键推送到 GitHub
#
# ─── 前置（只需做一次，20 秒）─────────────────────────────
# 1. 打开 https://github.com/new
# 2. Repository name 填：mcd-kaifan
# 3. 选 Public
# 4. **不要**勾 "Add a README file" / .gitignore / license（必须空仓库）
# 5. 点 Create repository
#
# ─── 然后跑这个脚本 ─────────────────────────────────────
#   bash push-github.sh
# 或指定仓库名：
#   bash push-github.sh my-repo-name
#
# 跑完会打印仓库地址和 GitHub Pages 地址。
# Pages 需要手动开一次：仓库 → Settings → Pages → Source 选 main / (root) → Save
# 约 1 分钟后生效：https://west-liu.github.io/mcd-kaifan/
# ────────────────────────────────────────────────────────

set -e
REPO="${1:-mcd-kaifan}"
USER="west-liu"

cd "$(dirname "$0")"

echo "→ 仓库：git@github.com:$USER/$REPO.git"

git init -q 2>/dev/null || true
git add -A

if git diff --cached --quiet 2>/dev/null; then
  echo "→ 没有新改动，跳过 commit"
else
  git -c user.name="$USER" -c user.email="$USER@users.noreply.github.com" \
      commit -q -m "开饭参谋：麦当劳 MCP 团餐 AI 搭配师（WaytoAGI 1024 · 用餐赛道）"
  echo "→ 已 commit"
fi

git branch -M main 2>/dev/null || true
git remote remove origin 2>/dev/null || true
git remote add origin "git@github.com:$USER/$REPO.git"

echo "→ 推送中..."
git push -u origin main

echo
echo "✅ 完成"
echo "   仓库     https://github.com/$USER/$REPO"
echo "   源码     https://github.com/$USER/$REPO/tree/main/lib"
echo "   Pages    https://$USER.github.io/$REPO/      （需去 Settings → Pages 开一下）"
echo "   自动演示 https://$USER.github.io/$REPO/demo.html"
