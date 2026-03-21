import type { AutoCatchUpConfig } from '@/types/state';
import { getState, clearCommentQueue, clearAudioQueue, pushComment } from './state';
import { sendDebugInfo, formatQueueState } from './messaging';

const DEFAULT_AUTO_CATCHUP_CONFIG: AutoCatchUpConfig = {
  enabled: false,
  threshold: 50,
};

const KEEP_COUNT = 3;

let config: AutoCatchUpConfig = { ...DEFAULT_AUTO_CATCHUP_CONFIG };

export function getAutoCatchUpConfig(): AutoCatchUpConfig {
  return config;
}

export function setAutoCatchUpConfig(newConfig: AutoCatchUpConfig): void {
  config = newConfig;
}

export function loadAutoCatchUpConfigFromStorage(): void {
  chrome.storage.sync.get(['autoCatchUpConfig'], (data) => {
    if (data.autoCatchUpConfig) {
      config = { ...DEFAULT_AUTO_CATCHUP_CONFIG, ...data.autoCatchUpConfig };
    }
  });
}

/**
 * キュー長に基づいて自動キャッチアップを判定・実行する。
 * ポーリングで新コメント追加後に呼び出す。
 * 閾値超過時にキューをフラッシュし、最新コメント数件のみ残す。
 * 再生中の音声はそのまま継続する（途中で切ると違和感があるため）。
 * @returns フラッシュが実行された場合 true
 */
export function evaluateAutoCatchUp(): boolean {
  if (!config.enabled) return false;

  const state = getState();
  const pending = state.commentQueue.length + state.audioQueue.length;

  if (pending < config.threshold) return false;

  // フラッシュ実行: 最新コメント数件を保持し残りを破棄
  const keptComments = clearCommentQueue(KEEP_COUNT);
  clearAudioQueue();

  // 保持したコメントをキューに戻す
  for (const comment of keptComments) {
    pushComment(comment);
  }

  const discarded = pending - keptComments.length;
  sendDebugInfo(
    `🔄 最新コメントのみ取得モード自動発動: ${discarded}件破棄, ${keptComments.length}件保持（しきい値${config.threshold}件） | キュー: ${formatQueueState()}`
  );

  return true;
}
