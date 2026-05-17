import '../styles/styles.scss';
import type { TtsEngine, RandomSpeakerPreset } from '@/types/state';
import {
  parseSpeakerName,
  parseLocalSpeakers,
  groupByCharacter,
  getUniqueStyles,
  type ParsedSpeaker,
} from '@/utils/speaker-parser';
import { createTestSpeakButton, initTestSpeakResultListener } from '@/utils/test-speak-ui';

let allSpeakers: ParsedSpeaker[] = [];
let currentEngine: TtsEngine = 'voicevox';
let checkedIds = new Set<string>();
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
chrome.storage.sync.get(['ttsEngine', 'localVoicevoxHost'], (data) => {
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

  fetchSpeakers(host);
});

function fetchSpeakers(localHost: string): void {
  if (currentEngine === 'browser') {
    chrome.tts.getVoices((voices) => {
      const withName = voices.filter((v) => v.voiceName);
      // 日本語を先頭にソートして「日本語」「その他」でグループ化
      const jaVoices = withName.filter((v) => v.lang?.startsWith('ja'));
      const otherVoices = withName.filter((v) => !v.lang?.startsWith('ja'));
      allSpeakers = [
        ...jaVoices.map((v) => ({
          id: v.voiceName!,
          character: '日本語',
          style: '',
          fullName: `${v.voiceName} (${v.lang || '?'})`,
        })),
        ...otherVoices.map((v) => ({
          id: v.voiceName!,
          character: 'その他',
          style: '',
          fullName: `${v.voiceName} (${v.lang || '?'})`,
        })),
      ];
      loadAllowedAndRender();
    });
  } else if (currentEngine === 'local-voicevox') {
    chrome.runtime.sendMessage(
      { action: 'getLocalSpeakers', host: localHost },
      (response: { status: string; speakers?: Array<{ name: string; styles: Array<{ id: number; name: string }> }>; message?: string }) => {
        if (chrome.runtime.lastError || !response || response.status !== 'success' || !response.speakers) {
          showError('ローカル VOICEVOX から話者リストを取得できませんでした。エンジンが起動しているか確認してください。');
          return;
        }
        allSpeakers = parseLocalSpeakers(response.speakers);
        loadAllowedAndRender();
      }
    );
  } else {
    chrome.runtime.sendMessage(
      { action: 'getSpeakerList' },
      (response: { status: string; speakers?: (string | null)[]; message?: string }) => {
        if (chrome.runtime.lastError || !response || response.status !== 'success' || !response.speakers) {
          showError('話者リストの取得に失敗しました。');
          return;
        }
        allSpeakers = response.speakers
          .map((name, index) => (name !== null ? parseSpeakerName(String(index), name) : null))
          .filter((s): s is ParsedSpeaker => s !== null);
        loadAllowedAndRender();
      }
    );
  }
}

function loadAllowedAndRender(): void {
  const storageKey = currentEngine === 'local-voicevox'
    ? 'randomSpeakerAllowedIdsLocal'
    : currentEngine === 'browser'
    ? 'randomSpeakerAllowedIdsBrowser'
    : 'randomSpeakerAllowedIds';
  chrome.storage.sync.get([storageKey], (data) => {
    const saved = data[storageKey] as string[] | undefined;
    if (saved) {
      checkedIds = new Set(saved);
    } else {
      // 未設定 = 全話者
      checkedIds = new Set(allSpeakers.map((s) => s.id));
    }
    render();
  });
}

function showError(msg: string): void {
  const container = document.getElementById('speakerList')!;
  container.innerHTML = `<div class="error-msg">${msg}</div>`;
}

