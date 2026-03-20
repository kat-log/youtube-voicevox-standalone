import '../styles/styles.scss';

let speed = 1.0;
let volume = 1.0;

/** レンジスライダーの塗りをCSS変数で更新 */
function setRangeFill(el: HTMLInputElement): void {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

/** デュアルレンジスライダーの中間塗りを更新 */
function updateDualRangeFill(): void {
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
function formatMaxLength(sliderValue: number): string {
  return sliderValue >= 100 ? '無制限' : String(sliderValue);
}

/** maxLength slider値を FilterConfig の maxLength値に変換（100 → 0 = 無制限） */
function sliderToMaxLength(sliderValue: number): number {
  return sliderValue >= 100 ? 0 : sliderValue;
}

/** FilterConfig の maxLength値を slider値に変換（0 → 100 = 無制限） */
function maxLengthToSlider(configValue: number): number {
  return configValue === 0 ? 100 : configValue;
}

window.onload = function () {
  chrome.storage.sync.get(
    [
      'apiKeyVOICEVOX',
      'apiKeyYoutube',
      'speed',
      'volume',
      'latestOnlyMode',
      'speakerId',
      'darkMode',
      'filterConfig',
      'ttsEngine',
      'browserVoice',
    ],
    function (data) {
      (document.getElementById('apiKeyVOICEVOX') as HTMLInputElement).value =
        data.apiKeyVOICEVOX || '';
      (document.getElementById('apiKeyYoutube') as HTMLInputElement).value =
        data.apiKeyYoutube || '';
      speed = data.speed || 1.0;
      const speedSlider = document.getElementById('speed') as HTMLInputElement;
      speedSlider.value = String(speed);
      document.getElementById('current-speed')!.textContent = `${speed.toFixed(1)}x`;
      speedSlider.setAttribute('aria-valuetext', `${speed.toFixed(1)}倍速`);
      setRangeFill(speedSlider);

      volume = data.volume || 1.0;
      const volumeSlider = document.getElementById('volume') as HTMLInputElement;
      volumeSlider.value = String(volume);
      document.getElementById('current-volume')!.textContent = `${volume}`;
      setRangeFill(volumeSlider);
      const volumePct = Math.round(volume * 100);
      document.getElementById('volume')!.setAttribute('aria-valuetext', `音量${volumePct}%`);

      const latestOnlyMode = data.latestOnlyMode || false;
      (document.getElementById('latestOnlyMode') as HTMLInputElement).checked = latestOnlyMode;
      document
        .getElementById('latestOnlyMode')!
        .setAttribute('aria-checked', String(latestOnlyMode));

      // ダークモード設定を復元（未設定時はシステム設定に従う）
      const darkModeCheckbox = document.getElementById('darkMode') as HTMLInputElement;
      let isDark: boolean;
      if (data.darkMode !== undefined) {
        isDark = data.darkMode;
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      if (isDark) {
        document.body.classList.add('dark-mode');
        darkModeCheckbox.checked = true;
        darkModeCheckbox.setAttribute('aria-checked', 'true');
      }

      // フィルタ設定を復元
      const fc = data.filterConfig || {
        enabled: false,
        minLength: 1,
        maxLength: 0,
        skipEmojiOnly: false,
        ngWords: [],
      };
      (document.getElementById('filterEnabled') as HTMLInputElement).checked = fc.enabled;
      document.getElementById('filterEnabled')!.setAttribute('aria-checked', String(fc.enabled));
      document.getElementById('filter-options')!.style.display = fc.enabled ? 'block' : 'none';
      const filterMinLengthSlider = document.getElementById('filterMinLength') as HTMLInputElement;
      filterMinLengthSlider.value = String(fc.minLength);
      document.getElementById('current-min-length')!.textContent = String(fc.minLength);
      document.getElementById('min-length-display')!.textContent = String(fc.minLength);
      const maxSliderVal = maxLengthToSlider(fc.maxLength || 0);
      const filterMaxLengthSlider = document.getElementById('filterMaxLength') as HTMLInputElement;
      filterMaxLengthSlider.value = String(maxSliderVal);
      const maxDisplay = formatMaxLength(maxSliderVal);
      document.getElementById('current-max-length')!.textContent = maxDisplay;
      document.getElementById('max-length-display')!.textContent = maxDisplay;
      updateDualRangeFill();
      (document.getElementById('filterSkipEmojiOnly') as HTMLInputElement).checked =
        fc.skipEmojiOnly;
      document
        .getElementById('filterSkipEmojiOnly')!
        .setAttribute('aria-checked', String(fc.skipEmojiOnly));
      (document.getElementById('filterStripEmoji') as HTMLInputElement).checked =
        fc.stripEmoji || false;
      document
        .getElementById('filterStripEmoji')!
        .setAttribute('aria-checked', String(fc.stripEmoji || false));
      (document.getElementById('filterNgWords') as HTMLInputElement).value = (
        fc.ngWords || []
      ).join(', ');
      const ngWordAction = fc.ngWordAction || 'remove';
      const ngWordActionRadio = document.querySelector(
        `input[name="ngWordAction"][value="${ngWordAction}"]`
      ) as HTMLInputElement | null;
      if (ngWordActionRadio) ngWordActionRadio.checked = true;
      const hasNgWords = (fc.ngWords || []).length > 0;
      document.getElementById('ngWordActionGroup')!.style.display = hasNgWords ? 'block' : 'none';

      // TTSエンジン設定を復元
      const engine = data.ttsEngine || 'voicevox';
      (document.getElementById('ttsEngine') as HTMLSelectElement).value = engine;
      toggleEngineUI(engine);

      // ブラウザ音声リストを取得
      populateBrowserVoices(data.browserVoice);

      // 話者一覧を取得して選択メニューを作成
      fetch('https://static.tts.quest/voicevox_speakers.json')
        .then((response) => response.json())
        .then((speakers: (string | null)[]) => {
          const select = document.getElementById('speaker') as HTMLSelectElement;
          speakers.forEach((speaker, index) => {
            if (speaker) {
              const option = document.createElement('option');
              option.value = String(index);
              option.textContent = speaker;
              select.appendChild(option);
            }
          });
          // 保存された話者IDを選択
          select.value = data.speakerId || '1';
        });

      // OSに応じてツールチップのテキストを更新
      updateShortcutTooltips();

      // 現在のステータスを取得
      chrome.runtime.sendMessage(
        { action: 'getStatus' },
        function (response: { status?: string; commentCount?: number; queueLength?: number }) {
          if (chrome.runtime.lastError) return;
          if (response) {
            updateStatusUI(
              response.status || 'idle',
              '',
              response.commentCount || 0,
              response.queueLength || 0
            );
          }
        }
      );

      // 初期バリデーション
      validateInputs();
    }
  );

  // session storage から保存済みログを復元
  chrome.storage.session.get({ debugLogs: [] }, (data) => {
    const debugElement = document.getElementById('debug');
    if (debugElement && data.debugLogs.length > 0) {
      debugElement.textContent = data.debugLogs.join('\n') + '\n';
      const accordionContent = debugElement.closest('.accordion-content') as HTMLElement | null;
      if (accordionContent) {
        accordionContent.scrollTop = accordionContent.scrollHeight;
      }
    }
  });
};

// OSに応じてショートカットキーのツールチップを更新する関数
function updateShortcutTooltips(): void {
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

document.getElementById('play')!.addEventListener('click', (event) => {
  const playBtn = event.target as HTMLButtonElement;
  // 連打防止のため即座に無効化
  playBtn.disabled = true;

  const apiKeyVOICEVOX = (document.getElementById('apiKeyVOICEVOX') as HTMLInputElement).value;
  const apiKeyYoutube = (document.getElementById('apiKeyYoutube') as HTMLInputElement).value;
  const speakerId = (document.getElementById('speaker') as HTMLSelectElement).value;

  if (!apiKeyYoutube) {
    document.getElementById('error')!.textContent = 'YouTube APIキーが設定されていません。';
    validateInputs(); // 状態復元
    return;
  }

  chrome.storage.sync.set(
    {
      apiKeyVOICEVOX: apiKeyVOICEVOX,
      apiKeyYoutube: apiKeyYoutube,
      speed: speed,
      volume: volume,
      latestOnlyMode: (document.getElementById('latestOnlyMode') as HTMLInputElement).checked,
      speakerId: speakerId,
    },
    function () {
      // eslint-disable-next-line no-console
      console.log('API keys, speed, and volume saved');
    }
  );

  chrome.runtime.sendMessage(
    {
      action: 'start',
      apiKeyVOICEVOX,
      apiKeyYoutube,
      speed: speed,
      volume: volume,
      latestOnlyMode: (document.getElementById('latestOnlyMode') as HTMLInputElement).checked,
      speakerId: speakerId,
    },
    function (response: { status: string; message?: string; details?: string }) {
      if (chrome.runtime.lastError) {
        document.getElementById('error')!.textContent = chrome.runtime.lastError.message || '';
        validateInputs(); // エラー時は活性状態に戻す
      } else if (response && response.status === 'error') {
        let errorMessage = response.message || '';
        if (response.details) {
          errorMessage += '\n\nデバッグ情報:\n' + response.details;
        }
        document.getElementById('error')!.textContent = errorMessage;
        validateInputs(); // エラー時は活性状態に戻す
      } else {
        document.getElementById('error')!.textContent = 'エラーなし';
        // 成功時のボタン状態は updateStatusUI で制御されるためここでは何もしない
      }
    }
  );
});

document.getElementById('stop')!.addEventListener('click', () => {
  chrome.runtime.sendMessage(
    { action: 'stop' },
    function (response: { status: string; message?: string }) {
      if (chrome.runtime.lastError) {
        document.getElementById('error')!.textContent = chrome.runtime.lastError.message || '';
      } else if (response && response.status === 'error') {
        document.getElementById('error')!.textContent = response.message || '';
      } else {
        document.getElementById('error')!.textContent = '停止しました';
      }
    }
  );
});

document.getElementById('reset-speed')!.addEventListener('click', () => {
  speed = 1.0;
  chrome.storage.sync.set({ speed: speed });
  document.getElementById('current-speed')!.textContent = `${speed.toFixed(1)}x`;

  // 再生中のオーディオの速度を変更
  chrome.runtime.sendMessage({ action: 'setSpeed', speed: speed });

  // キュー内のコメントの速度を変更
  chrome.runtime.sendMessage({ action: 'updateQueueSpeed', speed: speed });

  const speedSlider = document.getElementById('speed') as HTMLInputElement;
  speedSlider.value = String(speed);
  speedSlider.setAttribute('aria-valuetext', '1.0倍速');
  setRangeFill(speedSlider);
});

document.getElementById('volume')!.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  volume = parseFloat(target.value);
  chrome.storage.sync.set({ volume: volume });
  document.getElementById('current-volume')!.textContent = `${volume}`;
  chrome.runtime.sendMessage({ action: 'setVolume', volume: volume });

  const pct = Math.round(volume * 100);
  target.setAttribute('aria-valuetext', `音量${pct}%`);
  setRangeFill(target);
});

document.getElementById('latestOnlyMode')!.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  const newMode = target.checked;
  chrome.storage.sync.set({ latestOnlyMode: newMode });
  target.setAttribute('aria-checked', String(newMode));

  // 実行中の場合は、新しいモードをbackground.jsに即時反映
  chrome.runtime.sendMessage({
    action: 'updateLatestOnlyMode',
    latestOnlyMode: newMode,
  });
});

