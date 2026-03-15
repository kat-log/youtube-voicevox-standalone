import '../styles/styles.scss';

let speed = 1.0;
let volume = 1.0;

window.onload = function () {
  chrome.storage.sync.get(
    ['apiKeyVOICEVOX', 'apiKeyYoutube', 'speed', 'volume', 'latestOnlyMode', 'speakerId', 'darkMode'],
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
        function (response: { status?: string; commentCount?: number }) {
          if (chrome.runtime.lastError) return;
          if (response) {
            updateStatusUI(response.status || 'idle', '', response.commentCount || 0);
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
  request: { action: string; status?: string; message?: string; commentCount?: number },
) {
  // ステータス更新
  if (request.action === 'updateStatus') {
    updateStatusUI(request.status || 'idle', request.message || '', request.commentCount || 0);
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
function updateStatusUI(status: string, message: string, count: number): void {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const countEl = document.getElementById('status-count');
  if (!dot || !text || !countEl) return;

  dot.className = 'status-dot ' + status;
  switch (status) {
    case 'idle':
      text.textContent = '停止中';
      countEl.textContent = '';
      break;
    case 'connecting':
      text.textContent = '接続中...';
      countEl.textContent = '';
      break;
    case 'listening':
      text.textContent = '読み上げ中';
      countEl.textContent = count > 0 ? `（${count}件読上済）` : '';
      break;
    case 'error':
      text.textContent = 'エラー: ' + (message || '不明');
      countEl.textContent = '';
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
