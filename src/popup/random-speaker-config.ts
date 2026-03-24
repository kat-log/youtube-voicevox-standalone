import { updateParallelSpeakersToggleState } from './parallel-playback-config';

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

    // 排他制御: ランダム話者モードのON/OFFでマルチ話者トグルの有効/無効を更新
    updateParallelSpeakersToggleState();

    sendRandomSpeakerConfig();
  });
}