// --- Render ---
function render(): void {
  const container = document.getElementById('speakerList')!;
  container.innerHTML = '';

  const groups = groupByCharacter(allSpeakers);
  const styles = getUniqueStyles(allSpeakers);

  // Style filter dropdown
  const styleFilter = document.getElementById('styleFilter') as HTMLSelectElement;
  styleFilter.innerHTML = '<option value="">全スタイル</option>';
  for (const style of styles) {
    const opt = document.createElement('option');
    opt.value = style;
    opt.textContent = style;
    styleFilter.appendChild(opt);
  }

  // Render character groups
  for (const [charName, speakers] of groups) {
    const group = document.createElement('div');
    group.className = 'char-group';
    group.dataset.character = charName;

    // Header
    const header = document.createElement('div');
    header.className = 'char-header';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'char-checkbox';
    checkbox.dataset.character = charName;
    updateCharCheckbox(checkbox, speakers);

    checkbox.addEventListener('change', () => {
      const styleItems = group.querySelectorAll<HTMLInputElement>('.style-checkbox');
      for (const cb of styleItems) {
        if ((cb.closest('.style-item') as HTMLElement).classList.contains('hidden')) continue;
        cb.checked = checkbox.checked;
        updateCheckedId(cb.dataset.id!, cb.checked);
      }
      checkbox.indeterminate = false;
      updateCharCount(group, speakers);
      autoSave();
    });

    const name = document.createElement('span');
    name.className = 'char-name';
    name.textContent = charName;

    const count = document.createElement('span');
    count.className = 'char-count';
    const checkedCount = speakers.filter((s) => checkedIds.has(s.id)).length;
    count.textContent = `${checkedCount}/${speakers.length}`;

    const arrow = document.createElement('span');
    arrow.className = 'char-arrow';
    arrow.textContent = '\u25B6';

    header.appendChild(checkbox);
    header.appendChild(name);
    header.appendChild(count);
    header.appendChild(arrow);

    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('char-checkbox')) return;
      group.classList.toggle('open');
    });

    // Styles list
    const stylesList = document.createElement('div');
    stylesList.className = 'char-styles';

    for (const speaker of speakers) {
      const item = document.createElement('div');
      item.className = 'style-item';
      item.dataset.style = speaker.style;
      item.dataset.fullName = speaker.fullName;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'style-checkbox';
      cb.checked = checkedIds.has(speaker.id);
      cb.dataset.id = speaker.id;
      cb.dataset.character = charName;

      cb.addEventListener('change', () => {
        updateCheckedId(speaker.id, cb.checked);
        const parentCheckbox = group.querySelector<HTMLInputElement>('.char-checkbox')!;
        updateCharCheckbox(parentCheckbox, speakers);
        updateCharCount(group, speakers);
        autoSave();
      });

      const label = document.createElement('label');
      label.className = 'style-label';
      label.textContent = speaker.style || speaker.fullName;
      label.addEventListener('click', () => {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });

      const idSpan = document.createElement('span');
      idSpan.className = 'style-id';
      idSpan.textContent = `ID:${speaker.id}`;

      const { playBtn, playStatus } = createTestSpeakButton(speaker.id, getTestText);

      item.appendChild(cb);
      item.appendChild(label);
      item.appendChild(idSpan);
      item.appendChild(playBtn);
      item.appendChild(playStatus);
      stylesList.appendChild(item);
    }

    group.appendChild(header);
    group.appendChild(stylesList);
    container.appendChild(group);
  }

  updateSummary();
}

function updateCharCheckbox(checkbox: HTMLInputElement, speakers: ParsedSpeaker[]): void {
  const visibleSpeakers = speakers.filter((s) => {
    const item = document.querySelector(`.style-checkbox[data-id="${s.id}"]`)?.closest('.style-item');
    return !item || !item.classList.contains('hidden');
  });
  const checked = visibleSpeakers.filter((s) => checkedIds.has(s.id)).length;
  if (checked === 0) {
    checkbox.checked = false;
    checkbox.indeterminate = false;
  } else if (checked === visibleSpeakers.length) {
    checkbox.checked = true;
    checkbox.indeterminate = false;
  } else {
    checkbox.checked = false;
    checkbox.indeterminate = true;
  }
}

function updateCharCount(group: HTMLElement, speakers: ParsedSpeaker[]): void {
  const countEl = group.querySelector('.char-count');
  if (countEl) {
    const checked = speakers.filter((s) => checkedIds.has(s.id)).length;
    countEl.textContent = `${checked}/${speakers.length}`;
  }
}

function updateCheckedId(id: string, checked: boolean): void {
  if (checked) {
    checkedIds.add(id);
  } else {
    checkedIds.delete(id);
  }
  updateSummary();
}

function updateSummary(): void {
  const el = document.getElementById('summaryText')!;
  const unit = currentEngine === 'browser' ? '音声' : '話者';
  el.textContent = `${checkedIds.size} / ${allSpeakers.length} ${unit}選択中`;
}

function autoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    const isAll = checkedIds.size >= allSpeakers.length;
    const ids = isAll ? null : Array.from(checkedIds);

    chrome.runtime.sendMessage({
      action: 'updateRandomSpeakerAllowedIds',
      ids,
      engine: currentEngine,
    });
  }, 300);
}

