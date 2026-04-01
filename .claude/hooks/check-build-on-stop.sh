#!/bin/bash
# Stop フック: src/ に未ビルドの変更があれば npm run build を実行し、失敗したらブロック

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$PROJECT_DIR" || exit 0

# src/ に変更がなければスキップ（README更新などはビルド不要）
if git diff --quiet HEAD -- 'src/' 2>/dev/null; then
  exit 0
fi

# ビルド実行
BUILD_OUTPUT=$(npm run build 2>&1)
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  ESCAPED=$(echo "$BUILD_OUTPUT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
  echo "{\"decision\":\"block\",\"reason\":\"src/ のファイルが変更されていますが、ビルドに失敗しました。エラーを修正してから完了してください。\\n\\nビルドエラー:\\n${ESCAPED}\"}"
  exit 0
fi

# ビルド成功 → 通過
exit 0
