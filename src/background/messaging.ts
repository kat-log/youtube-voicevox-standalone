import type { ExtensionStatus } from '@/types/state';
import type { LogLevel, LogEntry } from '@/types/messages';
import { getState, updateState } from './state';

// ステータス情報をポップアップに送信する関数
export function sendStatus(status: ExtensionStatus, message = ''): void {
  updateState({ currentStatus: status });
  const state = getState();
  chrome.runtime
    .sendMessage({
      action: 'updateStatus',
      status,
      message,
      commentCount: state.commentCount,
      queueLength: state.commentQueue.length + state.audioQueue.length,
      isRushActive: state.isRushActive,
    })
    .catch(() => {});
}

// キュー状態を [音声生成待ち:x, 再生待ち:y, 再生中:z] 形式でフォーマット
export function formatQueueState(): string {
  const state = getState();
  return `[音声生成待ち:${state.commentQueue.length}, 再生待ち:${state.audioQueue.length}, 再生中:${state.playingCount}]`;
}

const MAX_LOG_ENTRIES = 500;

// レベル別eviction: debug→info順に古いものから削除し、warn/errorを長く保持
function trimLogs(logs: LogEntry[]): void {
  let excess = logs.length - MAX_LOG_ENTRIES;
  // Pass 1: debug を古い順に削除
  for (let i = 0; i < logs.length && excess > 0; ) {
    if (logs[i].level === 'debug') {
      logs.splice(i, 1);
      excess--;
    } else {
      i++;
    }
  }
  // Pass 2: info を古い順に削除
  for (let i = 0; i < logs.length && excess > 0; ) {
    if (logs[i].level === 'info') {
      logs.splice(i, 1);
      excess--;
    } else {
      i++;
    }
  }
  // Pass 3: それでも超過なら先頭から削除
  if (logs.length > MAX_LOG_ENTRIES) {
    logs.splice(0, logs.length - MAX_LOG_ENTRIES);
  }
}

// レベル付きログを session storage に保存し、ポップアップ・ログページにブロードキャスト
export function sendLog(level: LogLevel, message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  const entry: LogEntry = { timestamp, level, message };

  chrome.storage.session.get({ debugLogs: [] }, (data) => {
    const logs: LogEntry[] = data.debugLogs;
    logs.push(entry);
    if (logs.length > MAX_LOG_ENTRIES) {
      trimLogs(logs);
    }
    chrome.storage.session.set({ debugLogs: logs });
  });

  chrome.runtime
    .sendMessage({
      action: 'debugInfo',
      level,
      message,
      timestamp,
    })
    .catch(() => {});
}

// 便利関数
export function logDebug(message: string): void { sendLog('debug', message); }
export function logInfo(message: string): void { sendLog('info', message); }
export function logWarn(message: string): void { sendLog('warn', message); }
export function logError(message: string): void { sendLog('error', message); }

// 後方互換エイリアス
export function sendDebugInfo(message: string): void { sendLog('info', message); }

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
