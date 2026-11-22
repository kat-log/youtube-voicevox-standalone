import { RANDOM_SPEAKER_SENTINEL } from '@/types/state';
import { getSpeakerSelectId } from './speaker-storage';

function sendRandomSpeakerConfig(): void {
  const enabled = (document.getElementById('randomSpeakerEnabled') as HTMLInputElement).checked;
  const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
  const host = (document.getElementById('localVoicevoxHost') as HTMLInputElement).value.trim();
  chrome.runtime.sendMessage({ action: 'updateRandomSpeakerConfig', enabled, engine, host });
}

export function updateRandomSpeakerSummary(): void {
  const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
  const storageKey = engine === 'local-voicevox'
    ? 'randomSpeakerAllowedIdsLocal'
    : engine === 'browser'
    ? 'randomSpeakerAllowedIdsBrowser'
    : 'randomSpeakerAllowedIds';
  const summary = document.getElementById('random-speaker-summary');
  if (!summary) return;

  chrome.storage.sync.get([storageKey], (data) => {
    const ids = data[storageKey] as string[] | undefined;
    const unit = engine === 'browser' ? '音声' : '話者';
    if (ids) {
      summary.textContent = `${ids.length}${unit}を選択中`;
    } else {
      summary.textContent = `全${unit}から選択`;
    }
  });
}

const RANDOM_OPTION_VALUE = RANDOM_SPEAKER_SENTINEL;

/**
 * ドロップダウンから実際に使える話者IDを取り出す。
 * ランダムモード中はダミーoptionが選択されているため、実在する最初の話者IDを返す。
 * （実際のランダム選択は background 側で行われる）
 */
export function getSelectedRealSpeakerId(select: HTMLSelectElement | null): string {
  if (!select) return '';
  if (select.value !== RANDOM_OPTION_VALUE) return select.value;
  const real = Array.from(select.options).find(
    (opt) => opt.value && opt.value !== RANDOM_OPTION_VALUE
  );
  return real?.value ?? '';
}

/** ランダムモードON/OFFに応じて、話者ドロップダウンにダミーoptionを挿入/削除して表示を切り替える */
export function updateSpeakerDropdownForRandomMode(engine: string, randomEnabled: boolean): void {
  const selectId = getSpeakerSelectId(engine);
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!select) return;

  if (randomEnabled) {
    // OFF に戻したとき元の選択へ復帰できるよう、実在の選択値を覚えておく
    if (select.value && select.value !== RANDOM_OPTION_VALUE) {
      select.dataset.realValue = select.value;
    }
    if (!select.querySelector(`option[value="${RANDOM_OPTION_VALUE}"]`)) {
      const opt = document.createElement('option');
      opt.value = RANDOM_OPTION_VALUE;
      opt.textContent = 'ランダム話者モード中';
      select.insertBefore(opt, select.firstChild);
    }
    select.value = RANDOM_OPTION_VALUE;
    select.disabled = true;
  } else {
    const wasRandom = select.value === RANDOM_OPTION_VALUE;
    select.querySelector(`option[value="${RANDOM_OPTION_VALUE}"]`)?.remove();
    select.disabled = false;
    // ダミーoptionを消すと先頭の話者が選ばれてしまうため、ランダム前の選択に戻す
    const realValue = select.dataset.realValue;
    if (wasRandom && realValue && Array.from(select.options).some((o) => o.value === realValue)) {
      select.value = realValue;
    }
  }
}

/**
 * 話者ドロップダウンの選択肢を作り直した後に呼ぶ。
 * innerHTML の再構築でダミーoptionが消えるため、ランダムモード中ならダミー表示を付け直す。
 * （以前はランダム状態の復元が Web API 話者リストの取得完了時にしか行われず、
 *   取得順によってはローカル／ブラウザのドロップダウンが「無効なのに実在話者を表示」になっていた）
 */
export function reapplyRandomModeForEngine(engine: string): void {
  const currentEngine = (document.getElementById('ttsEngine') as HTMLSelectElement | null)?.value;
  const randomEnabled =
    (document.getElementById('randomSpeakerEnabled') as HTMLInputElement | null)?.checked ?? false;
  if (currentEngine === engine && randomEnabled) {
    updateSpeakerDropdownForRandomMode(engine, true);
  }
}

function updateConfigLinkVisibility(enabled: boolean): void {
  const linkSection = document.getElementById('random-speaker-config-link');
  if (linkSection) {
    linkSection.style.display = enabled ? 'block' : 'none';
  }
}

export function initRandomSpeakerConfig(): void {
  document.getElementById('randomSpeakerEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));

    // ランダムモード時は現在のエンジンに応じた話者選択ドロップダウンを無効化・ラベル表示
    const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
    updateSpeakerDropdownForRandomMode(engine, target.checked);

    // 話者選択リンクの表示切替
    updateConfigLinkVisibility(target.checked);
    if (target.checked) {
      updateRandomSpeakerSummary();
    }

    // 排他制御: ON時に持ち回り制話者を自動OFF
    if (target.checked) {
      const roundRobinToggle = document.getElementById('parallelSpeakersEnabled') as HTMLInputElement;
      if (roundRobinToggle.checked) {
        roundRobinToggle.checked = false;
        roundRobinToggle.setAttribute('aria-checked', 'false');
        document.getElementById('parallel-speakers-options')!.style.display = 'none';
        // backgroundに持ち回り制OFFを通知（storage の speakerIds/count は保持）
        chrome.storage.sync.get(['parallelSpeakersConfig'], (data) => {
          const psc = data.parallelSpeakersConfig || { enabled: false, speakerIds: [], roundRobinSpeakerCount: 3 };
          psc.enabled = false;
          chrome.runtime.sendMessage({
            action: 'updateParallelSpeakersConfig',
            parallelSpeakersConfig: psc,
          });
        });
      }
    }

    sendRandomSpeakerConfig();
  });

  // 話者選択ページを開くボタン
  document.getElementById('openSpeakerSelection')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('speaker-selection/speaker-selection.html') });
  });
}
