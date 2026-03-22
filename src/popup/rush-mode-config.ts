import { setRangeFill } from './slider-utils';

function sendRushModeConfig(): void {
  const enabled = (document.getElementById('rushModeEnabled') as HTMLInputElement).checked;
  const activateThreshold = parseInt(
    (document.getElementById('rushActivateThreshold') as HTMLInputElement).value, 10
  );
  const returnThreshold = parseInt(
    (document.getElementById('rushReturnThreshold') as HTMLInputElement).value, 10
  );
  const rushSpeed = parseFloat(
    (document.getElementById('rushSpeed') as HTMLInputElement).value
  );
  const rushModeConfig = { enabled, activateThreshold, returnThreshold, rushSpeed };
  chrome.runtime.sendMessage({ action: 'updateRushModeConfig', rushModeConfig });
}

export function initRushModeConfig(): void {
  document.getElementById('rushModeEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('rush-mode-options')!.style.display = target.checked ? 'block' : 'none';
    sendRushModeConfig();
  });

  document.getElementById('rushActivateThreshold')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-rush-activate')!.textContent = `${val}件`;
    target.setAttribute('aria-valuetext', `${val}件`);
    setRangeFill(target);
    sendRushModeConfig();
  });

  document.getElementById('rushSpeed')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseFloat(target.value);
    document.getElementById('current-rush-speed')!.textContent = `${val.toFixed(1)}x`;
    target.setAttribute('aria-valuetext', `${val.toFixed(1)}倍速`);
    setRangeFill(target);
    sendRushModeConfig();
  });

  document.getElementById('rushReturnThreshold')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-rush-return')!.textContent = `${val}件`;
    target.setAttribute('aria-valuetext', `${val}件`);
    setRangeFill(target);
    sendRushModeConfig();
  });

  document.getElementById('reset-rush-mode')!.addEventListener('click', () => {
    const activateSlider = document.getElementById('rushActivateThreshold') as HTMLInputElement;
    activateSlider.value = '20';
    document.getElementById('current-rush-activate')!.textContent = '20件';
    activateSlider.setAttribute('aria-valuetext', '20件');
    setRangeFill(activateSlider);

    const rushSpeedSlider = document.getElementById('rushSpeed') as HTMLInputElement;
    rushSpeedSlider.value = '2.0';
    document.getElementById('current-rush-speed')!.textContent = '2.0x';
    rushSpeedSlider.setAttribute('aria-valuetext', '2.0倍速');
    setRangeFill(rushSpeedSlider);

    const returnSlider = document.getElementById('rushReturnThreshold') as HTMLInputElement;
    returnSlider.value = '0';
    document.getElementById('current-rush-return')!.textContent = '0件';
    returnSlider.setAttribute('aria-valuetext', '0件');
    setRangeFill(returnSlider);

    sendRushModeConfig();
  });
}
