let currentStatus: string = 'idle';

export function getCurrentStatus(): string {
  return currentStatus;
}

// OSに応じてショートカットキーのツールチップを更新する関数
export function updateShortcutTooltips(): void {
  let os = 'unknown';
  const userAgent = navigator.userAgent;

  if (userAgent.indexOf('Win') !== -1) os = 'Windows';
  else if (userAgent.indexOf('Mac') !== -1) os = 'Mac';
  else if (userAgent.indexOf('Linux') !== -1) os = 'Linux';
  else if (userAgent.indexOf('CrOS') !== -1) os = 'ChromeOS';

  let startShortcut = 'Alt+Shift+S';
  let stopShortcut = 'Alt+Shift+Q';

  if (os === 'Mac') {
    startShortcut = '⌥⇧S';
    stopShortcut = '⌥⇧Q';
  }

  document.getElementById('play-tooltip')!.textContent = `ショートカット: ${startShortcut}`;
  document.getElementById('stop-tooltip')!.textContent = `ショートカット: ${stopShortcut}`;
}

// ステータスバーとボタンのUIを更新する関数
export function updateStatusUI(status: string, message: string, count: number, queueLength = 0, isRushActive = false): void {
  currentStatus = status;
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const countEl = document.getElementById('status-count');
  const queueEl = document.getElementById('queue-info');
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const stopBtn = document.getElementById('stop') as HTMLButtonElement;

  if (!dot || !text || !countEl || !queueEl) return;

  dot.className = 'status-dot ' + status;
  switch (status) {
    case 'idle':
      text.textContent = '停止中';
      countEl.textContent = '';
      queueEl.textContent = '';
      break;
    case 'connecting':
      text.textContent = '接続中...';
      countEl.textContent = '';
      queueEl.textContent = '';
      break;
    case 'fetching':
      text.textContent = 'コメント取得中...';
      countEl.textContent = '';
      queueEl.textContent = '';
      break;
    case 'generating':
      text.textContent = '音声生成中...';
      countEl.textContent = count > 0 ? `（${count}件読上済）` : '';
      queueEl.textContent = queueLength > 0 ? `待機: ${queueLength}件` : '';
      break;
    case 'listening':
      text.textContent = '再生中';
      countEl.textContent = count > 0 ? `（${count}件読上済）` : '';
      queueEl.textContent = queueLength > 0 ? `待機: ${queueLength}件` : '';
      break;
    case 'rate-limited':
      text.textContent = 'レート制限待機中...';
      countEl.textContent = count > 0 ? `（${count}件読上済）` : '';
      queueEl.textContent = queueLength > 0 ? `待機: ${queueLength}件` : '';
      break;
    case 'waiting':
      text.textContent = 'コメント待ち';
      countEl.textContent = count > 0 ? `（${count}件読上済）` : '';
      queueEl.textContent = '';
      break;
    case 'error':
      text.textContent = 'エラー: ' + (message || '不明');
      countEl.textContent = '';
      queueEl.textContent = '';
      break;
  }

  // ステータスに応じたボタンの活性/非活性制御
  if (status === 'idle' || status === 'error') {
    stopBtn.disabled = true;
    validateInputs(); // APIキー入力があればplayBtnを有効化
  } else {
    // 実行中（connecting, fetching, generating, listening）
    playBtn.disabled = true;
    stopBtn.disabled = false;
  }

  // ラッシュモードインジケーター
  const rushIndicator = document.getElementById('rush-indicator');
  if (rushIndicator) {
    rushIndicator.style.display = isRushActive ? 'inline' : 'none';
  }
}

// 入力バリデーション
export function validateInputs(): void {
  const apiKeyInput = document.getElementById('apiKeyYoutube') as HTMLInputElement;
  const apiKey = apiKeyInput.value.trim();
  const chatModeSelect = document.getElementById('chatMode') as HTMLSelectElement | null;
  const chatMode = chatModeSelect?.value ?? 'dom';
  const requiresApiKey = chatMode === 'official';
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const playTooltip = document.getElementById('play-tooltip') as HTMLElement;
  const banner = document.getElementById('api-key-banner');

  if (requiresApiKey && !apiKey) {
    playBtn.disabled = true;
    playTooltip.textContent = 'YouTube APIキーを設定してください';
    playTooltip.style.color = '#ef4444'; // Error color
    if (banner) banner.style.display = 'flex';
    apiKeyInput.classList.add('input-required-empty');
  } else {
    if (banner) banner.style.display = 'none';
    apiKeyInput.classList.remove('input-required-empty');
    if (currentStatus === 'idle' || currentStatus === 'error') {
      playBtn.disabled = false;
      updateShortcutTooltips(); // 基本のショートカットテキストに戻す
      playTooltip.style.color = '';
    }
  }

  // YouTubeクォータリンクの表示/非表示
  const youtubeQuotaLink = document.getElementById('youtube-quota-link');
  if (youtubeQuotaLink) {
    youtubeQuotaLink.style.display = (requiresApiKey && apiKey) ? 'block' : 'none';
  }
}
