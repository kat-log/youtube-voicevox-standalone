import type { RandomSpeedConfig } from '@/types/state';

/** 再生速度スライダーが取りうる下限・上限（popup の speed スライダーと同じ） */
export const MIN_ALLOWED_SPEED = 0.1;
export const MAX_ALLOWED_SPEED = 3.0;

export const DEFAULT_RANDOM_SPEED_CONFIG: RandomSpeedConfig = {
  enabled: false,
  minSpeed: 0.8,
  maxSpeed: 1.5,
};

let randomSpeedConfig: RandomSpeedConfig = { ...DEFAULT_RANDOM_SPEED_CONFIG };

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RANDOM_SPEED_CONFIG.minSpeed;
  return Math.min(MAX_ALLOWED_SPEED, Math.max(MIN_ALLOWED_SPEED, value));
}

/**
 * 設定値を安全な形に整える。
 * 範囲外の値を丸め、下限 > 上限で保存されていた場合は入れ替えて抽選が壊れないようにする。
 */
function normalizeConfig(config: RandomSpeedConfig): RandomSpeedConfig {
  const a = clampSpeed(config.minSpeed);
  const b = clampSpeed(config.maxSpeed);
  return {
    enabled: Boolean(config.enabled),
    minSpeed: Math.min(a, b),
    maxSpeed: Math.max(a, b),
  };
}

export function getRandomSpeedConfig(): RandomSpeedConfig {
  return randomSpeedConfig;
}

export function setRandomSpeedConfig(config: RandomSpeedConfig): void {
  randomSpeedConfig = normalizeConfig({ ...DEFAULT_RANDOM_SPEED_CONFIG, ...config });
}

export function isRandomSpeedEnabled(): boolean {
  return randomSpeedConfig.enabled;
}

export function loadRandomSpeedConfigFromStorage(): void {
  chrome.storage.sync.get(['randomSpeedConfig'], (data) => {
    setRandomSpeedConfig(
      data.randomSpeedConfig
        ? { ...DEFAULT_RANDOM_SPEED_CONFIG, ...data.randomSpeedConfig }
        : { ...DEFAULT_RANDOM_SPEED_CONFIG }
    );
  });
}

/**
 * 設定された範囲から再生速度を1つ抽選する。
 * スライダーと同じ 0.1 刻みに丸めるため、ログ表示と実際の速度がズレない。
 */
export function pickRandomSpeed(): number {
  const { minSpeed, maxSpeed } = randomSpeedConfig;
  const raw = minSpeed + Math.random() * (maxSpeed - minSpeed);
  const rounded = Math.round(raw * 10) / 10;
  // 丸めで範囲外へはみ出さないよう最後にもう一度収める
  return Math.min(maxSpeed, Math.max(minSpeed, rounded));
}
