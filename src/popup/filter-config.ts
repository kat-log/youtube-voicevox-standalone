import { setRangeFill, updateDualRangeFill, formatMaxLength, sliderToMaxLength } from './slider-utils';

function sendFilterConfig(): void {
  const enabled = (document.getElementById('filterEnabled') as HTMLInputElement).checked;
  const minLength = parseInt(
    (document.getElementById('filterMinLength') as HTMLInputElement).value,
    10
  );
  const maxLength = sliderToMaxLength(
    parseInt((document.getElementById('filterMaxLength') as HTMLInputElement).value, 10)
  );
  const skipEmojiOnly = (document.getElementById('filterSkipEmojiOnly') as HTMLInputElement)
    .checked;
  const stripEmoji = (document.getElementById('filterStripEmoji') as HTMLInputElement).checked;
  const ngWordsRaw = (document.getElementById('filterNgWords') as HTMLInputElement).value;
  const ngWords = ngWordsRaw
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  const ngWordAction =
    (document.querySelector('input[name="ngWordAction"]:checked') as HTMLInputElement)?.value ===
    'remove'
      ? ('remove' as const)
      : ('skip' as const);

  const filterConfig = {
    enabled,
    minLength,
    maxLength,
    skipEmojiOnly,
    stripEmoji,
    ngWords,
    ngWordAction,
  };
  chrome.runtime.sendMessage({ action: 'updateFilterConfig', filterConfig });
}

export function initFilterConfig(): void {
  document.getElementById('filterEnabled')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    document.getElementById('filter-options')!.style.display = target.checked ? 'block' : 'none';
    sendFilterConfig();
  });

  document.getElementById('filterMinLength')!.addEventListener('input', (event) => {
    const minSlider = event.target as HTMLInputElement;
    const maxSlider = document.getElementById('filterMaxLength') as HTMLInputElement;
    let minVal = parseInt(minSlider.value, 10);
    const maxVal = parseInt(maxSlider.value, 10);

    if (minVal >= maxVal) {
      minVal = maxVal - 1;
      minSlider.value = String(minVal);
    }

    document.getElementById('current-min-length')!.textContent = String(minVal);
    document.getElementById('min-length-display')!.textContent = String(minVal);
    minSlider.setAttribute('aria-valuetext', `${minVal}文字`);
    updateDualRangeFill();

    const midpoint = (parseInt(minSlider.max, 10) + parseInt(minSlider.min, 10)) / 2;
    minSlider.style.zIndex = minVal > midpoint ? '4' : '2';

    sendFilterConfig();
  });

  document.getElementById('filterMaxLength')!.addEventListener('input', (event) => {
    const maxSlider = event.target as HTMLInputElement;
    const minSlider = document.getElementById('filterMinLength') as HTMLInputElement;
    let maxVal = parseInt(maxSlider.value, 10);
    const minVal = parseInt(minSlider.value, 10);

    if (maxVal <= minVal) {
      maxVal = minVal + 1;
      maxSlider.value = String(maxVal);
    }

    const displayText = formatMaxLength(maxVal);
    document.getElementById('current-max-length')!.textContent = displayText;
    document.getElementById('max-length-display')!.textContent = displayText;
    maxSlider.setAttribute('aria-valuetext', maxVal >= 100 ? '無制限' : `${maxVal}文字`);
    updateDualRangeFill();
    sendFilterConfig();
  });

  document.getElementById('filterSkipEmojiOnly')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    sendFilterConfig();
  });

  document.getElementById('filterStripEmoji')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    target.setAttribute('aria-checked', String(target.checked));
    sendFilterConfig();
  });

  let ngWordsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  document.getElementById('filterNgWords')!.addEventListener('input', () => {
    if (ngWordsDebounceTimer) clearTimeout(ngWordsDebounceTimer);
    ngWordsDebounceTimer = setTimeout(sendFilterConfig, 500);
    const hasWords = (document.getElementById('filterNgWords') as HTMLInputElement).value
      .split(',')
      .some((w) => w.trim().length > 0);
    document.getElementById('ngWordActionGroup')!.style.display = hasWords ? 'block' : 'none';
  });

  document.querySelectorAll('input[name="ngWordAction"]').forEach((radio) => {
    radio.addEventListener('change', sendFilterConfig);
  });
}
