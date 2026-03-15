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

// デバッグ情報をポップアップに送信する関数
export function sendDebugInfo(message: string): void {
  chrome.runtime
    .sendMessage({
      action: 'debugInfo',
      message,
    })
    .catch(() => {});
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