// 話者選択の変更イベントリスナー
document.getElementById('speaker')!.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement;
  const newSpeakerId = target.value;
  chrome.storage.sync.set({ speakerId: newSpeakerId });

  // background.jsに話者変更を通知
  chrome.runtime.sendMessage({
    action: 'updateSpeaker',
    speakerId: newSpeakerId,
  });
});

// エラーメッセージ更新のリスナーを追加
chrome.runtime.onMessage.addListener(function (request: {
  action: string;
  status?: string;
  message?: string;
  timestamp?: string;
  commentCount?: number;
  queueLength?: number;
}) {
  // ステータス更新
  if (request.action === 'updateStatus') {
    updateStatusUI(
      request.status || 'idle',
      request.message || '',
      request.commentCount || 0,
      request.queueLength || 0
    );
  } else if (request.action === 'updateErrorMessage') {
    const errorElement = document.getElementById('error');
    if (errorElement) {
      errorElement.textContent = request.message || '';
    }
  }
  // デバッグメッセージリスナー
  else if (request.action === 'debugInfo') {
    const debugElement = document.getElementById('debug');
    // #debug の親要素（ログのアコーディオン）を直接取得
    const accordionContent = debugElement?.closest('.accordion-content') as HTMLElement | null;
    if (debugElement && accordionContent) {
      // スクロール位置の判定
      // クライアントの高さ + スクロール量が、全体の高さとほぼ同じであれば一番下にいると判定
      // 許容誤差を大きめ(50px)にして、ほぼ底付近にいれば自動スクロールを維持する
      const isScrolledToBottom =
        accordionContent.scrollHeight - accordionContent.clientHeight <=
        accordionContent.scrollTop + 50;

      const timestamp = request.timestamp || new Date().toLocaleTimeString();
      const newMessage = `[${timestamp}] ${request.message}\n`;
      debugElement.insertAdjacentText('beforeend', newMessage);

      // 一番下にいた場合のみ、新しいログに合わせて一番下までスクロールさせる
      if (isScrolledToBottom) {
        accordionContent.scrollTop = accordionContent.scrollHeight;
      }
    }
  }
});

