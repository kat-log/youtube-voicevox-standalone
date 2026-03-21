#!/bin/bash
# Stop フック: src/ に変更があればビルド検証を実行

cd "$CLAUDE_PROJECT_DIR" || exit 0

# src/ に変更がなければスキップ
git diff --quiet HEAD -- 'src/' && exit 0

# 型チェック
if ! npx tsc --noEmit 2>&1; then
  echo '{"decision":"block","reason":"TypeScript型チェックに失敗しました。エラーを修正してください。"}'
  exit 0
fi

# ビルド
if ! npm run build 2>&1; then
  echo '{"decision":"block","reason":"ビルドに失敗しました。エラーを修正してください。"}'
  exit 0
fi
