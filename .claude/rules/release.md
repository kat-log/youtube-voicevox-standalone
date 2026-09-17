# リリース運用ルール

リリース作業は `/release` スキルで一括実行する（手順の正は `.claude/skills/release/SKILL.md`）。
以下はスキルを使わない場合も含めて常に守る不変条件。

## バージョン

- Semantic Versioning に従う
- **バージョンの正は `public/manifest.json` の `version` フィールド**
  - `package.json` の `version` は参照しない（管理外）
- タグは `v1.2.0` 形式（`v` プレフィックス必須）。タグと manifest のバージョンは必ず一致させる

## zip

- ファイル名: `youtube-voicevox-v{version}.zip`
- `dist/` の**中身**がアーカイブのルートに入る形式（`dist/` フォルダ自体は含まない）
- Chrome Web Store への提出はこの zip を使って手動で行う

## リリース前の前提

- CI（`.github/workflows/ci.yml`）が green であること
