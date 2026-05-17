import '../styles/styles.scss';
import { initDataManagement } from '../popup/data-management';

chrome.storage.sync.get(['darkMode'], (data) => {
  const isDark =
    data.darkMode !== undefined
      ? data.darkMode
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (isDark) {
    document.body.classList.add('dark-mode');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initDataManagement();
});
