function sendRandomSpeakerConfig(): void {
  const enabled = (document.getElementById('randomSpeakerEnabled') as HTMLInputElement).checked;
  const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
  const host = (document.getElementById('localVoicevoxHost') as HTMLInputElement).value.trim();
  chrome.runtime.sendMessage({ action: 'updateRandomSpeakerConfig', enabled, engine, host });
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
}