// --- Select All / Deselect All ---
document.getElementById('selectAllBtn')!.addEventListener('click', () => {
  const visibleCheckboxes = getVisibleStyleCheckboxes();
  for (const cb of visibleCheckboxes) {
    cb.checked = true;
    updateCheckedId(cb.dataset.id!, true);
  }
  refreshAllCharCheckboxes();
  autoSave();
});

document.getElementById('deselectAllBtn')!.addEventListener('click', () => {
  const visibleCheckboxes = getVisibleStyleCheckboxes();
  for (const cb of visibleCheckboxes) {
    cb.checked = false;
    updateCheckedId(cb.dataset.id!, false);
  }
  refreshAllCharCheckboxes();
  autoSave();
});

function getVisibleStyleCheckboxes(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('.style-checkbox')
  ).filter((cb) => !(cb.closest('.style-item') as HTMLElement).classList.contains('hidden'));
}

function refreshAllCharCheckboxes(): void {
  const groups = groupByCharacter(allSpeakers);
  for (const [charName, speakers] of groups) {
    const groupEl = document.querySelector<HTMLElement>(`.char-group[data-character="${CSS.escape(charName)}"]`);
    if (!groupEl) continue;
    const checkbox = groupEl.querySelector<HTMLInputElement>('.char-checkbox')!;
    updateCharCheckbox(checkbox, speakers);
    updateCharCount(groupEl, speakers);
  }
}

// --- Expand / Collapse all ---
document.getElementById('expandAllBtn')!.addEventListener('click', () => {
  document.querySelectorAll<HTMLElement>('.char-group:not(.hidden)').forEach((g) => g.classList.add('open'));
});
document.getElementById('collapseAllBtn')!.addEventListener('click', () => {
  document.querySelectorAll<HTMLElement>('.char-group').forEach((g) => g.classList.remove('open'));
});

// --- Search filter ---
document.getElementById('searchInput')!.addEventListener('input', () => {
  applyFilters();
});

// --- Style filter ---
const styleFilter = document.getElementById('styleFilter') as HTMLSelectElement;
styleFilter.addEventListener('change', () => {
  applyFilters();
  const styleBatch = document.getElementById('styleBatch')!;
  const selectedStyle = styleFilter.value;
  if (selectedStyle) {
    document.getElementById('styleBatchLabel')!.textContent = `「${selectedStyle}」を一括操作:`;
    styleBatch.classList.add('visible');
  } else {
    styleBatch.classList.remove('visible');
  }
});

document.getElementById('styleBatchSelect')!.addEventListener('click', () => {
  batchToggleStyle(true);
});
document.getElementById('styleBatchDeselect')!.addEventListener('click', () => {
  batchToggleStyle(false);
});

function batchToggleStyle(checked: boolean): void {
  const selectedStyle = (document.getElementById('styleFilter') as HTMLSelectElement).value;
  if (!selectedStyle) return;
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.style-checkbox');
  for (const cb of checkboxes) {
    const item = cb.closest('.style-item') as HTMLElement;
    if (item.dataset.style === selectedStyle) {
      cb.checked = checked;
      updateCheckedId(cb.dataset.id!, checked);
    }
  }
  refreshAllCharCheckboxes();
  autoSave();
}

// --- Preset management ---
const MAX_PRESETS = 10;
let dragStartId: string | null = null;

function loadRandomPresets(): void {
  chrome.storage.sync.get(['randomSpeakerPresets'], (data) => {
    const presets = (data.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
    renderPresetList(presets);
    const saveBtn = document.getElementById('savePresetBtn') as HTMLButtonElement;
    saveBtn.disabled = presets.length >= MAX_PRESETS;
  });
}

function renderPresetList(presets: RandomSpeakerPreset[]): void {
  const container = document.getElementById('presetList')!;
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
        if (newName) renameRandomPreset(preset.id, newName);
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
    loadBtn.addEventListener('click', () => applyRandomPreset(preset));

    const overwriteBtn = document.createElement('button');
    overwriteBtn.textContent = '上書き';
    overwriteBtn.title = '現在の選択でこのプリセットを更新';
    overwriteBtn.addEventListener('click', () => overwriteRandomPreset(preset.id));

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '複製';
    copyBtn.disabled = presets.length >= MAX_PRESETS;
    copyBtn.addEventListener('click', () => copyRandomPreset(preset));

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => deleteRandomPreset(preset.id));

    actions.appendChild(loadBtn);
    actions.appendChild(overwriteBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(topRow);
    item.appendChild(actions);

    // ドラッグ&ドロップ
    item.addEventListener('dragstart', (e) => {
      dragStartId = preset.id;
      item.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', preset.id);
    });
    item.addEventListener('dragend', () => {
      dragStartId = null;
      item.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      container.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      if (dragStartId !== preset.id) item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragStartId || dragStartId === preset.id) return;
      reorderRandomPreset(dragStartId, preset.id);
    });

    container.appendChild(item);
  }
}

