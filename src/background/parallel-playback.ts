import type { ParallelPlaybackConfig, ParallelSpeakersConfig } from '@/types/state';
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

// --- 並列再生マルチ話者割り当て ---

const DEFAULT_SPEAKERS_CONFIG: ParallelSpeakersConfig = {
  enabled: false,
  speakerIds: [],
};

let speakersConfig: ParallelSpeakersConfig = { ...DEFAULT_SPEAKERS_CONFIG };
let parallelSlotCounter = 0;

export function getParallelSpeakersConfig(): ParallelSpeakersConfig {
  return speakersConfig;
}

export function setParallelSpeakersConfig(newConfig: ParallelSpeakersConfig): void {
  speakersConfig = newConfig;
}

export function loadParallelSpeakersConfigFromStorage(): void {
  chrome.storage.sync.get(['parallelSpeakersConfig'], (data) => {
    if (data.parallelSpeakersConfig) {
      speakersConfig = { ...DEFAULT_SPEAKERS_CONFIG, ...data.parallelSpeakersConfig };
    }
  });
}

export function resetParallelSlotCounter(): void {
  parallelSlotCounter = 0;
}

/**
 * 並列再生スロットに基づく話者IDを返す。
 * ラウンドロビンで slot 0 → メイン話者、slot 1 → 話者2、slot 2 → 話者3 ...
 */
export function getParallelSpeakerId(originalSpeakerId: string | undefined): string | undefined {
  if (!speakersConfig.enabled) return originalSpeakerId;

  const maxConcurrent = getEffectiveMaxConcurrent();
  if (maxConcurrent <= 1) return originalSpeakerId;

  const slot = parallelSlotCounter % maxConcurrent;
  parallelSlotCounter++;

  if (slot === 0) return originalSpeakerId;
  const speakerId = speakersConfig.speakerIds[slot - 1];
  return speakerId || originalSpeakerId;
}
