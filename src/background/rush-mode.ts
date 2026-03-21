import type { RushModeConfig } from '@/types/state';
import { getState, updateState } from './state';
import { sendStatus, sendDebugInfo } from './messaging';

const DEFAULT_RUSH_CONFIG: RushModeConfig = {
  enabled: false,
  activateThreshold: 20,
  returnThreshold: 0,
  rushSpeed: 2.0,
};

let rushConfig: RushModeConfig = { ...DEFAULT_RUSH_CONFIG };

export function getRushConfig(): RushModeConfig {
  return rushConfig;
}

export function setRushConfig(config: RushModeConfig): void {
  rushConfig = config;
}

export function loadRushConfigFromStorage(): void {
  chrome.storage.sync.get(['rushModeConfig'], (data) => {
    if (data.rushModeConfig) {
      rushConfig = { ...DEFAULT_RUSH_CONFIG, ...data.rushModeConfig };
    }
  });
}

/**
 * キュー長に基づいてラッシュモードの発動/解除を判定する。
 * キュー変更のたびに呼び出す。ヒステリシスで切替バタつきを防止。
 */
export function evaluateRushMode(): void {
  const state = getState();

  if (!rushConfig.enabled) {
    if (state.isRushActive) {
      updateState({ isRushActive: false });
      sendDebugInfo('自動倍速モード: 設定無効のため解除');
      sendStatus(state.currentStatus);
    }
    return;
  }

  const pending = state.commentQueue.length + state.audioQueue.length;
  const wasActive = state.isRushActive;

  if (!wasActive && pending >= rushConfig.activateThreshold) {
    updateState({ isRushActive: true });
    sendDebugInfo(
      `自動倍速モード ON: 待機${pending}件 >= しきい値${rushConfig.activateThreshold} | 速度${rushConfig.rushSpeed}x`
    );
    sendStatus(getState().currentStatus);
    return;
  }

  if (wasActive && pending <= rushConfig.returnThreshold) {
    updateState({ isRushActive: false });
    sendDebugInfo(
      `自動倍速モード OFF: 待機${pending}件 <= 復帰しきい値${rushConfig.returnThreshold}`
    );
    sendStatus(getState().currentStatus);
  }
}

/**
 * ラッシュモード考慮の実効再生速度を返す。
 * isRushActive なら rushSpeed、そうでなければ baseSpeed をそのまま返す。
 */
export function resolveEffectiveSpeed(baseSpeed: number): number {
  const state = getState();
  if (state.isRushActive && rushConfig.enabled) {
    return rushConfig.rushSpeed;
  }
  return baseSpeed;
}
