import { setRangeFill } from './slider-utils';
import { getSpeed, getVolume } from './playback-controls';
import { updateParallelSpeakersToggleState } from './parallel-playback-config';

// VOICEVOX残高確認行の表示/非表示
export function updateVoicevoxBalanceVisibility(): void {
  const key = (document.getElementById('apiKeyVOICEVOX') as HTMLInputElement).value.trim();
  const row = document.getElementById('voicevox-balance-row');
  const note = document.getElementById('voicevox-balance-note');
  if (row) row.style.display = key ? 'flex' : 'none';
  if (note) note.style.display = key ? 'block' : 'none';
  const result = document.getElementById('voicevox-balance-result');
  if (result) result.textContent = '';
}

/** 指定音声が rate パラメータをサポートするか判定 */
function isRateSupportedVoice(voiceName: string): boolean {
  if (!voiceName) return true;
  const name = voiceName.toLowerCase();
  return name === 'kyoko' || name.startsWith('google');
}

/** エンジン・音声に応じて速度スライダーの有効/無効を切り替える */
export function updateSpeedSliderState(): void {
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

  const speed = getSpeed();
  speedSlider.disabled = false;
  resetBtn.disabled = false;
  speedSlider.value = String(speed);
  document.getElementById('current-speed')!.textContent = `${speed.toFixed(1)}x`;
  speedSlider.setAttribute('aria-valuetext', `${speed.toFixed(1)}倍速`);
  setRangeFill(speedSlider);
  info.style.display = 'none';
}

/** エンジン・音声に応じて音量スライダーの有効/無効を切り替える */
export function updateVolumeSliderState(): void {
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

  const volume = getVolume();
  volumeSlider.disabled = false;
  volumeSlider.value = String(volume);
  document.getElementById('current-volume')!.textContent = `${volume}`;
  const pct = Math.round(volume * 100);
  volumeSlider.setAttribute('aria-valuetext', `音量${pct}%`);
  setRangeFill(volumeSlider);
  info.style.display = 'none';
}

export function toggleEngineUI(engine: string): void {
  document.getElementById('voicevox-settings')!.style.display =
    engine === 'voicevox' ? 'block' : 'none';
  document.getElementById('browser-tts-settings')!.style.display =
    engine === 'browser' ? 'block' : 'none';
  document.getElementById('local-voicevox-settings')!.style.display =
    engine === 'local-voicevox' ? 'block' : 'none';
  document.getElementById('voicevox-api-key-section')!.style.display =
    engine === 'voicevox' ? 'block' : 'none';

  // ランダム話者セクション: 全エンジンで表示
  document.getElementById('random-speaker-section')!.style.display = 'block';

  updateSpeedSliderState();
  updateVolumeSliderState();

  // ブラウザTTSでは並列再生不可のためUI全体を無効化
  const isBrowser = engine === 'browser';
  const parallelAlwaysToggle = document.getElementById('parallelAlwaysEnabled') as HTMLInputElement;
  const parallelAutoToggle = document.getElementById('parallelAutoEnabled') as HTMLInputElement;
  parallelAlwaysToggle.disabled = isBrowser;
  parallelAutoToggle.disabled = isBrowser;

  // スライダーも無効化
  const thresholdSlider = document.getElementById('parallelAutoTriggerThreshold') as HTMLInputElement;
  thresholdSlider.disabled = isBrowser;
  setRangeFill(thresholdSlider);

  // リセットボタンも無効化
  (document.getElementById('reset-parallel-auto') as HTMLButtonElement).disabled = isBrowser;

  document.getElementById('parallel-unsupported-info')!.style.display = isBrowser ? 'block' : 'none';

  // ランダム話者モードの話者ドロップダウン無効化を正しいエンジンに対応
  const randomEnabled = (document.getElementById('randomSpeakerEnabled') as HTMLInputElement).checked;
  if (randomEnabled) {
    (document.getElementById('speaker') as HTMLSelectElement).disabled = engine === 'voicevox';
    (document.getElementById('localSpeaker') as HTMLSelectElement).disabled = engine === 'local-voicevox';
    (document.getElementById('browserVoice') as HTMLSelectElement).disabled = engine === 'browser';
  }

  // マルチ話者トグルの有効/無効を更新
  updateParallelSpeakersToggleState();
}

