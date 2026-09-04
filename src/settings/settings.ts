import '../styles/styles.scss';
import { initDataManagement } from './data-management';
import { initVolumeGranularity, refreshVolumeGranularity } from './volume-granularity';

chrome.storage.sync.get(['darkMode'], (data) => {
  const isDark =
    data.darkMode !== undefined
      ? data.darkMode
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (isDark) {
    document.body.classList.add('dark-mode');
  }
});

/** 設定のインポート／リセット後に、このページ自身の表示を storage の値へ揃える */
function refreshSettingsPage(): void {
  refreshVolumeGranularity();
  chrome.storage.sync.get(['darkMode'], (data) => {
    const isDark =
      data.darkMode !== undefined
        ? data.darkMode
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('dark-mode', isDark);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initDataManagement(refreshSettingsPage);
  initVolumeGranularity();
});
