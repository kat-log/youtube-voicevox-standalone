import type { ParallelPlaybackConfig } from '@/types/state';
import { getState } from './state';
import { getTtsEngine } from './tts-api';

const DEFAULT_CONFIG: ParallelPlaybackConfig = {
  alwaysEnabled: false,
  alwaysMaxConcurrent: 3,
  autoEnabled: false,
  autoTriggerThreshold: 10,
  autoMaxConcurrent: 3,
};

let config: ParallelPlaybackConfig = { ...DEFAULT_CONFIG };

export function getParallelPlaybackConfig(): ParallelPlaybackConfig {
  return config;
}

export function setParallelPlaybackConfig(newConfig: ParallelPlaybackConfig): void {
  config = newConfig;
}

export function loadParallelPlaybackConfigFromStorage(): void {
  chrome.storage.sync.get(['parallelPlaybackConfig'], (data) => {
    if (data.parallelPlaybackConfig) {
      config = { ...DEFAULT_CONFIG, ...data.parallelPlaybackConfig };
    }
  });
}

/**
 * 実効的な同時再生数を返す。
 * - ブラウザTTS(chrome.tts)は並列再生不可のため常に1
 * - 常時並列再生が有効なら alwaysMaxConcurrent
 * - 自動並列再生が有効かつキューがしきい値以上なら autoMaxConcurrent
 * - それ以外は1（シリアル再生）
 */
export function getEffectiveMaxConcurrent(): number {
  if (getTtsEngine() === 'browser') return 1;

  if (config.alwaysEnabled) {
    return config.alwaysMaxConcurrent;
  }

  if (config.autoEnabled) {
    const state = getState();
    const pending = state.commentQueue.length + state.audioQueue.length;
    if (pending >= config.autoTriggerThreshold) {
      return config.autoMaxConcurrent;
    }
  }

  return 1;
}
