import { setRangeFill } from './slider-utils';
import type { ParallelSpeakersConfig } from '@/types/state';

function sendParallelPlaybackConfig(): void {
  const alwaysEnabled = (document.getElementById('parallelAlwaysEnabled') as HTMLInputElement).checked;
  const autoEnabled = (document.getElementById('parallelAutoEnabled') as HTMLInputElement).checked;
  const autoTriggerThreshold = parseInt(
    (document.getElementById('parallelAutoTriggerThreshold') as HTMLInputElement).value, 10
  );
  const parallelPlaybackConfig = {
    alwaysEnabled,
    autoEnabled,
    autoTriggerThreshold,
  };
  chrome.runtime.sendMessage({ action: 'updateParallelPlaybackConfig', parallelPlaybackConfig });
}

// --- 専用ページ ---

function openSpeakerConfigPage(): void {
  chrome.tabs.create({ url: chrome.runtime.getURL('speaker-config/speaker-config.html') });
}

/** 話者数の要約テキストを更新（持ち回り制・並列再生の両セクション） */
export function updateSpeakerCountSummary(): void {
  chrome.storage.sync.get(['parallelSpeakersConfig'], (data) => {
    const psc = data.parallelSpeakersConfig || { roundRobinSpeakerCount: 3 };
    const count = psc.roundRobinSpeakerCount || 3;

    const roundRobinSummary = document.getElementById('round-robin-speaker-summary');
    if (roundRobinSummary) {
      roundRobinSummary.textContent = `${count}話者`;
    }

    const parallelSummary = document.getElementById('parallel-speaker-count-summary');
    if (parallelSummary) {
      parallelSummary.textContent = `同時再生数: ${count}`;
    }
  });
}

// --- 持ち回り制 enabled トグル ---

/** storage の parallelSpeakersConfig.enabled を更新する（count/speakerIds は保持） */
function sendParallelSpeakersEnabled(enabled: boolean): void {
  chrome.storage.sync.get(['parallelSpeakersConfig'], (data) => {
    const psc: ParallelSpeakersConfig = data.parallelSpeakersConfig || {
      enabled: false,
      speakerIds: [],
      roundRobinSpeakerCount: 3,
    };
    psc.enabled = enabled;
    chrome.runtime.sendMessage({
      action: 'updateParallelSpeakersConfig',
      parallelSpeakersConfig: psc,
    });
  });
}

/**
 * 持ち回り制話者トグルの有効/無効を更新する。
 * 条件: engine=voicevox or local-voicevox のみ
 */
export function updateParallelSpeakersToggleState(): void {
  const toggle = document.getElementById('parallelSpeakersEnabled') as HTMLInputElement;
  const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;

  const isVoicevoxEngine = engine === 'voicevox' || engine === 'local-voicevox';
  toggle.disabled = !isVoicevoxEngine;

  // エンジン非対応で無効化された場合、トグルをOFFにして詳細を隠す
  if (!isVoicevoxEngine && toggle.checked) {
    toggle.checked = false;
    toggle.setAttribute('aria-checked', 'false');
    document.getElementById('parallel-speakers-options')!.style.display = 'none';
    sendParallelSpeakersEnabled(false);
  }
}

export function initParallelPlaybackConfig(): void {
  // 並列再生トグル
  document.getElementById('parallelAlwaysEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('parallel-always-options')!.style.display = target.checked ? 'block' : 'none';
    // 親トグルOFF時、自動発動の詳細も非表示にする
    if (!target.checked) {
      document.getElementById('parallel-auto-options')!.style.display = 'none';
    }
    // NOTE: 並列再生ON時の持ち回り制 auto-ON を廃止 (#133)
    // 同時再生数は専用ページから設定可能なため不要
    sendParallelPlaybackConfig();
  });

  // 自動発動トグル
  document.getElementById('parallelAutoEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('parallel-auto-options')!.style.display = target.checked ? 'block' : 'none';
    sendParallelPlaybackConfig();
  });

  // 自動発動: 発動しきい値スライダー
  document.getElementById('parallelAutoTriggerThreshold')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-parallel-auto-threshold')!.textContent = `${val}件`;
    target.setAttribute('aria-valuetext', `${val}件`);
    setRangeFill(target);
    sendParallelPlaybackConfig();
  });

  // 自動発動: リセットボタン
  document.getElementById('reset-parallel-auto')!.addEventListener('click', () => {
    const thresholdSlider = document.getElementById('parallelAutoTriggerThreshold') as HTMLInputElement;
    thresholdSlider.value = '10';
    document.getElementById('current-parallel-auto-threshold')!.textContent = '10件';
    thresholdSlider.setAttribute('aria-valuetext', '10件');
    setRangeFill(thresholdSlider);
    sendParallelPlaybackConfig();
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
        // ランダム話者の設定リンクを非表示
        const configLink = document.getElementById('random-speaker-config-link');
        if (configLink) configLink.style.display = 'none';
        // backgroundにランダム話者OFFを通知
        const host = (document.getElementById('localVoicevoxHost') as HTMLInputElement).value.trim();
        chrome.runtime.sendMessage({ action: 'updateRandomSpeakerConfig', enabled: false, engine, host });
      }
    }

    sendParallelSpeakersEnabled(target.checked);
    if (target.checked) {
      updateSpeakerCountSummary();
    }
  });

  // 専用ページを開くボタン（持ち回り制セクション）
  document.getElementById('openSpeakerConfig')?.addEventListener('click', openSpeakerConfigPage);

  // 専用ページを開くボタン（並列再生セクション）
  document.getElementById('openSpeakerConfigFromParallel')?.addEventListener('click', openSpeakerConfigPage);
}
