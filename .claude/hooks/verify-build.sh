#!/bin/bash
# PostToolUse フック (Edit|Write): src/ に変更があればビルド検証を実行

# stdin を消費（PostToolUse はツール情報を stdin に送る）
INPUT=$(cat)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$PROJECT_DIR" || exit 0

# 編集されたファイルパスを取得し、src/ 配下でなければスキップ
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
if [[ -n "$FILE_PATH" && "$FILE_PATH" != */src/* ]]; then
  exit 0
fi

# src/ に変更がなければスキップ（フォールバック）
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
