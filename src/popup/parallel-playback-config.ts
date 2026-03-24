import { RANDOM_SPEAKER_SENTINEL } from '@/types/state';
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

// --- 持ち回り制話者モード ---

// 話者リストのキャッシュ（settings-loader.ts から設定される）
let cachedSpeakerOptions: Array<{ value: string; label: string }> = [];
let cachedLocalSpeakerOptions: Array<{ value: string; label: string }> = [];

export function setSpeakerOptions(options: Array<{ value: string; label: string }>): void {
  cachedSpeakerOptions = options;
}

export function setLocalSpeakerOptions(options: Array<{ value: string; label: string }>): void {
  cachedLocalSpeakerOptions = options;
}

function getActiveSpeakerOptions(): Array<{ value: string; label: string }> {
  const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
  return engine === 'local-voicevox' ? cachedLocalSpeakerOptions : cachedSpeakerOptions;
}

function getRoundRobinSpeakerCount(): number {
  return parseInt(
    (document.getElementById('roundRobinSpeakerCount') as HTMLInputElement).value, 10
  );
}

function sendParallelSpeakersConfig(): void {
  const enabled = (document.getElementById('parallelSpeakersEnabled') as HTMLInputElement).checked;
  const roundRobinSpeakerCount = getRoundRobinSpeakerCount();
  const speakerIds: string[] = [];
  const container = document.getElementById('parallel-speakers-list')!;
  const selects = container.querySelectorAll('select');
  selects.forEach((select) => {
    speakerIds.push(select.value);
  });
  chrome.runtime.sendMessage({
    action: 'updateParallelSpeakersConfig',
    parallelSpeakersConfig: { enabled, speakerIds, roundRobinSpeakerCount },
  });
}

function getDropdownCount(): number {
  const alwaysEnabled = (document.getElementById('parallelAlwaysEnabled') as HTMLInputElement).checked;

  if (alwaysEnabled) {
    // 並列再生ON: 同時再生数スライダーの値でドロップダウン数を決定
    const alwaysMax = parseInt(
      (document.getElementById('parallelAlwaysMaxConcurrent') as HTMLInputElement).value, 10
    );
    const autoMax = parseInt(
      (document.getElementById('parallelAutoMaxConcurrent') as HTMLInputElement).value, 10
    );
    return Math.max(0, Math.max(alwaysMax, autoMax) - 1);
  } else {
    // 並列再生OFF: 持ち回り話者数スライダーの値でドロップダウン数を決定
    return Math.max(0, getRoundRobinSpeakerCount() - 1);
  }
}

