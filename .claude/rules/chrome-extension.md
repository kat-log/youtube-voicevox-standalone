# Chrome 拡張機能 固有ルール

YouTube ライブチャットを VOICEVOX で読み上げる Chrome 拡張（Manifest V3）。
ビルド構成・エントリーポイント・npm スクリプトの正は `vite.config.ts` と `package.json`。

## 動作確認

Chrome の拡張機能ページ（`chrome://extensions/`）で `dist/` フォルダを読み込んで確認する。

## ハブページのメンテナンス

`src/hub/hub.html` は全ページへのナビゲーションを一元化するページ一覧（目次）ページ。

以下の場合は必ず `src/hub/hub.html` も合わせて更新すること：

- 新しいユーザー向けページを追加したとき → カードを追加する
- 既存ページのファイルパスや名前を変更したとき → `href` を更新する
- ページを削除したとき → 該当カードを削除する

更新箇所: `hub.html` 内の `<a class="card" href="...">` 要素
