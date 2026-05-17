import '../styles/styles.scss';
import type { TtsEngine, ParallelSpeakersConfig, RoundRobinPreset } from '@/types/state';
import { RANDOM_SPEAKER_SENTINEL } from '@/types/state';
import { initTestSpeakResultListener } from '@/utils/test-speak-ui';

let speakerOptions: Array<{ value: string; label: string }> = [];
let currentEngine: TtsEngine = 'voicevox';
let savedEnabled = false; // 持ち回り制の有効/無効（このページでは変更しない）
let savedSpeakerIds: string[] = [];
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

// テスト再生結果リスナーを初期化
initTestSpeakResultListener();

function getTestText(): string {
  return (document.getElementById('testText') as HTMLInputElement).value.trim();
}

// --- Dark mode ---
chrome.storage.sync.get(['darkMode'], (data) => {
  let isDark: boolean;
  if (data.darkMode !== undefined) {
    isDark = data.darkMode;
  } else {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  if (isDark) {
    document.body.classList.add('dark-mode');
  }
});

// --- Init ---
chrome.storage.sync.get(
  ['ttsEngine', 'localVoicevoxHost', 'parallelSpeakersConfig', 'randomSpeakerEnabled'],
  (data) => {
    currentEngine = (data.ttsEngine as TtsEngine) || 'local-voicevox';
    const host = data.localVoicevoxHost || 'http://localhost:50021';

    const engineLabel = document.getElementById('engine-label')!;
    if (currentEngine === 'browser') {
      engineLabel.textContent = 'ブラウザ内蔵音声';
    } else if (currentEngine === 'local-voicevox') {
      engineLabel.textContent = `ローカル VOICEVOX（${host}）`;
    } else {
      engineLabel.textContent = 'VOICEVOX（Web API）';
    }

    // 保存済み設定を復元
    const psc: ParallelSpeakersConfig = data.parallelSpeakersConfig || {
      enabled: false,
      speakerIds: [],
      roundRobinSpeakerCount: 3,
    };
    savedEnabled = psc.enabled;
    savedSpeakerIds = psc.speakerIds;

    const countSlider = document.getElementById('speakerCount') as HTMLInputElement;
    countSlider.value = String(psc.roundRobinSpeakerCount);
    document.getElementById('current-count')!.textContent = String(psc.roundRobinSpeakerCount);
    countSlider.setAttribute('aria-valuetext', String(psc.roundRobinSpeakerCount));

    // ランダム話者モードの判定
    const randomEnabled = data.randomSpeakerEnabled || false;
    if (randomEnabled) {
      document.getElementById('speaker-assignments')!.style.display = 'none';
      document.getElementById('test-text-form')!.style.display = 'none';
      document.getElementById('random-mode-note')!.style.display = 'block';
    } else if (!psc.enabled) {
      // 持ち回り制がOFFの場合、個別話者設定は不要
      document.getElementById('speaker-assignments')!.style.display = 'none';
      document.getElementById('test-text-form')!.style.display = 'none';
      document.getElementById('round-robin-off-note')!.style.display = 'block';
    }

    fetchSpeakers(host);
  }
);

function fetchSpeakers(localHost: string): void {
  if (currentEngine === 'browser') {
    chrome.tts.getVoices((voices) => {
      speakerOptions = voices
        .filter((v) => v.voiceName)
        .map((v) => ({
          value: v.voiceName!,
          label: `${v.voiceName} (${v.lang || '?'})`,
        }));
      renderDropdowns();
    });
  } else if (currentEngine === 'local-voicevox') {
    chrome.runtime.sendMessage(
      { action: 'getLocalSpeakers', host: localHost },
      (response: {
        status: string;
        speakers?: Array<{ name: string; styles: Array<{ id: number; name: string }> }>;
      }) => {
        if (chrome.runtime.lastError || !response || response.status !== 'success' || !response.speakers) {
          document.getElementById('speaker-list')!.innerHTML =
            '<p class="info-text" style="color: var(--error-color)">ローカル VOICEVOX から話者リストを取得できませんでした。</p>';
          return;
        }
        speakerOptions = [];
        for (const speaker of response.speakers) {
          for (const style of speaker.styles) {
            speakerOptions.push({
              value: String(style.id),
              label: `${speaker.name} (${style.name})`,
            });
          }
        }
        renderDropdowns();
      }
    );
  } else {
    // VOICEVOX Web API
    fetch('https://static.tts.quest/voicevox_speakers.json')
      .then((res) => res.json())
      .then((speakers: (string | null)[]) => {
        speakerOptions = [];
        speakers.forEach((speaker, index) => {
          if (speaker) {
            speakerOptions.push({ value: String(index), label: speaker });
          }
        });
        renderDropdowns();
      })
      .catch(() => {
        document.getElementById('speaker-list')!.innerHTML =
          '<p class="info-text" style="color: var(--error-color)">話者リストの取得に失敗しました。</p>';
      });
  }
}

function renderDropdowns(): void {
  const container = document.getElementById('speaker-list')!;
  container.innerHTML = '';

  const count = parseInt(
    (document.getElementById('speakerCount') as HTMLInputElement).value,
    10
  );
  const dropdownCount = Math.max(0, count - 1);

  for (let i = 0; i < dropdownCount; i++) {
    const row = document.createElement('div');
    row.className = 'speaker-row';

    const label = document.createElement('label');
    label.textContent = `話者${i + 2}:`;

    const select = document.createElement('select');
    select.dataset.index = String(i);
    select.setAttribute('aria-label', `話者${i + 2}の選択`);

    for (const opt of speakerOptions) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }

    // ランダムオプションを末尾に追加
    const randomOption = document.createElement('option');
    randomOption.value = RANDOM_SPEAKER_SENTINEL;
    randomOption.textContent = 'ランダム';
    select.appendChild(randomOption);

    // 保存値を復元
    if (savedSpeakerIds[i]) {
      select.value = savedSpeakerIds[i];
    }

    select.addEventListener('change', () => {
      autoSave();
      // ランダム選択時は再生ボタンを無効化
      playBtn.disabled = select.value === RANDOM_SPEAKER_SENTINEL;
      // data-speaker-id を更新して結果を正しく受信できるようにする
      playBtn.dataset.speakerId = select.value;
      playStatus.dataset.speakerId = select.value;
    });

    const playBtn = document.createElement('button');
    playBtn.className = 'play-btn';
    playBtn.dataset.speakerId = select.value;
    playBtn.textContent = '\u25B6';
    playBtn.title = 'テスト再生';
    playBtn.disabled = select.value === RANDOM_SPEAKER_SENTINEL;
    playBtn.addEventListener('click', () => {
      const text = getTestText();
      if (!text) return;
      const selectedId = select.value;
      if (selectedId === RANDOM_SPEAKER_SENTINEL) return;
      playBtn.disabled = true;
      chrome.runtime.sendMessage({
        action: 'testSpeak',
        text,
        speakerId: selectedId,
      });
    });

    const playStatus = document.createElement('span');
    playStatus.className = 'play-status';
    playStatus.dataset.speakerId = select.value;

    row.appendChild(label);
    row.appendChild(select);
    row.appendChild(playBtn);
    row.appendChild(playStatus);
    container.appendChild(row);
  }
}

function autoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    const roundRobinSpeakerCount = parseInt(
      (document.getElementById('speakerCount') as HTMLInputElement).value,
      10
    );

    const speakerIds: string[] = [];
    const selects = document.getElementById('speaker-list')!.querySelectorAll('select');
    selects.forEach((select) => {
      speakerIds.push(select.value);
    });

    const config: ParallelSpeakersConfig = {
      enabled: savedEnabled,
      speakerIds,
      roundRobinSpeakerCount,
    };

    chrome.runtime.sendMessage(
      {
        action: 'updateParallelSpeakersConfig',
        parallelSpeakersConfig: config,
      },
      () => {
        savedSpeakerIds = speakerIds;
      }
    );
  }, 300);
}

// --- Slider change ---
const countSlider = document.getElementById('speakerCount') as HTMLInputElement;
countSlider.addEventListener('input', () => {
  const val = parseInt(countSlider.value, 10);
  document.getElementById('current-count')!.textContent = String(val);
  countSlider.setAttribute('aria-valuetext', String(val));
  renderDropdowns();
  autoSave();
});

// --- Round-robin preset management ---
const RR_MAX_PRESETS = 10;
let rrDragStartId: string | null = null;

function loadRoundRobinPresets(): void {
  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    renderRoundRobinPresetList(presets);
    const saveBtn = document.getElementById('rrSavePresetBtn') as HTMLButtonElement;
    saveBtn.disabled = presets.length >= RR_MAX_PRESETS;
  });
}

