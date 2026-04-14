---
name: release
description: バージョン更新・STORE_LISTING更新・ビルド・タグ付け・GitHubリリース作成を一括実行する
argument-hint: "[patch|minor|major]  ※省略時は前回タグ以降のコミットから自動判定"
---

以下の手順でリリース作業を一括実行してください。

## 事前チェック

1. 現在のブランチが `main` であることを確認する。`main` でなければユーザーに確認を求めて中止する。
2. `public/manifest.json` の `version` フィールドを読み取り、現在のバージョンを把握する。
3. 次バージョンを以下のルールで決定する。

   **引数が指定された場合**（`patch` / `minor` / `major`）: その指定に従う。

   **引数が未指定の場合**: 前回タグ（`git log v{現在バージョン}..HEAD --no-merges --format="%s"`）のコミットメッセージを調べて自動判定する。
   - `BREAKING CHANGE` または `feat!:` を含むコミットがある → `major`
   - `feat:` を含むコミットがある → `minor`
   - それ以外（`fix:` / `docs:` / `chore:` 等のみ） → `patch`

   バージョン算出ルール:
   - patch: `X.Y.Z` → `X.Y.(Z+1)`
   - minor: `X.Y.Z` → `X.(Y+1).0`
   - major: `X.Y.Z` → `(X+1).0.0`

   判定結果をユーザーに提示してから先に進む。

## ステップ 1: manifest.json のバージョン更新

`public/manifest.json` の `"version"` フィールドを新バージョンに書き換える。

## ステップ 2: STORE_LISTING.md の更新

前バージョンタグから HEAD までのコミット（`git log v{旧バージョン}..HEAD --no-merges --format="%h %s"`）を調査し、
STORE_LISTING.md の冒頭アップデート情報セクション（📢）を新バージョンで更新する。

- 新バージョンの変更点を箇条書きで追記する
- ユーザー向けのカジュアルな日本語で書く（技術的な内部実装は含めない）
- 新機能は「！」で強調しユーザーメリットを明示する
- 旧バージョン情報は1世代前まで残し、それ以前はまとめて簡潔に
- feat / fix / docs のうちユーザーに見える変更のみ記載（chore / refactor 等は省略）
- 機能紹介セクション（✨）や使い方（🔧）は、主要な新機能が追加された場合のみ更新する

## ステップ 3: ビルド

```
npm run build
```

ビルドが成功することを確認する。失敗した場合はユーザーに報告して中止する。

## ステップ 4: コミット

```
git add public/manifest.json STORE_LISTING.md
git commit -m "chore: v{新バージョン} リリース"
```

## ステップ 5: タグ作成

```
git tag v{新バージョン}
```

## ステップ 6: push

```
git push origin main
git push origin v{新バージョン}
```

タグ push により GitHub Actions（`.github/workflows/release.yml`）が自動起動し、
`youtube-voicevox-v{新バージョン}.zip` を添付した GitHub Release が作成される。

## ステップ 7: リリース完了確認

`gh run watch` でリリースワークフローの完了を待ち、`gh release view v{新バージョン}` でリリースと zip の存在を確認する。
完了したら結果をユーザーに報告する。