function saveCurrentAsPreset(name: string): void {
  const keys = [
    'randomSpeakerAllowedIds',
    'randomSpeakerAllowedIdsLocal',
    'randomSpeakerAllowedIdsBrowser',
  ];
  chrome.storage.sync.get(keys, (data) => {
    const preset: RandomSpeakerPreset = {
      id: crypto.randomUUID(),
      name,
      allowedIds: {
        voicevox: (data.randomSpeakerAllowedIds as string[] | undefined) ?? null,
        localVoicevox: (data.randomSpeakerAllowedIdsLocal as string[] | undefined) ?? null,
        browser: (data.randomSpeakerAllowedIdsBrowser as string[] | undefined) ?? null,
      },
    };

    const errorEl = document.getElementById('presetError')!;
    const jsonSize = JSON.stringify(preset).length;
    if (jsonSize > 7000) {
      errorEl.textContent = '選択話者数が多すぎます。各エンジンの選択数を減らしてください。';
      errorEl.style.display = 'block';
      return;
    }
    errorEl.style.display = 'none';

    chrome.storage.sync.get(['randomSpeakerPresets'], (d2) => {
      const presets = (d2.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
      if (presets.length >= MAX_PRESETS) {
        errorEl.textContent = `プリセットは最大${MAX_PRESETS}件まで保存できます。`;
        errorEl.style.display = 'block';
        return;
      }
      presets.unshift(preset);
      chrome.storage.sync.set({ randomSpeakerPresets: presets }, () => {
        (document.getElementById('presetNameInput') as HTMLInputElement).value = '';
        loadRandomPresets();
      });
    });
  });
}

function applyRandomPreset(preset: RandomSpeakerPreset): void {
  const storageUpdate: Record<string, string[] | null> = {
    randomSpeakerAllowedIds: preset.allowedIds.voicevox,
    randomSpeakerAllowedIdsLocal: preset.allowedIds.localVoicevox,
    randomSpeakerAllowedIdsBrowser: preset.allowedIds.browser,
  };

  // null値のキーは削除、非null値のキーは設定
  const toSet: Record<string, string[]> = {};
  const toRemove: string[] = [];
  for (const [key, val] of Object.entries(storageUpdate)) {
    if (val === null) {
      toRemove.push(key);
    } else {
      toSet[key] = val;
    }
  }

  const doApply = () => {
    // 現在エンジンの選択状態をUIに反映
    const engineKey =
      currentEngine === 'local-voicevox'
        ? 'randomSpeakerAllowedIdsLocal'
        : currentEngine === 'browser'
          ? 'randomSpeakerAllowedIdsBrowser'
          : 'randomSpeakerAllowedIds';
    const engineAllowedIds = storageUpdate[engineKey];

    if (engineAllowedIds === null) {
      checkedIds = new Set(allSpeakers.map((s) => s.id));
    } else {
      checkedIds = new Set(engineAllowedIds);
    }

    render();

    // background に通知
    chrome.runtime.sendMessage({
      action: 'updateRandomSpeakerAllowedIds',
      ids: engineAllowedIds,
      engine: currentEngine,
    });
  };

  if (toRemove.length > 0) {
    chrome.storage.sync.remove(toRemove, () => {
      if (Object.keys(toSet).length > 0) {
        chrome.storage.sync.set(toSet, doApply);
      } else {
        doApply();
      }
    });
  } else {
    chrome.storage.sync.set(toSet, doApply);
  }
}

function deleteRandomPreset(id: string): void {
  chrome.storage.sync.get(['randomSpeakerPresets'], (data) => {
    const presets = (data.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
    const updated = presets.filter((p) => p.id !== id);
    chrome.storage.sync.set({ randomSpeakerPresets: updated }, () => loadRandomPresets());
  });
}

function copyRandomPreset(preset: RandomSpeakerPreset): void {
  chrome.storage.sync.get(['randomSpeakerPresets'], (data) => {
    const presets = (data.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
    if (presets.length >= MAX_PRESETS) return;
    const copy: RandomSpeakerPreset = {
      ...preset,
      id: crypto.randomUUID(),
      name: `${preset.name}のコピー`,
    };
    presets.unshift(copy);
    chrome.storage.sync.set({ randomSpeakerPresets: presets }, () => loadRandomPresets());
  });
}

function renameRandomPreset(id: string, newName: string): void {
  chrome.storage.sync.get(['randomSpeakerPresets'], (data) => {
    const presets = (data.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
    const idx = presets.findIndex((p) => p.id === id);
    if (idx < 0) return;
    presets[idx] = { ...presets[idx], name: newName };
    chrome.storage.sync.set({ randomSpeakerPresets: presets }, () => loadRandomPresets());
  });
}

function overwriteRandomPreset(id: string): void {
  const keys = [
    'randomSpeakerAllowedIds',
    'randomSpeakerAllowedIdsLocal',
    'randomSpeakerAllowedIdsBrowser',
  ];
  chrome.storage.sync.get(keys, (data) => {
    const newAllowedIds: RandomSpeakerPreset['allowedIds'] = {
      voicevox: (data.randomSpeakerAllowedIds as string[] | undefined) ?? null,
      localVoicevox: (data.randomSpeakerAllowedIdsLocal as string[] | undefined) ?? null,
      browser: (data.randomSpeakerAllowedIdsBrowser as string[] | undefined) ?? null,
    };
    const errorEl = document.getElementById('presetError')!;
    if (JSON.stringify(newAllowedIds).length > 7000) {
      errorEl.textContent = '選択話者数が多すぎます。各エンジンの選択数を減らしてください。';
      errorEl.style.display = 'block';
      return;
    }
    chrome.storage.sync.get(['randomSpeakerPresets'], (d2) => {
      const presets = (d2.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
      const idx = presets.findIndex((p) => p.id === id);
      if (idx < 0) return;
      presets[idx] = { ...presets[idx], allowedIds: newAllowedIds };
      chrome.storage.sync.set({ randomSpeakerPresets: presets }, () => loadRandomPresets());
    });
  });
}

function reorderRandomPreset(fromId: string, toId: string): void {
  chrome.storage.sync.get(['randomSpeakerPresets'], (data) => {
    const presets = (data.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
    const fromIdx = presets.findIndex((p) => p.id === fromId);
    const toIdx = presets.findIndex((p) => p.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = presets.splice(fromIdx, 1);
    presets.splice(toIdx, 0, moved);
    chrome.storage.sync.set({ randomSpeakerPresets: presets }, () => loadRandomPresets());
  });
}

// 保存ボタン
document.getElementById('savePresetBtn')!.addEventListener('click', () => {
  const input = document.getElementById('presetNameInput') as HTMLInputElement;
  const name = input.value.trim();
  const errorEl = document.getElementById('presetError')!;
  if (!name) {
    errorEl.textContent = 'プリセット名を入力してください。';
    errorEl.style.display = 'block';
    return;
  }
  errorEl.style.display = 'none';
  saveCurrentAsPreset(name);
});

// Enterキーで保存（IME確定のEnterは除外）
document.getElementById('presetNameInput')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    document.getElementById('savePresetBtn')!.click();
  }
});

// 初期ロード
loadRandomPresets();

function applyFilters(): void {
  const query = (document.getElementById('searchInput') as HTMLInputElement).value.toLowerCase();
  const selectedStyle = (document.getElementById('styleFilter') as HTMLSelectElement).value;

  const groups = document.querySelectorAll<HTMLElement>('.char-group');
  for (const group of groups) {
    const charName = group.dataset.character || '';
    const items = group.querySelectorAll<HTMLElement>('.style-item');
    let visibleCount = 0;

    for (const item of items) {
      const fullName = (item.dataset.fullName || '').toLowerCase();
      const style = item.dataset.style || '';
      const matchesSearch = !query || fullName.includes(query) || charName.toLowerCase().includes(query);
      const matchesStyle = !selectedStyle || style === selectedStyle;

      if (matchesSearch && matchesStyle) {
        item.classList.remove('hidden');
        visibleCount++;
      } else {
        item.classList.add('hidden');
      }
    }

    if (visibleCount === 0) {
      group.classList.add('hidden');
    } else {
      group.classList.remove('hidden');
    }

    // Update character checkbox state for visible items
    const charCheckbox = group.querySelector<HTMLInputElement>('.char-checkbox');
    if (charCheckbox) {
      const speakers = allSpeakers.filter((s) => s.character === charName);
      updateCharCheckbox(charCheckbox, speakers);
    }
  }
}