function renderRoundRobinPresetList(presets: RoundRobinPreset[]): void {
  const container = document.getElementById('rrPresetList')!;
  container.innerHTML = '';

  if (presets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'preset-empty';
    empty.textContent = 'プリセットがありません';
    container.appendChild(empty);
    return;
  }

  for (const preset of presets) {
    const item = document.createElement('div');
    item.className = 'preset-item';
    item.setAttribute('draggable', 'true');
    item.dataset.presetId = preset.id;

    // 上段: ドラッグハンドル + 名前
    const topRow = document.createElement('div');
    topRow.className = 'preset-item-top';

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'ドラッグして並び替え';

    const nameEl = document.createElement('span');
    nameEl.className = 'preset-item-name';
    nameEl.title = preset.name;
    nameEl.textContent = preset.name;

    const renameBtn = document.createElement('button');
    renameBtn.className = 'preset-rename-btn';
    renameBtn.textContent = '✏ 変更';
    renameBtn.title = 'プリセット名を変更';
    renameBtn.addEventListener('click', () => {
      topRow.removeChild(nameEl);
      topRow.removeChild(renameBtn);

      const input = document.createElement('input');
      input.className = 'preset-name-input';
      input.type = 'text';
      input.value = preset.name;
      input.maxLength = 40;

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'preset-name-confirm-btn';
      confirmBtn.textContent = '✓';
      confirmBtn.title = '確定';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'preset-name-cancel-btn';
      cancelBtn.textContent = '✗';
      cancelBtn.title = 'キャンセル';

      const doConfirm = () => {
        const newName = input.value.trim();
        if (newName) renameRoundRobinPreset(preset.id, newName);
      };
      const doCancel = () => {
        topRow.removeChild(input);
        topRow.removeChild(confirmBtn);
        topRow.removeChild(cancelBtn);
        topRow.appendChild(nameEl);
        topRow.appendChild(renameBtn);
      };

      confirmBtn.addEventListener('click', doConfirm);
      cancelBtn.addEventListener('click', doCancel);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) doConfirm();
        if (e.key === 'Escape') doCancel();
      });

      topRow.appendChild(input);
      topRow.appendChild(confirmBtn);
      topRow.appendChild(cancelBtn);
      input.focus();
      input.select();
    });

    topRow.appendChild(handle);
    topRow.appendChild(nameEl);
    topRow.appendChild(renameBtn);

    // 下段: アクションボタン
    const actions = document.createElement('div');
    actions.className = 'preset-item-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'preset-load-btn';
    loadBtn.textContent = '呼び出す';
    loadBtn.title = 'このプリセットの設定を読み込む';
    loadBtn.addEventListener('click', () => applyRoundRobinPreset(preset));

    const overwriteBtn = document.createElement('button');
    overwriteBtn.textContent = '上書き';
    overwriteBtn.title = '現在の設定でこのプリセットを更新';
    overwriteBtn.addEventListener('click', () => overwriteRoundRobinPreset(preset.id));

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '複製';
    copyBtn.disabled = presets.length >= RR_MAX_PRESETS;
    copyBtn.addEventListener('click', () => copyRoundRobinPreset(preset));

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => deleteRoundRobinPreset(preset.id));

    actions.appendChild(loadBtn);
    actions.appendChild(overwriteBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(topRow);
    item.appendChild(actions);

    // ドラッグ&ドロップ
    item.addEventListener('dragstart', (e) => {
      rrDragStartId = preset.id;
      item.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', preset.id);
    });
    item.addEventListener('dragend', () => {
      rrDragStartId = null;
      item.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      container.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      if (rrDragStartId !== preset.id) item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!rrDragStartId || rrDragStartId === preset.id) return;
      reorderRoundRobinPreset(rrDragStartId, preset.id);
    });

    container.appendChild(item);
  }
}

