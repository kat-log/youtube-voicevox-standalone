import '../styles/styles.scss';
import type { TtsEngine } from '@/types/state';
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

