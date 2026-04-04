# Chrome 拡張機能 固有ルール

## プロジェクト概要

YouTube ライブチャットを VOICEVOX で読み上げる Chrome 拡張（Manifest V3）。

## ビルド構成

| 項目 | 内容 |
|------|------|
| ビルドツール | Vite + TypeScript |
| 出力先 | `dist/` |
| エントリーポイント | background, domChat, popup, log, onboarding, stats, speakerSelection, speakerConfig, testSpeak, offscreen |
| パス alias | `@/` → `src/` |

## ファイル配置ルール

- ソースコード: `src/`
- 静的ファイル（manifest.json, icon等）: `public/`
- ビルド成果物: `dist/`（コミット不要、.gitignore 対象）

## manifest.json

- パス: `public/manifest.json`（ソースの正）
- ビルド後は `dist/manifest.json` にコピーされる
- `version` フィールドがリリースバージョンの正

## 開発・検証

```bash
npm run dev      # watch モードでビルド（開発時）
npm run build    # 型チェック + ビルド（リリース時）
npm run lint     # ESLint
npm test         # Vitest
```

Chrome の拡張機能ページ（`chrome://extensions/`）で `dist/` フォルダを読み込んで動作確認する。

## 注意事項

- `npm publish` は行わない（`package.json` に `"private": true`）
- Chrome Web Store への提出は手動（zip を使って Developer Dashboard からアップロード）