function saveCurrentAsRoundRobinPreset(name: string): void {
  const roundRobinSpeakerCount = parseInt(
    (document.getElementById('speakerCount') as HTMLInputElement).value,
    10
  );
  const speakerIds: string[] = [];
  const selects = document.getElementById('speaker-list')!.querySelectorAll('select');
  selects.forEach((sel) => speakerIds.push(sel.value));

  const preset: RoundRobinPreset = {
    id: crypto.randomUUID(),
    name,
    speakerIds,
    roundRobinSpeakerCount,
  };

  const errorEl = document.getElementById('rrPresetError')!;

  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    if (presets.length >= RR_MAX_PRESETS) {
      errorEl.textContent = `プリセットは最大${RR_MAX_PRESETS}件まで保存できます。`;
      errorEl.style.display = 'block';
      return;
    }
    presets.unshift(preset);
    chrome.storage.sync.set({ roundRobinPresets: presets }, () => {
      (document.getElementById('rrPresetNameInput') as HTMLInputElement).value = '';
      errorEl.style.display = 'none';
      loadRoundRobinPresets();
    });
  });
}

function applyRoundRobinPreset(preset: RoundRobinPreset): void {
  const slider = document.getElementById('speakerCount') as HTMLInputElement;
  slider.value = String(preset.roundRobinSpeakerCount);
  document.getElementById('current-count')!.textContent = String(preset.roundRobinSpeakerCount);
  slider.setAttribute('aria-valuetext', String(preset.roundRobinSpeakerCount));

  renderDropdowns();

  // renderDropdowns の後にドロップダウンの値を復元
  const selects = document.getElementById('speaker-list')!.querySelectorAll('select');
  selects.forEach((sel, idx) => {
    if (preset.speakerIds[idx]) {
      sel.value = preset.speakerIds[idx];
    }
  });

  savedSpeakerIds = preset.speakerIds.slice();
  autoSave();
}

function deleteRoundRobinPreset(id: string): void {
  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    const updated = presets.filter((p) => p.id !== id);
    chrome.storage.sync.set({ roundRobinPresets: updated }, () => loadRoundRobinPresets());
  });
}

function copyRoundRobinPreset(preset: RoundRobinPreset): void {
  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    if (presets.length >= RR_MAX_PRESETS) return;
    const copy: RoundRobinPreset = {
      ...preset,
      id: crypto.randomUUID(),
      name: `${preset.name}のコピー`,
    };
    presets.unshift(copy);
    chrome.storage.sync.set({ roundRobinPresets: presets }, () => loadRoundRobinPresets());
  });
}

function renameRoundRobinPreset(id: string, newName: string): void {
  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    const idx = presets.findIndex((p) => p.id === id);
    if (idx < 0) return;
    presets[idx] = { ...presets[idx], name: newName };
    chrome.storage.sync.set({ roundRobinPresets: presets }, () => loadRoundRobinPresets());
  });
}

function overwriteRoundRobinPreset(id: string): void {
  const roundRobinSpeakerCount = parseInt(
    (document.getElementById('speakerCount') as HTMLInputElement).value,
    10
  );
  const speakerIds: string[] = [];
  document.getElementById('speaker-list')!.querySelectorAll('select').forEach((sel) => {
    speakerIds.push(sel.value);
  });

  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    const idx = presets.findIndex((p) => p.id === id);
    if (idx < 0) return;
    presets[idx] = { ...presets[idx], speakerIds, roundRobinSpeakerCount };
    chrome.storage.sync.set({ roundRobinPresets: presets }, () => loadRoundRobinPresets());
  });
}

function reorderRoundRobinPreset(fromId: string, toId: string): void {
  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    const fromIdx = presets.findIndex((p) => p.id === fromId);
    const toIdx = presets.findIndex((p) => p.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = presets.splice(fromIdx, 1);
    presets.splice(toIdx, 0, moved);
    chrome.storage.sync.set({ roundRobinPresets: presets }, () => loadRoundRobinPresets());
  });
}

// 保存ボタン
document.getElementById('rrSavePresetBtn')!.addEventListener('click', () => {
  const input = document.getElementById('rrPresetNameInput') as HTMLInputElement;
  const name = input.value.trim();
  const errorEl = document.getElementById('rrPresetError')!;
  if (!name) {
    errorEl.textContent = 'プリセット名を入力してください。';
    errorEl.style.display = 'block';
    return;
  }
  errorEl.style.display = 'none';
  saveCurrentAsRoundRobinPreset(name);
});

// Enterキーで保存（IME確定のEnterは除外）
document.getElementById('rrPresetNameInput')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    document.getElementById('rrSavePresetBtn')!.click();
  }
});

// 初期ロード
loadRoundRobinPresets();

