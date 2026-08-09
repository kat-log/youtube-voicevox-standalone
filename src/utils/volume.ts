/** 音量スライダーの細かさ（段階数）の選択肢 */
export const VOLUME_STEP_COUNTS = [10, 20, 100] as const;

export type VolumeStepCount = (typeof VOLUME_STEP_COUNTS)[number];

export const DEFAULT_VOLUME_STEP_COUNT: VolumeStepCount = 10;

/** storage から読んだ値を正規化（不正値・未設定はデフォルト） */
export function normalizeVolumeStepCount(value: unknown): VolumeStepCount {
  return VOLUME_STEP_COUNTS.includes(value as VolumeStepCount)
    ? (value as VolumeStepCount)
    : DEFAULT_VOLUME_STEP_COUNT;
}

/** 段階数に対応するスライダーの step 値（10段階 → 0.1） */
export function volumeStepSize(stepCount: VolumeStepCount): number {
  return 1 / stepCount;
}

/** 音量を段階数のグリッドに丸める（0〜1 にクランプ） */
export function quantizeVolume(volume: number, stepCount: VolumeStepCount): number {
  if (!Number.isFinite(volume)) return 1.0;
  const clamped = Math.min(1, Math.max(0, volume));
  return Math.round(clamped * stepCount) / stepCount;
}

/** 表示用の音量テキスト（10段階は小数1桁、それ以外は小数2桁） */
export function formatVolume(volume: number, stepCount: VolumeStepCount): string {
  return volume.toFixed(stepCount === 10 ? 1 : 2);
}
