import { getState } from './state';

// ステータス情報をポップアップに送信する関数
export function sendStatus(status: string, message = ''): void {
  const state = getState();
  chrome.runtime
    .sendMessage({
      action: 'updateStatus',
      status,
      message,
      commentCount: state.commentCount,
      queueLength: state.commentQueue.length + state.audioQueue.length,
    })
    .catch(() => {});
}

const MAX_LOG_ENTRIES = 500;

// デバッグ情報をポップアップに送信し、session storage に永続化する関数
export function sendDebugInfo(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${message}`;

  // session storage に追記
  chrome.storage.session.get({ debugLogs: [] }, (data) => {
    const logs: string[] = data.debugLogs;
    logs.push(entry);
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.splice(0, logs.length - MAX_LOG_ENTRIES);
    }
    chrome.storage.session.set({ debugLogs: logs });
  });

  // リアルタイム配信（ポップアップ・ログページが開いていれば受信）
  chrome.runtime
    .sendMessage({
      action: 'debugInfo',
      message,
      timestamp,
    })
    .catch(() => {});
}

// session storage のログをクリアする関数
export function clearDebugLogs(): void {
  chrome.storage.session.set({ debugLogs: [] });
}

// エラーメッセージをポップアップに送信する関数
export function updateErrorMessage(message: string): void {
  chrome.runtime
    .sendMessage({
      action: 'updateErrorMessage',
      message,
    })
    .catch(() => {});
}
