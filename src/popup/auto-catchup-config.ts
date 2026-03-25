import { setRangeFill } from './slider-utils';

function sendAutoCatchUpConfig(): void {
  const enabled = (document.getElementById('autoCatchUpEnabled') as HTMLInputElement).checked;
  const threshold = parseInt(
    (document.getElementById('autoCatchUpThreshold') as HTMLInputElement).value, 10
  );
  const autoCatchUpConfig = { enabled, threshold };
  chrome.runtime.sendMessage({ action: 'updateAutoCatchUpConfig', autoCatchUpConfig });
}

export function initAutoCatchupConfig(): void {
  document.getElementById('autoCatchUpEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('auto-catchup-options')!.style.display = target.checked ? 'block' : 'none';
    sendAutoCatchUpConfig();
  });

  document.getElementById('autoCatchUpThreshold')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-catchup-threshold')!.textContent = `${val}件`;
    target.setAttribute('aria-valuetext', `${val}件`);
    setRangeFill(target);
    sendAutoCatchUpConfig();
  });

  document.getElementById('reset-auto-catchup')!.addEventListener('click', () => {
    const thresholdSlider = document.getElementById('autoCatchUpThreshold') as HTMLInputElement;
    thresholdSlider.value = '50';
    document.getElementById('current-catchup-threshold')!.textContent = '50件';
    thresholdSlider.setAttribute('aria-valuetext', '50件');
    setRangeFill(thresholdSlider);

    sendAutoCatchUpConfig();
  });
}