// 専用ページを開く
document.getElementById('open-log-page')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('log/log.html') });
});

// アコーディオンの機能を追加
document.querySelectorAll('.accordion-button').forEach((btn) => {
  btn.addEventListener('click', function (this: HTMLElement) {
    this.classList.toggle('active');
    const accordion = this.closest('.accordion');
    const content = accordion?.querySelector('.accordion-content') as HTMLElement;
    if (content) {
      content.classList.toggle('active');
    }
  });
});

// スピードスライダーのイベントリスナー
document.getElementById('speed')!.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  speed = parseFloat(target.value);
  chrome.storage.sync.set({ speed: speed });
  document.getElementById('current-speed')!.textContent = `${speed.toFixed(1)}x`;

  // 再生中のオーディオの速度を変更
  chrome.runtime.sendMessage({ action: 'setSpeed', speed: speed });

  // キュー内のコメントの速度を変更
  chrome.runtime.sendMessage({ action: 'updateQueueSpeed', speed: speed });

  target.setAttribute('aria-valuetext', `${speed.toFixed(1)}倍速`);
  setRangeFill(target);
});

let currentStatus: string = 'idle';

// ステータスバーとボタンのUIを更新する関数
function updateStatusUI(status: string, message: string, count: number, queueLength = 0): void {
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
}

