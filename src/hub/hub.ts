import '../styles/styles.scss';

chrome.storage.sync.get(['darkMode'], (data) => {
  const isDark =
    data.darkMode !== undefined
      ? data.darkMode
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (isDark) {
    document.body.classList.add('dark-mode');
  }
});
