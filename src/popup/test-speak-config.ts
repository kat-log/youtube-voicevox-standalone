export function initTestSpeakConfig(): void {
  const btn = document.getElementById('testSpeakBtn') as HTMLButtonElement;
  const input = document.getElementById('testSpeakText') as HTMLInputElement;
  const statusEl = document.getElementById('testSpeakStatus')!;

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
    (request: { action: string; status?: string; message?: string }) => {
      if (request.action !== 'testSpeakResult') return;

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
