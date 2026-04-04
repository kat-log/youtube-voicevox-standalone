# リリース運用ルール

## バージョン管理

- バージョニングは Semantic Versioning（semver）に従う
- タグは `v1.2.0` 形式（`v` プレフィックス必須）
- **バージョンの正とするファイルは `public/manifest.json` の `version` フィールド**
  - `package.json` の `version` は参照しない（管理外）

## リリース手順（必ずこの順番で）

1. `public/manifest.json` の `version` を更新してコミット
2. `git tag v{version}` でタグを作成
3. `git push origin v{version}` でタグを push

タグ push で GitHub Actions（`.github/workflows/release.yml`）が自動実行される：
- `npm run build` → `dist/` を zip 化 → GitHub Release 作成・zip 添付

## zip ファイル

- ファイル名: `youtube-voicevox-v{version}.zip`
- `dist/` の**中身**がアーカイブのルートに入る形式（`dist/` フォルダ自体は含まない）

## リリース前チェックリスト

- `public/manifest.json` の `version` がタグのバージョンと一致しているか
- CI（`.github/workflows/ci.yml`）が green になっているか
