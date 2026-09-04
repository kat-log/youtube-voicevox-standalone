import { setRangeFill } from '../popup/slider-utils';
import {
  DEFAULT_VOLUME_STEP_COUNT,
  VOLUME_STEP_COUNTS,
  formatVolume,
  normalizeVolumeStepCount,
  quantizeVolume,
  volumeStepSize,
  type VolumeStepCount,
} from '../utils/volume';

function stepCountFromSlider(value: string): VolumeStepCount {
  return VOLUME_STEP_COUNTS[parseInt(value, 10)] ?? DEFAULT_VOLUME_STEP_COUNT;
}

function updateDisplay(slider: HTMLInputElement, stepCount: VolumeStepCount): void {
  setRangeFill(slider);
  slider.setAttribute('aria-valuetext', `${stepCount}段階`);

  const current = document.getElementById('current-volume-step-count');
  if (current) current.textContent = `${stepCount}段階`;

  const hint = document.getElementById('volume-step-count-hint');
  if (hint) {
    const min = formatVolume(volumeStepSize(stepCount), stepCount);
    hint.textContent = `設定できる最小音量: ${min}（0 = ミュート）`;
  }
}

/**
 * storage の値をスライダーへ再適用する。
 * 設定のインポート／リセットのように storage を直接書き換えた後にも呼ぶ。
 */
export function refreshVolumeGranularity(): void {
  const slider = document.getElementById('volumeStepCount') as HTMLInputElement | null;
  if (!slider) return;

  chrome.storage.sync.get(['volumeStepCount'], (data) => {
    const stepCount = normalizeVolumeStepCount(data.volumeStepCount);
    slider.value = String(VOLUME_STEP_COUNTS.indexOf(stepCount));
    updateDisplay(slider, stepCount);
  });
}

export function initVolumeGranularity(): void {
  const slider = document.getElementById('volumeStepCount') as HTMLInputElement | null;
  if (!slider) return;

  refreshVolumeGranularity();

  slider.addEventListener('input', () => {
    const stepCount = stepCountFromSlider(slider.value);
    updateDisplay(slider, stepCount);

    // 現在の音量を新しい段階数のグリッドに丸めて保存し、再生中なら即時反映する
    chrome.storage.sync.get(['volume'], (data) => {
      const volume = quantizeVolume(data.volume ?? 1.0, stepCount);
      chrome.storage.sync.set({ volumeStepCount: stepCount, volume });
      chrome.runtime.sendMessage({ action: 'setVolume', volume }, () => {
        void chrome.runtime.lastError;
      });
    });
  });
}
