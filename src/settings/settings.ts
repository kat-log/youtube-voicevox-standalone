import '../styles/styles.scss';
import { initDataManagement } from '../popup/data-management';
import { initVolumeGranularity, refreshVolumeGranularity } from './volume-granularity';

function applyDarkMode(): void {
  chrome.storage.sync.get(['darkMode'], (data) => {
    const isDark =
      data.darkMode !== undefined
        ? data.darkMode
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('dark-mode', isDark);
  });
}

applyDarkMode();

document.addEventListener('DOMContentLoaded', () => {
  // インポート／リセット後は、この設定ページに存在する UI だけを再描画する
  // （ポップアップ用の loadSettings() はここでは要素が無く TypeError になる）
  initDataManagement(() => {
    applyDarkMode();
    refreshVolumeGranularity();
  });
  initVolumeGranularity();
});