// 入力バリデーション
function validateInputs(): void {
  const apiKeyInput = document.getElementById('apiKeyYoutube') as HTMLInputElement;
  const apiKey = apiKeyInput.value.trim();
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const playTooltip = document.getElementById('play-tooltip') as HTMLElement;
  const banner = document.getElementById('api-key-banner');

  if (!apiKey) {
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
}

// YouTube APIキー入力の変更を監視・自動保存
document.getElementById('apiKeyYoutube')!.addEventListener('input', () => {
  const value = (document.getElementById('apiKeyYoutube') as HTMLInputElement).value;
  chrome.storage.sync.set({ apiKeyYoutube: value });
  validateInputs();
});

// VOICEVOX APIキー入力の自動保存
document.getElementById('apiKeyVOICEVOX')!.addEventListener('input', () => {
  const value = (document.getElementById('apiKeyVOICEVOX') as HTMLInputElement).value;
  chrome.storage.sync.set({ apiKeyVOICEVOX: value });
});

// APIキーの表示/非表示切替 (YouTube)
document.getElementById('toggle-api-key')!.addEventListener('click', () => {
  const input = document.getElementById('apiKeyYoutube') as HTMLInputElement;
  const btn = document.getElementById('toggle-api-key')!;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🔒';
    btn.setAttribute('aria-label', 'APIキーを非表示にする');
  } else {
    input.type = 'password';
    btn.textContent = '👀';
    btn.setAttribute('aria-label', 'APIキーを表示する');
  }
});

// APIキーの表示/非表示切替 (VOICEVOX)
document.getElementById('toggle-voicevox-key')?.addEventListener('click', () => {
  const input = document.getElementById('apiKeyVOICEVOX') as HTMLInputElement;
  const btn = document.getElementById('toggle-voicevox-key')!;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🔒';
    btn.setAttribute('aria-label', 'APIキーを非表示にする');
  } else {
    input.type = 'password';
    btn.textContent = '👀';
    btn.setAttribute('aria-label', 'APIキーを表示する');
  }
});

// ダークモード切替
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

// --- コメントフィルター ---

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

// --- TTSエンジン選択 ---

/** 指定音声が rate パラメータをサポートするか判定 */
function isRateSupportedVoice(voiceName: string): boolean {
  if (!voiceName) return true;
  const name = voiceName.toLowerCase();
  return name === 'kyoko' || name.startsWith('google');
}

