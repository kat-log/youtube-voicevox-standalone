# YouTube ライブコメント音声読み上げクローム拡張機能

YouTube のライブのコメントを、音声読み上げソフト「VOICEVOX」のずんだもんの声で読み上げるようにするクローム拡張機能です。

## 📋 概要

この拡張機能は、YouTube のライブ配信でリアルタイムに投稿されるコメントを自動で取得し、VOICEVOX の音声合成技術を使用して音声で読み上げる機能を提供します。視覚障害のある方や、画面を見ながら他の作業をしている方にとって、ライブコメントを聞き逃すことなく楽しむことができます。

## ✨ 主な機能

- **リアルタイムコメント取得**: YouTube ライブ配信のコメントをリアルタイムで取得
- **VOICEVOX 音声合成**: 複数の話者から選択可能（ずんだもん、四国めたん、春日部つむぎなど）
- **音声調整機能**:
  - 再生速度の調整（0.1 倍速〜3.0 倍速）
  - 音量調整（0〜1.0）
- **最新コメントのみモード**: 最新のコメントのみを取得するオプション
- **キーボードショートカット**:
  - `Alt+Shift+S`: コメント読み上げ開始
  - `Alt+Shift+Q`: コメント読み上げ停止
- **デバッグ機能**: ログ表示機能で動作状況を確認

## 🛠️ 技術仕様

- **Manifest Version**: 3
- **対応ブラウザ**: Google Chrome
- **音声合成 API**: [TTS Quest](https://tts.quest/) (VOICEVOX 互換)
- **YouTube API**: YouTube Data API v3
- **ビルドツール**: Vite
- **言語**: TypeScript

## 📦 ファイル構成

```
src/                        # TypeScript ソース
├── background/
│   ├── index.ts            # エントリーポイント
│   ├── state.ts            # 状態管理
│   ├── messaging.ts        # メッセージハンドラ
│   ├── youtube-api.ts      # YouTube API通信
│   ├── tts-api.ts          # TTS Quest API通信
│   ├── audio-player.ts     # 音声再生管理
│   ├── comment-filter.ts   # コメントフィルター
│   ├── tab-manager.ts      # タブ管理
│   └── lifecycle.ts        # ライフサイクル管理
├── popup/
│   ├── popup.html          # ポップアップUI
│   └── popup.ts            # ポップアップの動作制御
├── styles/
│   └── styles.scss         # SCSSソースファイル
└── types/                  # 型定義
    ├── state.ts
    ├── messages.ts
    ├── api-responses.ts
    └── global.d.ts
public/                     # 静的アセット（Viteがdist/にコピー）
├── manifest.json           # 拡張機能の設定ファイル
└── icon/                   # アイコンファイル
dist/                       # ビルド出力（Chrome拡張として読み込むディレクトリ）
```

## 🚀 セットアップ方法

### 1. 必要な API キーの取得

#### YouTube Data API v3

1. [Google Cloud Console](https://console.cloud.google.com/)にアクセス
2. 新しいプロジェクトを作成または既存のプロジェクトを選択
3. YouTube Data API v3 を有効化
4. 認証情報で API キーを作成

#### TTS Quest API

1. [TTS Quest](https://tts.quest/)にアクセス
2. アカウントを作成して API キーを取得

### 2. 拡張機能のインストール

1. このリポジトリをクローンまたはダウンロード
2. `npm install` で依存パッケージをインストール
3. `npm run build` でビルド（`dist/` ディレクトリが生成される）
4. Chrome で `chrome://extensions/` にアクセス
5. 「デベロッパーモード」を有効化
6. 「パッケージ化されていない拡張機能を読み込む」をクリック
7. `dist` フォルダを選択

### 3. 設定

1. 拡張機能のアイコンをクリックしてポップアップを開く
2. 以下の項目を設定：
   - **VOICEVOX API Key**: TTS Quest で取得した API キー
   - **YouTube API Key**: Google Cloud Console で取得した API キー
   - **話者選択**: 使用したい VOICEVOX の話者を選択
   - **再生速度**: デフォルト 1.0（0.1〜3.0 で調整可能）
   - **音量**: デフォルト 1.0（0〜1.0 で調整可能）

## 📖 使用方法

### 基本的な使い方

1. YouTube のライブ配信ページを開く
2. 拡張機能のアイコンをクリック
3. 必要な設定を行い、「Play」ボタンをクリック
4. ライブコメントが音声で読み上げられます
5. 「Stop」ボタンで読み上げを停止

### キーボードショートカット

- **Alt+Shift+S**: コメント読み上げ開始
- **Alt+Shift+Q**: コメント読み上げ停止

### 高度な設定

- **最新コメントのみモード**: 最新のコメントのみを取得する場合に有効化
- **速度調整**: ボタンまたはスライダーで再生速度を調整
- **音量調整**: スライダーで音量を調整

## 🔧 トラブルシューティング

### よくある問題

1. **「YouTube API キーが設定されていません」エラー**

   - YouTube Data API v3 の API キーが正しく設定されているか確認
   - API キーに YouTube Data API v3 の権限があるか確認

2. **「この動画はライブ配信ではありません」エラー**

   - YouTube のライブ配信ページにいることを確認
   - 配信が開始されていることを確認

3. **音声が再生されない**

   - VOICEVOX API キーが正しく設定されているか確認
   - ブラウザの音声設定を確認
   - デバッグログでエラーメッセージを確認

4. **コメントが取得されない**
   - ライブ配信がアクティブであることを確認
   - ネットワーク接続を確認
   - デバッグログで詳細なエラーを確認

### デバッグ機能

ポップアップの「ログ表示」セクションで、以下の情報を確認できます：

- YouTube API の応答
- VOICEVOX API のリクエスト・レスポンス
- エラーメッセージ
- コメント取得状況

## 🤝 貢献

このプロジェクトへの貢献を歓迎します。以下の方法で貢献できます：

1. バグレポートの提出
2. 機能要望の提案
3. プルリクエストの送信
4. ドキュメントの改善

## 📄 ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。

## 🙏 謝辞

- [VOICEVOX](https://voicevox.hiroshiba.jp/) - 音声合成エンジン
- [TTS Quest](https://tts.quest/) - VOICEVOX 互換 API サービス
- [YouTube Data API](https://developers.google.com/youtube/v3) - YouTube API

## 📞 サポート

問題や質問がある場合は、GitHub の Issues ページで報告してください。

---

**注意**: この拡張機能は個人利用を目的としており、YouTube の利用規約に従ってご利用ください。
