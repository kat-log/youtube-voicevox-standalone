function sendRandomSpeakerConfig(): void {
  const enabled = (document.getElementById('randomSpeakerEnabled') as HTMLInputElement).checked;
  chrome.runtime.sendMessage({ action: 'updateRandomSpeakerConfig', enabled });
}

export function initRandomSpeakerConfig(): void {
  document.getElementById('randomSpeakerEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));

    // ランダムモード時は話者選択ドロップダウンを無効化
    (document.getElementById('speaker') as HTMLSelectElement).disabled = target.checked;

    sendRandomSpeakerConfig();
  });
}