/** エンジン・音声に応じて速度スライダーの有効/無効を切り替える */
function updateSpeedSliderState(): void {
  const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
  const speedSlider = document.getElementById('speed') as HTMLInputElement;
  const resetBtn = document.getElementById('reset-speed') as HTMLButtonElement;
  const info = document.getElementById('speed-unsupported-info')!;

  if (engine === 'browser') {
    const voiceName = (document.getElementById('browserVoice') as HTMLSelectElement).value;
    if (!isRateSupportedVoice(voiceName)) {
      speedSlider.disabled = true;
      resetBtn.disabled = true;
      speedSlider.value = '1.0';
      document.getElementById('current-speed')!.textContent = '1.0x';
      speedSlider.setAttribute('aria-valuetext', '1.0倍速');
      setRangeFill(speedSlider);
      info.style.display = 'block';
      return;
    }
  }

  speedSlider.disabled = false;
  resetBtn.disabled = false;
  speedSlider.value = String(speed);
  document.getElementById('current-speed')!.textContent = `${speed.toFixed(1)}x`;
  speedSlider.setAttribute('aria-valuetext', `${speed.toFixed(1)}倍速`);
  setRangeFill(speedSlider);
  info.style.display = 'none';
}

/** エンジン・音声に応じて音量スライダーの有効/無効を切り替える */
function updateVolumeSliderState(): void {
  const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
  const volumeSlider = document.getElementById('volume') as HTMLInputElement;
  const info = document.getElementById('volume-unsupported-info')!;

  if (engine === 'browser') {
    const voiceName = (document.getElementById('browserVoice') as HTMLSelectElement).value;
    if (!isRateSupportedVoice(voiceName)) {
      volumeSlider.disabled = true;
      volumeSlider.value = '1';
      document.getElementById('current-volume')!.textContent = '1.0';
      volumeSlider.setAttribute('aria-valuetext', '音量100%');
      setRangeFill(volumeSlider);
      info.style.display = 'block';
      return;
    }
  }

  volumeSlider.disabled = false;
  volumeSlider.value = String(volume);
  document.getElementById('current-volume')!.textContent = `${volume}`;
  const pct = Math.round(volume * 100);
  volumeSlider.setAttribute('aria-valuetext', `音量${pct}%`);
  setRangeFill(volumeSlider);
  info.style.display = 'none';
}

function toggleEngineUI(engine: string): void {
  document.getElementById('voicevox-settings')!.style.display =
    engine === 'voicevox' ? 'block' : 'none';
  document.getElementById('browser-tts-settings')!.style.display =
    engine === 'browser' ? 'block' : 'none';
  document.getElementById('voicevox-api-key-section')!.style.display =
    engine === 'voicevox' ? 'block' : 'none';
  updateSpeedSliderState();
  updateVolumeSliderState();
}

function populateBrowserVoices(savedVoice?: string): void {
  const select = document.getElementById('browserVoice') as HTMLSelectElement;
  const warning = document.getElementById('no-ja-voices-warning')!;

  chrome.tts.getVoices((voices) => {
    select.innerHTML = '';

    const jaVoices = voices.filter((v) => v.lang?.startsWith('ja'));
    const otherVoices = voices.filter((v) => !v.lang?.startsWith('ja'));

    if (jaVoices.length > 0) {
      const group = document.createElement('optgroup');
      group.label = '日本語';
      jaVoices.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.voiceName || '';
        opt.textContent = `${v.voiceName} (${v.lang})`;
        group.appendChild(opt);
      });
      select.appendChild(group);
      warning.style.display = 'none';
    } else {
      warning.style.display = 'block';
    }

    if (otherVoices.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'その他';
      otherVoices.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.voiceName || '';
        opt.textContent = `${v.voiceName} (${v.lang})`;
        group.appendChild(opt);
      });
      select.appendChild(group);
    }

    if (savedVoice) {
      select.value = savedVoice;
    } else {
      const googleJa = Array.from(select.options).find(
        (opt) => opt.value.startsWith('Google') && opt.value.includes('日本語')
      );
      if (googleJa) {
        select.value = googleJa.value;
        chrome.storage.sync.set({ browserVoice: googleJa.value });
        chrome.runtime.sendMessage({ action: 'updateBrowserVoice', voiceName: googleJa.value });
      }
    }
    updateSpeedSliderState();
    updateVolumeSliderState();
  });
}

document.getElementById('ttsEngine')!.addEventListener('change', (event) => {
  const engine = (event.target as HTMLSelectElement).value;
  chrome.storage.sync.set({ ttsEngine: engine });
  chrome.runtime.sendMessage({ action: 'updateTtsEngine', engine });
  toggleEngineUI(engine);
});

document.getElementById('browserVoice')!.addEventListener('change', (event) => {
  const voiceName = (event.target as HTMLSelectElement).value;
  chrome.storage.sync.set({ browserVoice: voiceName });
  chrome.runtime.sendMessage({ action: 'updateBrowserVoice', voiceName });
  updateSpeedSliderState();
  updateVolumeSliderState();
});