export function updateParallelSpeakerDropdowns(savedIds?: string[]): void {
  const container = document.getElementById('parallel-speakers-list')!;
  const count = getDropdownCount();

  // 既存の選択値を保存
  const currentIds: string[] = [];
  container.querySelectorAll('select').forEach((select) => {
    currentIds.push(select.value);
  });

  // 復元用のID（savedIdsがあればそれを優先）
  const idsToRestore = savedIds || currentIds;

  container.innerHTML = '';

  for (let i = 0; i < count; i++) {
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '4px';

    const label = document.createElement('label');
    label.textContent = `話者${i + 2}:`;
    label.style.marginRight = '4px';

    const select = document.createElement('select');
    select.id = `parallelSpeaker${i}`;
    select.setAttribute('aria-label', `話者${i + 2}の選択`);

    for (const opt of getActiveSpeakerOptions()) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }

    // ランダムオプションを末尾に追加
    const randomOption = document.createElement('option');
    randomOption.value = RANDOM_SPEAKER_SENTINEL;
    randomOption.textContent = 'ランダム';
    select.appendChild(randomOption);

    // 保存値を復元
    if (idsToRestore[i]) {
      select.value = idsToRestore[i];
    }

    select.addEventListener('change', () => {
      sendParallelSpeakersConfig();
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    container.appendChild(wrapper);
  }
}

/**
 * 持ち回り制話者トグルの有効/無効を更新する。
 * 条件: engine=voicevox or local-voicevox のみ（排他はdisabledではなく自動OFFで処理）
 */
export function updateParallelSpeakersToggleState(): void {
  const toggle = document.getElementById('parallelSpeakersEnabled') as HTMLInputElement;
  const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;

  const isVoicevoxEngine = engine === 'voicevox' || engine === 'local-voicevox';
  toggle.disabled = !isVoicevoxEngine;

  // エンジン非対応で無効化された場合、トグルをOFFにして詳細を隠す（speakerIdsは保持）
  if (!isVoicevoxEngine && toggle.checked) {
    toggle.checked = false;
    toggle.setAttribute('aria-checked', 'false');
    document.getElementById('parallel-speakers-options')!.style.display = 'none';
    const speakerIds: string[] = [];
    document.getElementById('parallel-speakers-list')!.querySelectorAll('select').forEach((select) => {
      speakerIds.push((select as HTMLSelectElement).value);
    });
    const roundRobinSpeakerCount = getRoundRobinSpeakerCount();
    chrome.runtime.sendMessage({
      action: 'updateParallelSpeakersConfig',
      parallelSpeakersConfig: { enabled: false, speakerIds, roundRobinSpeakerCount },
    });
  }

  updateRoundRobinSliderVisibility();
}

/**
 * 話者数スライダーの表示/非表示を切り替える。
 * 並列再生ON時は非表示（同時再生数スライダーがドロップダウン数を制御するため）。
 */
export function updateRoundRobinSliderVisibility(): void {
  const alwaysEnabled = (document.getElementById('parallelAlwaysEnabled') as HTMLInputElement).checked;
  const isParallelOn = alwaysEnabled;

  const sliderSection = document.getElementById('round-robin-speaker-count-section');
  if (sliderSection) {
    sliderSection.style.display = isParallelOn ? 'none' : 'block';
  }
}

export function initParallelPlaybackConfig(): void {
  // 並列再生トグル
  document.getElementById('parallelAlwaysEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('parallel-always-options')!.style.display = target.checked ? 'block' : 'none';
    // 親トグルOFF時、自動並列再生の詳細も非表示にする
    if (!target.checked) {
      document.getElementById('parallel-auto-options')!.style.display = 'none';
    }
    sendParallelPlaybackConfig();
    updateRoundRobinSliderVisibility();
    updateParallelSpeakerDropdowns();
  });

  // 並列再生: 同時再生数スライダー
  document.getElementById('parallelAlwaysMaxConcurrent')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-parallel-always-max')!.textContent = String(val);
    target.setAttribute('aria-valuetext', String(val));
    setRangeFill(target);
    sendParallelPlaybackConfig();
    updateParallelSpeakerDropdowns();
  });

  // 並列再生: リセットボタン
  document.getElementById('reset-parallel-always')!.addEventListener('click', () => {
    const slider = document.getElementById('parallelAlwaysMaxConcurrent') as HTMLInputElement;
    slider.value = '3';
    document.getElementById('current-parallel-always-max')!.textContent = '3';
    slider.setAttribute('aria-valuetext', '3');
    setRangeFill(slider);
    sendParallelPlaybackConfig();
    updateParallelSpeakerDropdowns();
  });

  // 自動並列再生トグル
  document.getElementById('parallelAutoEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('parallel-auto-options')!.style.display = target.checked ? 'block' : 'none';
    sendParallelPlaybackConfig();
    updateRoundRobinSliderVisibility();
    updateParallelSpeakerDropdowns();
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
    updateParallelSpeakerDropdowns();
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
    updateParallelSpeakerDropdowns();
  });

  // 持ち回り制話者モードトグル
  document.getElementById('parallelSpeakersEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('parallel-speakers-options')!.style.display = target.checked ? 'block' : 'none';

    // 排他制御: ON時にランダム話者を自動OFF
    if (target.checked) {
      const randomToggle = document.getElementById('randomSpeakerEnabled') as HTMLInputElement;
      if (randomToggle.checked) {
        randomToggle.checked = false;
        randomToggle.setAttribute('aria-checked', 'false');
        // メインの話者ドロップダウンを再有効化
        const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
        if (engine === 'local-voicevox') {
          (document.getElementById('localSpeaker') as HTMLSelectElement).disabled = false;
        } else {
          (document.getElementById('speaker') as HTMLSelectElement).disabled = false;
        }
        // backgroundにランダム話者OFFを通知
        const host = (document.getElementById('localVoicevoxHost') as HTMLInputElement).value.trim();
        chrome.runtime.sendMessage({ action: 'updateRandomSpeakerConfig', enabled: false, engine, host });
      }
      updateParallelSpeakerDropdowns();
    }

    updateRoundRobinSliderVisibility();
    sendParallelSpeakersConfig();
  });

  // 持ち回り話者数スライダー
  document.getElementById('roundRobinSpeakerCount')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-round-robin-count')!.textContent = String(val);
    target.setAttribute('aria-valuetext', String(val));
    setRangeFill(target);
    updateParallelSpeakerDropdowns();
    sendParallelSpeakersConfig();
  });
}