export function populateBrowserVoices(savedVoice?: string): void {
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

export function fetchLocalSpeakers(host: string, savedSpeakerId?: string): void {
  const select = document.getElementById('localSpeaker') as HTMLSelectElement;
  select.innerHTML = '<option value="">取得中...</option>';

  chrome.runtime.sendMessage(
    { action: 'getLocalSpeakers', host },
    (response: { status: string; speakers?: Array<{ name: string; styles: Array<{ id: number; name: string }> }> }) => {
      if (chrome.runtime.lastError || !response || response.status !== 'success' || !response.speakers) {
        select.innerHTML = '<option value="">接続テストを実行してください</option>';
        return;
      }

      select.innerHTML = '';
      response.speakers.forEach((speaker) => {
        const group = document.createElement('optgroup');
        group.label = speaker.name;
        speaker.styles.forEach((style) => {
          const opt = document.createElement('option');
          opt.value = String(style.id);
          opt.textContent = `${speaker.name} (${style.name})`;
          group.appendChild(opt);
        });
        select.appendChild(group);
      });

      if (savedSpeakerId) {
        select.value = savedSpeakerId;
      } else if (select.options.length > 0) {
        // 未保存時は最初の話者IDをストレージに保存して同期
        const firstValue = select.options[0].value;
        if (firstValue) {
          chrome.storage.sync.set({ localSpeakerId: firstValue });
        }
      }

      // ローカルVOICEVOXが現在のエンジンなら持ち回り制トグルの有効/無効を更新
      const currentEngine = (document.getElementById('ttsEngine') as HTMLSelectElement).value;
      if (currentEngine === 'local-voicevox') {
        updateParallelSpeakersToggleState();
      }
    }
  );
}

export function initTtsEngineConfig(): void {
  // TTS エンジン変更
  document.getElementById('ttsEngine')!.addEventListener('change', (event) => {
    const engine = (event.target as HTMLSelectElement).value;
    chrome.storage.sync.set({ ttsEngine: engine });
    chrome.runtime.sendMessage({ action: 'updateTtsEngine', engine });
    toggleEngineUI(engine);
  });

  // ブラウザ音声変更
  document.getElementById('browserVoice')!.addEventListener('change', (event) => {
    const voiceName = (event.target as HTMLSelectElement).value;
    chrome.storage.sync.set({ browserVoice: voiceName });
    chrome.runtime.sendMessage({ action: 'updateBrowserVoice', voiceName });
    updateSpeedSliderState();
    updateVolumeSliderState();
  });

  // 接続テストボタン
  document.getElementById('test-local-voicevox')!.addEventListener('click', () => {
    const host = (document.getElementById('localVoicevoxHost') as HTMLInputElement).value.trim();
    const statusEl = document.getElementById('local-voicevox-status')!;
    const btn = document.getElementById('test-local-voicevox') as HTMLButtonElement;

    if (!host) {
      statusEl.textContent = 'エンジンURLを入力してください';
      statusEl.className = 'info-text warning-text';
      statusEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    statusEl.textContent = '接続中...';
    statusEl.className = 'info-text';
    statusEl.style.display = 'block';

    chrome.runtime.sendMessage(
      { action: 'testLocalVoicevox', host },
      (response: { status: string; message?: string }) => {
        btn.disabled = false;
        if (chrome.runtime.lastError) {
          statusEl.textContent = '接続エラー: ' + (chrome.runtime.lastError.message || '不明');
          statusEl.className = 'info-text warning-text';
          return;
        }

        if (response && response.status === 'success') {
          statusEl.textContent = '接続成功 (version: ' + (response.message || '不明') + ')';
          statusEl.className = 'info-text';
          // 接続成功時にスピーカーリスト取得
          chrome.storage.sync.get(['localSpeakerId'], (data) => {
            fetchLocalSpeakers(host, data.localSpeakerId);
          });
        } else {
          statusEl.textContent =
            '接続失敗: VOICEVOXアプリが起動しているか確認してください';
          statusEl.className = 'info-text warning-text';
        }
      }
    );
  });

  // ローカルVOICEVOXホストの自動保存（debounce付き）
  let localHostDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  document.getElementById('localVoicevoxHost')!.addEventListener('input', () => {
    if (localHostDebounceTimer) clearTimeout(localHostDebounceTimer);
    localHostDebounceTimer = setTimeout(() => {
      const host = (document.getElementById('localVoicevoxHost') as HTMLInputElement).value.trim();
      chrome.storage.sync.set({ localVoicevoxHost: host });
      chrome.runtime.sendMessage({ action: 'updateLocalVoicevoxHost', host });
    }, 500);
  });

  // ローカル話者選択の変更
  document.getElementById('localSpeaker')!.addEventListener('change', (event) => {
    const speakerId = (event.target as HTMLSelectElement).value;
    chrome.storage.sync.set({ localSpeakerId: speakerId });
  });

  // 並列音声生成数の変更
  const parallelSynthesisSlider = document.getElementById('parallelSynthesisCount') as HTMLInputElement;
  parallelSynthesisSlider.addEventListener('input', () => {
    const count = parseInt(parallelSynthesisSlider.value, 10);
    document.getElementById('current-parallel-synthesis')!.textContent = String(count);
    parallelSynthesisSlider.setAttribute('aria-valuetext', String(count));
    setRangeFill(parallelSynthesisSlider);
  });
  parallelSynthesisSlider.addEventListener('change', () => {
    const count = parseInt(parallelSynthesisSlider.value, 10);
    chrome.storage.sync.set({ parallelSynthesisCount: count });
    chrome.runtime.sendMessage({ action: 'updateParallelSynthesis', count });
  });

  // VOICEVOX残高確認
  document.getElementById('check-voicevox-balance')?.addEventListener('click', async () => {
    const apiKey = (document.getElementById('apiKeyVOICEVOX') as HTMLInputElement).value.trim();
    const resultEl = document.getElementById('voicevox-balance-result')!;
    const btn = document.getElementById('check-voicevox-balance') as HTMLButtonElement;

    if (!apiKey) return;

    btn.disabled = true;
    resultEl.textContent = '確認中...';
    resultEl.className = 'balance-result balance-loading';

    try {
      const res = await fetch(
        `https://api.tts.quest/v3/key/points?key=${encodeURIComponent(apiKey)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { isApiKeyValid: boolean; points: number } = await res.json();

      if (!data.isApiKeyValid) {
        resultEl.textContent = 'APIキーが無効です';
        resultEl.className = 'balance-result balance-error';
      } else {
        resultEl.textContent = `残高: ${data.points.toLocaleString()} pt`;
        resultEl.className = 'balance-result balance-ok';
      }
    } catch (e) {
      resultEl.textContent = `エラー: ${e instanceof Error ? e.message : '不明'}`;
      resultEl.className = 'balance-result balance-error';
    } finally {
      btn.disabled = false;
    }
  });
}
