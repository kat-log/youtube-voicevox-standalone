import '../styles/styles.scss';

let speed = 1.0;
let volume = 1.0;

window.onload = function () {
  chrome.storage.sync.get(
    ['apiKeyVOICEVOX', 'apiKeyYoutube', 'speed', 'volume', 'latestOnlyMode', 'speakerId', 'darkMode', 'filterConfig', 'ttsEngine', 'browserVoice'],
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

      volume = data.volume || 1.0;
      (document.getElementById('volume') as HTMLInputElement).value = String(volume);
      document.getElementById('current-volume')!.textContent = `${volume}`;
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
      const fc = data.filterConfig || { enabled: false, minLength: 1, skipEmojiOnly: false, ngWords: [] };
      (document.getElementById('filterEnabled') as HTMLInputElement).checked = fc.enabled;
      document.getElementById('filterEnabled')!.setAttribute('aria-checked', String(fc.enabled));
      document.getElementById('filter-options')!.style.display = fc.enabled ? 'block' : 'none';
      (document.getElementById('filterMinLength') as HTMLInputElement).value = String(fc.minLength);
      document.getElementById('current-min-length')!.textContent = String(fc.minLength);
      (document.getElementById('filterSkipEmojiOnly') as HTMLInputElement).checked = fc.skipEmojiOnly;
      document.getElementById('filterSkipEmojiOnly')!.setAttribute('aria-checked', String(fc.skipEmojiOnly));
      (document.getElementById('filterNgWords') as HTMLInputElement).value = (fc.ngWords || []).join(', ');

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
            updateStatusUI(response.status || 'idle', '', response.commentCount || 0, response.queueLength || 0);
          }
        }
      );

      // 初期バリデーション
      validateInputs();
    }
  );
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

document.getElementById('play')!.addEventListener('click', () => {
  const apiKeyVOICEVOX = (document.getElementById('apiKeyVOICEVOX') as HTMLInputElement).value;
  const apiKeyYoutube = (document.getElementById('apiKeyYoutube') as HTMLInputElement).value;
  const speakerId = (document.getElementById('speaker') as HTMLSelectElement).value;

  if (!apiKeyYoutube) {
    document.getElementById('error')!.textContent = 'YouTube APIキーが設定されていません。';
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
      } else if (response && response.status === 'error') {
        let errorMessage = response.message || '';
        if (response.details) {
          errorMessage += '\n\nデバッグ情報:\n' + response.details;
        }
        document.getElementById('error')!.textContent = errorMessage;
      } else {
        document.getElementById('error')!.textContent = 'エラーなし';
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
});

document.getElementById('volume')!.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  volume = parseFloat(target.value);
  chrome.storage.sync.set({ volume: volume });
  document.getElementById('current-volume')!.textContent = `${volume}`;
  chrome.runtime.sendMessage({ action: 'setVolume', volume: volume });

  const pct = Math.round(volume * 100);
  target.setAttribute('aria-valuetext', `音量${pct}%`);
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
chrome.runtime.onMessage.addListener(function (
  request: { action: string; status?: string; message?: string; commentCount?: number; queueLength?: number },
) {
  // ステータス更新
  if (request.action === 'updateStatus') {
    updateStatusUI(request.status || 'idle', request.message || '', request.commentCount || 0, request.queueLength || 0);
  } else if (request.action === 'updateErrorMessage') {
    const errorElement = document.getElementById('error');
    if (errorElement) {
      errorElement.textContent = request.message || '';
    }
  }
  // デバッグメッセージリスナー
  else if (request.action === 'debugInfo') {
    const debugElement = document.getElementById('debug');
    if (debugElement) {
      const timestamp = new Date().toLocaleTimeString();
      const newMessage = `[${timestamp}] ${request.message}\n${debugElement.textContent}`;
      debugElement.textContent = newMessage;
    }
  }
});

// アコーディオンの機能を追加
document.querySelector('.accordion-button')!.addEventListener('click', function (this: HTMLElement) {
  const content = this.nextElementSibling as HTMLElement;
  content.classList.toggle('active');
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
});

// ステータスバーのUIを更新する関数
function updateStatusUI(status: string, message: string, count: number, queueLength = 0): void {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const countEl = document.getElementById('status-count');
  const queueEl = document.getElementById('queue-info');
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
    case 'listening':
      text.textContent = '読み上げ中';
      countEl.textContent = count > 0 ? `（${count}件読上済）` : '';
      queueEl.textContent = queueLength > 0 ? `待機: ${queueLength}件` : '';
      break;
    case 'error':
      text.textContent = 'エラー: ' + (message || '不明');
      countEl.textContent = '';
      queueEl.textContent = '';
      break;
  }
}

// 入力バリデーション
function validateInputs(): void {
  const apiKey = (document.getElementById('apiKeyYoutube') as HTMLInputElement).value.trim();
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  playBtn.disabled = !apiKey;
}

// YouTube APIキー入力の変更を監視
document.getElementById('apiKeyYoutube')!.addEventListener('input', validateInputs);

// APIキーの表示/非表示切替
document.getElementById('toggle-api-key')!.addEventListener('click', () => {
  const input = document.getElementById('apiKeyYoutube') as HTMLInputElement;
  const btn = document.getElementById('toggle-api-key')!;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🔒';
    btn.setAttribute('aria-label', 'APIキーを非表示にする');
  } else {
    input.type = 'password';
    btn.textContent = '👁';
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
  const minLength = parseInt((document.getElementById('filterMinLength') as HTMLInputElement).value, 10);
  const skipEmojiOnly = (document.getElementById('filterSkipEmojiOnly') as HTMLInputElement).checked;
  const ngWordsRaw = (document.getElementById('filterNgWords') as HTMLInputElement).value;
  const ngWords = ngWordsRaw.split(',').map((w) => w.trim()).filter((w) => w.length > 0);

  const filterConfig = { enabled, minLength, skipEmojiOnly, ngWords };
  chrome.runtime.sendMessage({ action: 'updateFilterConfig', filterConfig });
}

document.getElementById('filterEnabled')!.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  target.setAttribute('aria-checked', String(target.checked));
  document.getElementById('filter-options')!.style.display = target.checked ? 'block' : 'none';
  sendFilterConfig();
});

document.getElementById('filterMinLength')!.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  document.getElementById('current-min-length')!.textContent = target.value;
  target.setAttribute('aria-valuetext', `${target.value}文字`);
  sendFilterConfig();
});

document.getElementById('filterSkipEmojiOnly')!.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  target.setAttribute('aria-checked', String(target.checked));
  sendFilterConfig();
});

let ngWordsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
document.getElementById('filterNgWords')!.addEventListener('input', () => {
  if (ngWordsDebounceTimer) clearTimeout(ngWordsDebounceTimer);
  ngWordsDebounceTimer = setTimeout(sendFilterConfig, 500);
});

// --- TTSエンジン選択 ---

function toggleEngineUI(engine: string): void {
  document.getElementById('voicevox-settings')!.style.display =
    engine === 'voicevox' ? 'block' : 'none';
  document.getElementById('browser-tts-settings')!.style.display =
    engine === 'browser' ? 'block' : 'none';
  document.getElementById('voicevox-api-key-section')!.style.display =
    engine === 'voicevox' ? 'block' : 'none';
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

    if (savedVoice) select.value = savedVoice;
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
});
