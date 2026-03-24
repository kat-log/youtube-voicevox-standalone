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
    : 'randomSpeakerAllowedIds';
  const summary = document.getElementById('random-speaker-summary');
  if (!summary) return;

  chrome.storage.sync.get([storageKey], (data) => {
    const ids = data[storageKey] as string[] | undefined;
    if (ids) {
      summary.textContent = `${ids.length}話者を選択中`;
    } else {
      summary.textContent = '全話者から選択';
    }
  });
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

    // ランダムモード時は現在のエンジンに応じた話者選択ドロップダウンを無効化
    const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
    if (engine === 'local-voicevox') {
      (document.getElementById('localSpeaker') as HTMLSelectElement).disabled = target.checked;
    } else {
      (document.getElementById('speaker') as HTMLSelectElement).disabled = target.checked;
    }

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
        // backgroundに持ち回り制OFFを通知（speakerIdsは保持）
        const speakerIds: string[] = [];
        document.getElementById('parallel-speakers-list')!.querySelectorAll('select').forEach((select) => {
          speakerIds.push((select as HTMLSelectElement).value);
        });
        const roundRobinSpeakerCount = parseInt(
          (document.getElementById('roundRobinSpeakerCount') as HTMLInputElement).value, 10
        );
        chrome.runtime.sendMessage({
          action: 'updateParallelSpeakersConfig',
          parallelSpeakersConfig: { enabled: false, speakerIds, roundRobinSpeakerCount },
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
