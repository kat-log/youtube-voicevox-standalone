export function initTestSpeakConfig(): void {
  const toggle = document.getElementById('testSpeakEnabled') as HTMLInputElement;
  const options = document.getElementById('test-speak-options')!;
  const btn = document.getElementById('testSpeakBtn') as HTMLButtonElement;
  const input = document.getElementById('testSpeakText') as HTMLInputElement;
  const statusEl = document.getElementById('testSpeakStatus')!;

  // トグル表示/非表示
  toggle.addEventListener('change', () => {
    toggle.setAttribute('aria-checked', String(toggle.checked));
    options.style.display = toggle.checked ? 'block' : 'none';
  });

  // 全話者でプレビューページを開く
  document.getElementById('openTestSpeakPage')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('test-speak/test-speak.html') });
  });

  // テスト再生ボタン
  btn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) {
      statusEl.textContent = 'テキストを入力してください';
      statusEl.style.color = 'var(--error-color)';
      return;
    }

    btn.disabled = true;
    statusEl.textContent = '生成中...';
    statusEl.style.color = 'var(--text-secondary)';

    chrome.runtime.sendMessage(
      { action: 'testSpeak', text },
      (response: { status: string; message?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          btn.disabled = false;
          statusEl.textContent = chrome.runtime.lastError.message || 'エラー';
          statusEl.style.color = 'var(--error-color)';
          return;
        }
        if (response && response.status === 'error') {
          btn.disabled = false;
          statusEl.textContent = response.message || 'エラー';
          statusEl.style.color = 'var(--error-color)';
        }
        // success の場合は testSpeakResult メッセージで状態更新
      },
    );
  });

  // background からのテスト再生進捗を受信
  chrome.runtime.onMessage.addListener(
    (request: { action: string; status?: string; message?: string; speakerId?: string }) => {
      if (request.action !== 'testSpeakResult') return;
      // speakerId がある場合は専用ページ向けなので無視
      if (request.speakerId !== undefined) return;

      switch (request.status) {
        case 'generating':
          statusEl.textContent = '生成中...';
          statusEl.style.color = 'var(--text-secondary)';
          btn.disabled = true;
          break;
        case 'playing':
          statusEl.textContent = '再生中...';
          statusEl.style.color = 'var(--accent-color)';
          break;
        case 'done':
          statusEl.textContent = '';
          btn.disabled = false;
          break;
        case 'error':
          statusEl.textContent = request.message || 'エラー';
          statusEl.style.color = 'var(--error-color)';
          btn.disabled = false;
          break;
      }
    },
  );
}
