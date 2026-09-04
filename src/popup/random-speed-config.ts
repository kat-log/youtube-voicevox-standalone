import { setRangeFill } from './slider-utils';
import { updateSpeedSliderState } from './tts-engine-config';
import { revealSection } from './section-layout';

export const DEFAULT_RANDOM_SPEED_MIN = 0.8;
export const DEFAULT_RANDOM_SPEED_MAX = 1.5;

function minSlider(): HTMLInputElement {
  return document.getElementById('randomSpeedMin') as HTMLInputElement;
}

function maxSlider(): HTMLInputElement {
  return document.getElementById('randomSpeedMax') as HTMLInputElement;
}

/** 速度スライダーの表示（ラベル・aria・塗り）をまとめて更新する */
function renderSpeedSlider(slider: HTMLInputElement, displayId: string): void {
  const value = parseFloat(slider.value);
  document.getElementById(displayId)!.textContent = `${value.toFixed(1)}x`;
  slider.setAttribute('aria-valuetext', `${value.toFixed(1)}倍速`);
  setRangeFill(slider);
}

/** 現在の UI の値を background と storage に反映する */
export function sendRandomSpeedConfig(): void {
  const enabled = (document.getElementById('randomSpeedEnabled') as HTMLInputElement).checked;
  const randomSpeedConfig = {
    enabled,
    minSpeed: parseFloat(minSlider().value),
    maxSpeed: parseFloat(maxSlider().value),
  };
  chrome.runtime.sendMessage({ action: 'updateRandomSpeedConfig', randomSpeedConfig });
}

/**
 * 下限・上限が交差しないよう、動かした側に合わせてもう一方を押し出す。
 * 交差したまま保存すると抽選範囲が反転してしまうため UI 側で防ぐ。
 */
function enforceRange(moved: 'min' | 'max'): void {
  const min = minSlider();
  const max = maxSlider();
  if (parseFloat(min.value) <= parseFloat(max.value)) return;

  if (moved === 'min') {
    max.value = min.value;
    renderSpeedSlider(max, 'current-random-speed-max');
  } else {
    min.value = max.value;
    renderSpeedSlider(min, 'current-random-speed-min');
  }
}

export function initRandomSpeedConfig(): void {
  document.getElementById('randomSpeedEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('random-speed-options')!.style.display = target.checked
      ? 'block'
      : 'none';
    sendRandomSpeedConfig();
    // ON の間は基本設定の再生速度が使われないため、スライダーの活性状態を取り直す
    updateSpeedSliderState();
  });

  minSlider().addEventListener('input', () => {
    renderSpeedSlider(minSlider(), 'current-random-speed-min');
    enforceRange('min');
    sendRandomSpeedConfig();
  });

  maxSlider().addEventListener('input', () => {
    renderSpeedSlider(maxSlider(), 'current-random-speed-max');
    enforceRange('max');
    sendRandomSpeedConfig();
  });

  document.getElementById('reset-random-speed')!.addEventListener('click', () => {
    minSlider().value = String(DEFAULT_RANDOM_SPEED_MIN);
    renderSpeedSlider(minSlider(), 'current-random-speed-min');
    maxSlider().value = String(DEFAULT_RANDOM_SPEED_MAX);
    renderSpeedSlider(maxSlider(), 'current-random-speed-max');
    sendRandomSpeedConfig();
  });

  // 基本設定の注記からおもしろ設定へ誘導する
  document.getElementById('openFunSettingsFromSpeed')?.addEventListener('click', () => {
    revealSection('fun-settings');
  });
}
