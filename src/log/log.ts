import '../styles/styles.scss';

// 初期化時にダークモード設定を反映
chrome.storage.sync.get(['darkMode'], function (data) {
  let isDark: boolean;
  if (data.darkMode !== undefined) {
    isDark = data.darkMode;
  } else {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  if (isDark) {
    document.body.classList.add('dark-mode');
  }
});

// session storage から保存済みログを復元
chrome.storage.session.get({ debugLogs: [] }, (data) => {
  const debugElement = document.getElementById('debug');
  if (debugElement && data.debugLogs.length > 0) {
    debugElement.textContent = data.debugLogs.join('\n') + '\n';
    const logContentArea = document.getElementById('log-content-area');
    if (logContentArea) {
      logContentArea.scrollTop = logContentArea.scrollHeight;
    }
  }
});

// エラーメッセージ更新のリスナーを追加
chrome.runtime.onMessage.addListener(function (request: { action: string; message?: string; timestamp?: string }) {
  // デバッグメッセージリスナー
  if (request.action === 'debugInfo') {
    const debugElement = document.getElementById('debug');
    const logContentArea = document.getElementById('log-content-area');

    if (debugElement && logContentArea) {
      // スクロール位置の判定
      // クライアントの高さ + スクロール量が、全体の高さとほぼ同じであれば一番下にいると判定
      // 許容誤差を大きめ(50px)にして、ほぼ底付近にいれば自動スクロールを維持する
      const isScrolledToBottom =
        logContentArea.scrollHeight - logContentArea.clientHeight <= logContentArea.scrollTop + 50;

      const timestamp = request.timestamp || new Date().toLocaleTimeString();
      const newMessage = `[${timestamp}] ${request.message}\n`;
      debugElement.insertAdjacentText('beforeend', newMessage);

      // 一番下にいた場合のみ、新しいログに合わせて一番下までスクロールさせる
      if (isScrolledToBottom) {
        logContentArea.scrollTop = logContentArea.scrollHeight;
      }
    }
  }
});

// ログクリア機能
document.getElementById('clear-log')?.addEventListener('click', () => {
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.textContent = '';
  }
  chrome.storage.session.set({ debugLogs: [] });
});
