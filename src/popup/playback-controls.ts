import { setRangeFill } from './slider-utils';
import { validateInputs } from './status-ui';

let speed = 1.0;
let volume = 1.0;

export function getSpeed(): number {
  return speed;
}

export function setSpeed(s: number): void {
  speed = s;
}

export function getVolume(): number {
  return volume;
}

export function setVolume(v: number): void {
  volume = v;
}

export function initPlaybackControls(): void {
  // chatMode セレクトの変更リスナー
  document.getElementById('chatMode')?.addEventListener('change', (event) => {
    const mode = (event.target as HTMLSelectElement).value as 'official' | 'standalone' | 'dom';
    chrome.storage.sync.set({ chatMode: mode });
    const ytSection = document.getElementById('youtube-api-key-section');
    const saInfo = document.getElementById('standalone-mode-info');
    const domInfo = document.getElementById('dom-mode-info');
    if (ytSection) ytSection.style.display = mode === 'official' ? 'block' : 'none';
    if (saInfo) saInfo.style.display = mode === 'standalone' ? 'block' : 'none';
    if (domInfo) domInfo.style.display = mode === 'dom' ? 'block' : 'none';
    validateInputs();
  });

  // Play ボタン
  document.getElementById('play')!.addEventListener('click', (event) => {
    const playBtn = event.target as HTMLButtonElement;
    // 連打防止のため即座に無効化
    playBtn.disabled = true;

    const apiKeyVOICEVOX = (document.getElementById('apiKeyVOICEVOX') as HTMLInputElement).value;
    const apiKeyYoutube = (document.getElementById('apiKeyYoutube') as HTMLInputElement).value;
    const engine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
    const speakerId = engine === 'local-voicevox'
      ? (document.getElementById('localSpeaker') as HTMLSelectElement).value
      : (document.getElementById('speaker') as HTMLSelectElement).value;
    const chatMode = ((document.getElementById('chatMode') as HTMLSelectElement)?.value ?? 'dom') as 'official' | 'standalone' | 'dom';

    if (chatMode === 'official' && !apiKeyYoutube) {
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
        latestOnlyCount: parseInt(
          (document.getElementById('latestOnlyCount') as HTMLInputElement).value,
          10
        ),
        speakerId: speakerId,
        chatMode: chatMode,
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
        latestOnlyCount: parseInt(
          (document.getElementById('latestOnlyCount') as HTMLInputElement).value,
          10
        ),
        speakerId: speakerId,
        chatMode: chatMode,
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

  // Stop ボタン
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

  // Speed リセットボタン
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

  // Volume スライダー
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

  // Latest only mode
  document.getElementById('latestOnlyMode')!.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    const newMode = target.checked;
    const count = parseInt(
      (document.getElementById('latestOnlyCount') as HTMLInputElement).value,
      10
    );
    chrome.storage.sync.set({ latestOnlyMode: newMode });
    target.setAttribute('aria-checked', String(newMode));

    document.getElementById('latest-only-options')!.style.display = newMode ? 'block' : 'none';

    // 実行中の場合は、新しいモードをbackground.jsに即時反映
    chrome.runtime.sendMessage({
      action: 'updateLatestOnlyMode',
      latestOnlyMode: newMode,
      latestOnlyCount: count,
    });
  });

  // Latest only count スライダー
  document.getElementById('latestOnlyCount')!.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const val = parseInt(target.value, 10);
    document.getElementById('current-latest-count')!.textContent = `${val}件`;
    target.setAttribute('aria-valuetext', `${val}件`);
    setRangeFill(target);

    chrome.storage.sync.set({ latestOnlyCount: val });
    chrome.runtime.sendMessage({
      action: 'updateLatestOnlyMode',
      latestOnlyMode: (document.getElementById('latestOnlyMode') as HTMLInputElement).checked,
      latestOnlyCount: val,
    });
  });

  // Latest only リセットボタン
  document.getElementById('reset-latest-only')!.addEventListener('click', () => {
    const slider = document.getElementById('latestOnlyCount') as HTMLInputElement;
    slider.value = '3';
    document.getElementById('current-latest-count')!.textContent = '3件';
    slider.setAttribute('aria-valuetext', '3件');
    setRangeFill(slider);

    chrome.storage.sync.set({ latestOnlyCount: 3 });
    chrome.runtime.sendMessage({
      action: 'updateLatestOnlyMode',
      latestOnlyMode: (document.getElementById('latestOnlyMode') as HTMLInputElement).checked,
      latestOnlyCount: 3,
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
    // updateVoicevoxBalanceVisibility is called from tts-engine-config via its own listener
    // but we need to call it here too for the balance row visibility
    const key = value.trim();
    const row = document.getElementById('voicevox-balance-row');
    const note = document.getElementById('voicevox-balance-note');
    if (row) row.style.display = key ? 'flex' : 'none';
    if (note) note.style.display = key ? 'block' : 'none';
    const result = document.getElementById('voicevox-balance-result');
    if (result) result.textContent = '';
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
}
