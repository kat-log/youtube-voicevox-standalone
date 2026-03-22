import { setRangeFill } from './slider-utils';

function sendParallelPlaybackConfig(): void {
  const alwaysEnabled = (document.getElementById('parallelAlwaysEnabled') as HTMLInputElement).checked;
  const alwaysMaxConcurrent = parseInt(
    (document.getElementById('parallelAlwaysMaxConcurrent') as HTMLInputElement).value, 10
  );
  const autoEnabled = (document.getElementById('parallelAutoEnabled') as HTMLInputElement).checked;
  const autoTriggerThreshold = parseInt(
    (document.getElementById('parallelAutoTriggerThreshold') as HTMLInputElement).value, 10
  );
  const autoMaxConcurrent = parseInt(
    (document.getElementById('parallelAutoMaxConcurrent') as HTMLInputElement).value, 10
  );
  const parallelPlaybackConfig = {
    alwaysEnabled,
    alwaysMaxConcurrent,
    autoEnabled,
    autoTriggerThreshold,
    autoMaxConcurrent,
  };
  chrome.runtime.sendMessage({ action: 'updateParallelPlaybackConfig', parallelPlaybackConfig });
}

export function initParallelPlaybackConfig(): void {
  // 常時並列再生トグル
  document.getElementById('parallelAlwaysEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('parallel-always-options')!.style.display = target.checked ? 'block' : 'none';
    sendParallelPlaybackConfig();
  });

  // 常時並列再生: 同時再生数スライダー
  document.getElementById('parallelAlwaysMaxConcurrent')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-parallel-always-max')!.textContent = String(val);
    target.setAttribute('aria-valuetext', String(val));
    setRangeFill(target);
    sendParallelPlaybackConfig();
  });

  // 常時並列再生: リセットボタン
  document.getElementById('reset-parallel-always')!.addEventListener('click', () => {
    const slider = document.getElementById('parallelAlwaysMaxConcurrent') as HTMLInputElement;
    slider.value = '3';
    document.getElementById('current-parallel-always-max')!.textContent = '3';
    slider.setAttribute('aria-valuetext', '3');
    setRangeFill(slider);
    sendParallelPlaybackConfig();
  });

  // 自動並列再生トグル
  document.getElementById('parallelAutoEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('parallel-auto-options')!.style.display = target.checked ? 'block' : 'none';
    sendParallelPlaybackConfig();
  });

  // 自動並列再生: 発動しきい値スライダー
  document.getElementById('parallelAutoTriggerThreshold')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-parallel-auto-threshold')!.textContent = `${val}件`;
    target.setAttribute('aria-valuetext', `${val}件`);
    setRangeFill(target);
    sendParallelPlaybackConfig();
  });

  // 自動並列再生: 同時再生数スライダー
  document.getElementById('parallelAutoMaxConcurrent')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-parallel-auto-max')!.textContent = String(val);
    target.setAttribute('aria-valuetext', String(val));
    setRangeFill(target);
    sendParallelPlaybackConfig();
  });

  // 自動並列再生: リセットボタン
  document.getElementById('reset-parallel-auto')!.addEventListener('click', () => {
    const thresholdSlider = document.getElementById('parallelAutoTriggerThreshold') as HTMLInputElement;
    thresholdSlider.value = '10';
    document.getElementById('current-parallel-auto-threshold')!.textContent = '10件';
    thresholdSlider.setAttribute('aria-valuetext', '10件');
    setRangeFill(thresholdSlider);

    const maxSlider = document.getElementById('parallelAutoMaxConcurrent') as HTMLInputElement;
    maxSlider.value = '3';
    document.getElementById('current-parallel-auto-max')!.textContent = '3';
    maxSlider.setAttribute('aria-valuetext', '3');
    setRangeFill(maxSlider);

    sendParallelPlaybackConfig();
  });
}
