/** レンジスライダーの塗りをCSS変数で更新 */
export function setRangeFill(el: HTMLInputElement): void {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

/** デュアルレンジスライダーの中間塗りを更新 */
export function updateDualRangeFill(): void {
  const minSlider = document.getElementById('filterMinLength') as HTMLInputElement;
  const maxSlider = document.getElementById('filterMaxLength') as HTMLInputElement;
  const fill = document.getElementById('dualRangeFill');
  if (!minSlider || !maxSlider || !fill) return;

  const sliderMin = parseFloat(minSlider.min);
  const sliderMax = parseFloat(minSlider.max);
  const range = sliderMax - sliderMin;

  const minVal = parseFloat(minSlider.value);
  const maxVal = parseFloat(maxSlider.value);

  const leftPct = ((minVal - sliderMin) / range) * 100;
  const rightPct = ((maxVal - sliderMin) / range) * 100;

  fill.style.left = `${leftPct}%`;
  fill.style.width = `${rightPct - leftPct}%`;
}

/** 最大文字数の表示テキスト（100 = 無制限） */
export function formatMaxLength(sliderValue: number): string {
  return sliderValue >= 100 ? '無制限' : String(sliderValue);
}

/** maxLength slider値を FilterConfig の maxLength値に変換（100 → 0 = 無制限） */
export function sliderToMaxLength(sliderValue: number): number {
  return sliderValue >= 100 ? 0 : sliderValue;
}

/** FilterConfig の maxLength値を slider値に変換（0 → 100 = 無制限） */
export function maxLengthToSlider(configValue: number): number {
  return configValue === 0 ? 100 : configValue;
}
