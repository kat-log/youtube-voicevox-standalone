export function initDarkMode(): void {
  document.getElementById('darkMode')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    const isDark = target.checked;
    if (isDark) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    target.setAttribute('aria-checked', String(isDark));
    chrome.storage.sync.set({ darkMode: isDark });
  });
}
