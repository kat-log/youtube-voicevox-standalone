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
import { getDefaultBrowserVoiceNames } from '@/utils/browser-voices';
import { createCachedLimitedLoader, computePortraitLayout } from '@/utils/speaker-icon';

let allSpeakers: ParsedSpeaker[] = [];
let currentEngine: TtsEngine = 'voicevox';
let checkedIds = new Set<string>();
/**
 * 許可リスト未設定（＝保存値なし）のときに選ばれる話者。
 * ブラウザ音声は日本語のみ（なければ全音声）、それ以外は全話者。background の既定候補と一致させる。
 */
let defaultSpeakerIds: string[] = [];
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
/** 話者リストと選択状態の読み込みが完了したか（プリセット一致判定に使う） */
let speakersLoaded = false;
/** 直近に読み込んだプリセット一覧（一致判定・内容表示用） */
let cachedPresets: RandomSpeakerPreset[] = [];
/** 内容を展開中のプリセット ID（再描画しても開閉状態を保つ） */
const openPresetDetails = new Set<string>();

/** アイコン取得の同時リクエスト数（キャラ数ぶん一気にエンジンへ飛ばさない） */
const ICON_FETCH_CONCURRENCY = 3;
/**
 * キャラ名 → アイコン取得に使う speaker_uuid と代表スタイル ID。
 * ローカル VOICEVOX のときだけ埋まる（他エンジンは画像なし）。
 */
let characterIconKeys = new Map<string, { uuid: string; styleId?: number }>();
interface CharacterImages {
  icon?: string;
  portrait?: string;
}
/** speaker_uuid → アイコン・立ち絵 src のローダー（ページ内キャッシュ付き。失敗も null でキャッシュ） */
let loadCharacterIcon: ((uuid: string) => Promise<CharacterImages | null>) | null = null;

function setupIconLoader(host: string): void {
  loadCharacterIcon = createCachedLimitedLoader<CharacterImages>(
    (uuid) =>
      new Promise((resolve) => {
        const key = Array.from(characterIconKeys.values()).find((k) => k.uuid === uuid);
        chrome.runtime.sendMessage(
          { action: 'getLocalSpeakerIcon', host, speakerUuid: uuid, styleId: key?.styleId },
          (response: { status: string; icon?: string; portrait?: string } | undefined) => {
            if (chrome.runtime.lastError || !response || response.status !== 'success') {
              resolve(null);
              return;
            }
            resolve({ icon: response.icon, portrait: response.portrait });
          },
        );
      }),
    ICON_FETCH_CONCURRENCY,
  );
}

/**
 * ヘッダーのキャラ名の左にアイコンを差し込む。取得できなかった場合は何もしない（今まで通りの表示）。
 * 非同期で差し込むため、再描画で古いヘッダーが外れていたら何もしない。
 */
function attachCharacterIcon(header: HTMLElement, nameEl: HTMLElement, charName: string): void {
  const key = characterIconKeys.get(charName);
  if (!key || !loadCharacterIcon) return;
  loadCharacterIcon(key.uuid).then((images) => {
    const src = images?.icon;
    if (!src || !header.isConnected || nameEl.parentElement !== header) return;
    if (header.querySelector('.char-icon')) return;
    const img = document.createElement('img');
    img.className = 'char-icon';
    img.alt = '';
    img.width = 24;
    img.height = 24;
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', () => img.remove());
    img.src = src;
    header.insertBefore(img, nameEl);
  });
}

/** 立ち絵の位置合わせ用。スタイル一覧の高さ（絞り込み・幅変更）が変わるたびに再計算する */
const portraitResizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) layoutPortrait(entry.target as HTMLElement);
});

function layoutPortrait(stylesList: HTMLElement): void {
  const img = stylesList.querySelector<HTMLImageElement>('.char-portrait');
  if (!img || !img.naturalWidth) return;
  const layout = computePortraitLayout(stylesList.clientHeight, img.naturalWidth, img.naturalHeight);
  if (!layout) return;
  img.style.width = `${layout.width}px`;
  img.style.height = `${layout.height}px`;
  img.style.top = `${layout.top}px`;
  img.classList.add('ready');
}

/**
 * 開いたスタイル一覧の背景にキャラの立ち絵を薄く敷く（ローカル VOICEVOX のときだけ）。
 * 立ち絵は大きいので、アコーディオンを初めて開いたときに読み込む。
 */
function attachCharacterPortrait(stylesList: HTMLElement, charName: string): void {
  if (stylesList.dataset.portrait) return;
  const key = characterIconKeys.get(charName);
  if (!key || !loadCharacterIcon) return;
  stylesList.dataset.portrait = 'loading';
  loadCharacterIcon(key.uuid).then((images) => {
    const src = images?.portrait;
    if (!src || !stylesList.isConnected || stylesList.querySelector('.char-portrait')) return;
    const img = document.createElement('img');
    img.className = 'char-portrait';
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.setAttribute('aria-hidden', 'true');
    img.addEventListener('error', () => img.remove());
    img.addEventListener('load', () => {
      layoutPortrait(stylesList);
      portraitResizeObserver.observe(stylesList);
    });
    img.src = src;
    stylesList.prepend(img);
  });
}

// テスト再生結果リスナーを初期化
initTestSpeakResultListener();

function getTestText(): string {
  const input = document.getElementById('testText') as HTMLInputElement;
  const text = input.value.trim();
  if (!text) {
    // 空のまま再生ボタンを押しても無反応にならないよう、入力欄へ誘導する
    input.classList.add('needs-text');
    input.focus();
  }
  return text;
}

document.getElementById('testText')!.addEventListener('input', (e) => {
  (e.target as HTMLInputElement).classList.remove('needs-text');
});

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
  // プリセット表示はエンジン依存のため、エンジン確定後に描画する
  loadRandomPresets();
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
      defaultSpeakerIds = getDefaultBrowserVoiceNames(voices);
      loadAllowedAndRender();
    });
  } else if (currentEngine === 'local-voicevox') {
    chrome.runtime.sendMessage(
      { action: 'getLocalSpeakers', host: localHost },
      (response: {
        status: string;
        speakers?: Array<{ name: string; speaker_uuid?: string; styles: Array<{ id: number; name: string; type?: string }> }>;
        message?: string;
      }) => {
        if (chrome.runtime.lastError || !response || response.status !== 'success' || !response.speakers) {
          showError('ローカル VOICEVOX から話者リストを取得できませんでした。エンジンが起動しているか確認してください。');
          return;
        }
        characterIconKeys = new Map();
        for (const sp of response.speakers) {
          if (!sp.speaker_uuid || characterIconKeys.has(sp.name)) continue;
          const talkStyle = sp.styles.find((st) => !st.type || st.type === 'talk') ?? sp.styles[0];
          characterIconKeys.set(sp.name, { uuid: sp.speaker_uuid, styleId: talkStyle?.id });
        }
        setupIconLoader(localHost);
        allSpeakers = parseLocalSpeakers(response.speakers);
        defaultSpeakerIds = allSpeakers.map((s) => s.id);
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
        defaultSpeakerIds = allSpeakers.map((s) => s.id);
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
      // 未設定 = 既定の候補（ブラウザ音声は日本語のみ、それ以外は全話者）
      checkedIds = new Set(defaultSpeakerIds);
    }
    speakersLoaded = true;
    render();
    // 話者名が判明したのでプリセットの内容表示・一致判定を更新する
    renderPresetList(cachedPresets);
  });
}

function showError(msg: string): void {
  const container = document.getElementById('speakerList')!;
  container.innerHTML = `<div class="error-msg">${msg}</div>`;
}

// --- Render ---
function render(): void {
  const container = document.getElementById('speakerList')!;
  // 再描画（プリセット呼び出し等）でも開いていたグループは開いたままにする
  const openChars = new Set(
    Array.from(container.querySelectorAll<HTMLElement>('.char-group.open')).map((g) => g.dataset.character),
  );
  container.innerHTML = '';

  const groups = groupByCharacter(allSpeakers);
  const styles = getUniqueStyles(allSpeakers);

  // Style filter dropdown
  const styleFilter = document.getElementById('styleFilter') as HTMLSelectElement;
  const prevStyle = styleFilter.value;
  styleFilter.innerHTML = '<option value="">全スタイル</option>';
  for (const style of styles) {
    const opt = document.createElement('option');
    opt.value = style;
    opt.textContent = style;
    styleFilter.appendChild(opt);
  }
  if (styles.includes(prevStyle)) styleFilter.value = prevStyle;

  // Render character groups
  for (const [charName, speakers] of groups) {
    const group = document.createElement('div');
    group.className = openChars.has(charName) ? 'char-group open' : 'char-group';
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
    attachCharacterIcon(header, name, charName);

    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('char-checkbox')) return;
      group.classList.toggle('open');
      if (group.classList.contains('open')) attachCharacterPortrait(stylesList, charName);
      updateExpandToggleLabel();
    });

    // Styles list
    const stylesList = document.createElement('div');
    stylesList.className = 'char-styles';
    if (group.classList.contains('open')) attachCharacterPortrait(stylesList, charName);

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
      playBtn.textContent = '\u25B6 試聴';
      playBtn.title = `「テスト再生テキスト」を${speaker.style || speaker.fullName}の声で読み上げ`;

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

  // 検索・スタイル絞り込みを再描画後も維持する
  applyFilters();
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
  updateSelectToggleLabel();
  updatePresetActiveState();
}

function autoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    // 既定の候補とまったく同じ選択なら「未設定」として保存する
    const isDefault =
      checkedIds.size === defaultSpeakerIds.length &&
      defaultSpeakerIds.every((id) => checkedIds.has(id));
    const ids = isDefault ? null : Array.from(checkedIds);

    chrome.runtime.sendMessage({
      action: 'updateRandomSpeakerAllowedIds',
      ids,
      engine: currentEngine,
    });
  }, 300);
}

// --- Select All / Deselect All (toggle) ---
/** 表示中の話者がすべて選択済みか */
function areAllVisibleChecked(): boolean {
  const visible = getVisibleStyleCheckboxes();
  return visible.length > 0 && visible.every((cb) => cb.checked);
}

function updateSelectToggleLabel(): void {
  const btn = document.getElementById('toggleSelectBtn');
  if (!btn) return;
  btn.textContent = areAllVisibleChecked() ? 'すべて解除' : 'すべて選択';
}

document.getElementById('toggleSelectBtn')!.addEventListener('click', () => {
  const next = !areAllVisibleChecked();
  for (const cb of getVisibleStyleCheckboxes()) {
    cb.checked = next;
    updateCheckedId(cb.dataset.id!, next);
  }
  refreshAllCharCheckboxes();
  updateSelectToggleLabel();
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

// --- Expand / Collapse all (toggle) ---
function getVisibleGroups(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.char-group:not(.hidden)'));
}

/** 表示中のグループがすべて開いているか */
function areAllVisibleOpen(): boolean {
  const groups = getVisibleGroups();
  return groups.length > 0 && groups.every((g) => g.classList.contains('open'));
}

function updateExpandToggleLabel(): void {
  const btn = document.getElementById('toggleExpandBtn');
  if (!btn) return;
  btn.textContent = areAllVisibleOpen() ? 'すべて閉じる' : 'すべて開く';
}

document.getElementById('toggleExpandBtn')!.addEventListener('click', () => {
  if (areAllVisibleOpen()) {
    document.querySelectorAll<HTMLElement>('.char-group').forEach((g) => g.classList.remove('open'));
  } else {
    getVisibleGroups().forEach((g) => {
      g.classList.add('open');
      const stylesList = g.querySelector<HTMLElement>('.char-styles');
      if (stylesList && g.dataset.character) attachCharacterPortrait(stylesList, g.dataset.character);
    });
  }
  updateExpandToggleLabel();
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

const ENGINE_LABELS: Record<TtsEngine, string> = {
  voicevox: 'VOICEVOX（Web API）',
  'local-voicevox': 'ローカル VOICEVOX',
  browser: 'ブラウザ内蔵音声',
};

const ENGINE_STORAGE_KEYS: Record<TtsEngine, string> = {
  voicevox: 'randomSpeakerAllowedIds',
  'local-voicevox': 'randomSpeakerAllowedIdsLocal',
  browser: 'randomSpeakerAllowedIdsBrowser',
};

function getPresetIdsForEngine(preset: RandomSpeakerPreset, engine: TtsEngine): string[] | null {
  if (engine === 'voicevox') return preset.allowedIds.voicevox;
  if (engine === 'local-voicevox') return preset.allowedIds.localVoicevox;
  return preset.allowedIds.browser;
}

function buildAllowedIdsForEngine(
  engine: TtsEngine,
  ids: string[] | null,
): RandomSpeakerPreset['allowedIds'] {
  return {
    voicevox: engine === 'voicevox' ? ids : null,
    localVoicevox: engine === 'local-voicevox' ? ids : null,
    browser: engine === 'browser' ? ids : null,
  };
}

/**
 * プリセットが指定エンジンで使えるか。
 * engine 付き（新形式）はそのエンジンのみ。
 * 旧形式は全エンジン分をまとめて保存していたため、null（未設定と区別不能）でない
 * 選択を持つエンジンのみ対象とする。全エンジン null の場合は「全話者」として全エンジンで可。
 */
function isPresetApplicable(preset: RandomSpeakerPreset, engine: TtsEngine): boolean {
  if (preset.engine) return preset.engine === engine;
  const { voicevox, localVoicevox, browser } = preset.allowedIds;
  if (voicevox === null && localVoicevox === null && browser === null) return true;
  return getPresetIdsForEngine(preset, engine) !== null;
}

/** 非対応プリセットの表示用に、保存元エンジン名を返す */
function getPresetEngineLabel(preset: RandomSpeakerPreset): string {
  if (preset.engine) return ENGINE_LABELS[preset.engine];
  const engines = (Object.keys(ENGINE_LABELS) as TtsEngine[]).filter(
    (e) => getPresetIdsForEngine(preset, e) !== null,
  );
  return engines.map((e) => ENGINE_LABELS[e]).join('・');
}

function getPresetSpeakerCountText(preset: RandomSpeakerPreset): string {
  if (!isPresetApplicable(preset, currentEngine)) {
    return `${getPresetEngineLabel(preset)}用（現在のエンジンでは使えません）`;
  }
  const ids = getPresetIdsForEngine(preset, currentEngine);
  const unit = currentEngine === 'browser' ? '音声' : '話者';
  if (ids === null) return currentEngine === 'browser' ? '日本語の全音声' : `全${unit}`;
  return `${ids.length}${unit}を選択`;
}

/** プリセットが現在のエンジンで選ぶ話者 ID 一覧（null = 既定の候補） */
function getEffectivePresetIds(preset: RandomSpeakerPreset): string[] {
  return getPresetIdsForEngine(preset, currentEngine) ?? defaultSpeakerIds;
}

/** 現在の選択状態がプリセットと完全に一致するか */
function isPresetActive(preset: RandomSpeakerPreset): boolean {
  if (!speakersLoaded || !isPresetApplicable(preset, currentEngine)) return false;
  const ids = new Set(getEffectivePresetIds(preset));
  return ids.size === checkedIds.size && [...ids].every((id) => checkedIds.has(id));
}

/** プリセット一覧の「適用中」表示と、左ペインの適用中プリセット表示を更新する */
function updatePresetActiveState(): void {
  const activeNames: string[] = [];
  for (const preset of cachedPresets) {
    const active = isPresetActive(preset);
    if (active) activeNames.push(preset.name);
    const item = document.querySelector<HTMLElement>(
      `.preset-item[data-preset-id="${CSS.escape(preset.id)}"]`,
    );
    if (!item) continue;
    item.classList.toggle('active', active);
    const badge = item.querySelector<HTMLElement>('.preset-active-badge');
    if (badge) badge.style.display = active ? '' : 'none';
  }

  const el = document.getElementById('appliedPreset');
  if (!el) return;
  if (!speakersLoaded) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  if (activeNames.length > 0) {
    const text = `適用中: ${activeNames.map((n) => `「${n}」`).join('・')}`;
    el.textContent = text;
    el.title = text;
    el.classList.add('active');
  } else {
    el.textContent = 'プリセット未適用（カスタム選択）';
    el.title = 'どのお気に入りプリセットとも一致していません';
    el.classList.remove('active');
  }
}

/** プリセットの内容（キャラクターごとのスタイル一覧）を表示する要素を作る */
function createPresetDetail(preset: RandomSpeakerPreset): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'preset-detail';
  details.open = openPresetDetails.has(preset.id);
  details.addEventListener('toggle', () => {
    if (details.open) openPresetDetails.add(preset.id);
    else openPresetDetails.delete(preset.id);
  });

  const summary = document.createElement('summary');
  summary.textContent = '内容を見る';
  details.appendChild(summary);

  const list = document.createElement('ul');
  list.className = 'preset-detail-list';

  if (!speakersLoaded) {
    const li = document.createElement('li');
    li.textContent = '話者リストを取得中...';
    list.appendChild(li);
    details.appendChild(list);
    return details;
  }

  const ids = new Set(getEffectivePresetIds(preset));
  const selected = allSpeakers.filter((s) => ids.has(s.id));
  const knownIds = new Set(allSpeakers.map((s) => s.id));
  const unknownIds = [...ids].filter((id) => !knownIds.has(id));

  if (selected.length === 0 && unknownIds.length === 0) {
    const li = document.createElement('li');
    li.textContent = '（話者が選択されていません）';
    list.appendChild(li);
  }

  for (const [charName, speakers] of groupByCharacter(selected)) {
    const li = document.createElement('li');
    const charEl = document.createElement('span');
    charEl.className = 'preset-detail-char';
    charEl.textContent = charName;
    li.appendChild(charEl);
    const styleNames = speakers.map((s) => s.style).filter(Boolean);
    if (styleNames.length > 0) {
      const stylesEl = document.createElement('span');
      stylesEl.className = 'preset-detail-styles';
      stylesEl.textContent = `: ${styleNames.join('、')}`;
      li.appendChild(stylesEl);
    } else if (currentEngine === 'browser') {
      const stylesEl = document.createElement('span');
      stylesEl.className = 'preset-detail-styles';
      stylesEl.textContent = `: ${speakers.map((s) => s.fullName).join('、')}`;
      li.appendChild(stylesEl);
    }
    list.appendChild(li);
  }

  if (unknownIds.length > 0) {
    const li = document.createElement('li');
    li.className = 'preset-detail-styles';
    li.textContent = `現在の話者一覧にない ID: ${unknownIds.join(', ')}`;
    list.appendChild(li);
  }

  details.appendChild(list);
  return details;
}
let dragStartId: string | null = null;

function loadRandomPresets(): void {
  chrome.storage.sync.get(['randomSpeakerPresets'], (data) => {
    const presets = (data.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
    cachedPresets = presets;
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
    updatePresetActiveState();
    return;
  }

  for (const preset of presets) {
    const applicable = isPresetApplicable(preset, currentEngine);
    const item = document.createElement('div');
    item.className = applicable ? 'preset-item' : 'preset-item inapplicable';
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
        topRow.insertBefore(nameEl, activeBadge);
        topRow.appendChild(renameBtn);
      };

      confirmBtn.addEventListener('click', doConfirm);
      cancelBtn.addEventListener('click', doCancel);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) doConfirm();
        if (e.key === 'Escape') doCancel();
      });

      topRow.insertBefore(input, activeBadge);
      topRow.appendChild(confirmBtn);
      topRow.appendChild(cancelBtn);
      input.focus();
      input.select();
    });

    const activeBadge = document.createElement('span');
    activeBadge.className = 'preset-active-badge';
    activeBadge.textContent = '適用中';
    activeBadge.title = '現在の選択状態がこのプリセットと一致しています';
    activeBadge.style.display = 'none';

    topRow.appendChild(handle);
    topRow.appendChild(nameEl);
    topRow.appendChild(activeBadge);
    topRow.appendChild(renameBtn);

    // 下段: アクションボタン
    const actions = document.createElement('div');
    actions.className = 'preset-item-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'preset-load-btn';
    loadBtn.textContent = '呼び出す';
    loadBtn.title = applicable
      ? 'このプリセットの設定を読み込む'
      : '別のエンジン用のプリセットのため呼び出せません';
    loadBtn.disabled = !applicable;
    loadBtn.addEventListener('click', () => applyRandomPreset(preset));

    const overwriteBtn = document.createElement('button');
    overwriteBtn.textContent = '上書き';
    overwriteBtn.title = applicable
      ? '現在の選択でこのプリセットを更新'
      : '別のエンジン用のプリセットのため上書きできません';
    overwriteBtn.disabled = !applicable;
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

    const metaEl = document.createElement('div');
    metaEl.className = 'preset-item-meta';
    metaEl.textContent = getPresetSpeakerCountText(preset);

    item.appendChild(topRow);
    item.appendChild(metaEl);
    if (applicable) item.appendChild(createPresetDetail(preset));
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
  updatePresetActiveState();
}

function saveCurrentAsPreset(name: string): void {
  const engine = currentEngine;
  const key = ENGINE_STORAGE_KEYS[engine];
  chrome.storage.sync.get([key], (data) => {
    const preset: RandomSpeakerPreset = {
      id: crypto.randomUUID(),
      name,
      engine,
      allowedIds: buildAllowedIdsForEngine(engine, (data[key] as string[] | undefined) ?? null),
    };

    const errorEl = document.getElementById('presetError')!;
    const jsonSize = JSON.stringify(preset).length;
    if (jsonSize > 7000) {
      errorEl.textContent = '選択話者数が多すぎます。選択数を減らしてください。';
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
  // 現在エンジンの分だけを反映する（他エンジンの選択状態には触れない）
  if (!isPresetApplicable(preset, currentEngine)) return;
  const engine = currentEngine;
  const key = ENGINE_STORAGE_KEYS[engine];
  const engineAllowedIds = getPresetIdsForEngine(preset, engine);

  const doApply = () => {
    if (engineAllowedIds === null) {
      checkedIds = new Set(defaultSpeakerIds);
    } else {
      checkedIds = new Set(engineAllowedIds);
    }

    render();

    // background に通知
    chrome.runtime.sendMessage({
      action: 'updateRandomSpeakerAllowedIds',
      ids: engineAllowedIds,
      engine,
    });
  };

  if (engineAllowedIds === null) {
    chrome.storage.sync.remove(key, doApply);
  } else {
    chrome.storage.sync.set({ [key]: engineAllowedIds }, doApply);
  }
}

// --- Undo (上書き・削除の取り消し) ---
const UNDO_TIMEOUT_MS = 10000;
let pendingUndo: (() => void) | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;

function hideUndoBar(): void {
  pendingUndo = null;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = null;
  document.getElementById('presetUndoBar')!.hidden = true;
}

/** 実行直後に「元に戻す」バーを表示する。一定時間で自動的に消える */
function showUndoBar(message: string, undo: () => void): void {
  pendingUndo = undo;
  document.getElementById('presetUndoMessage')!.textContent = message;
  document.getElementById('presetUndoMessage')!.title = message;
  document.getElementById('presetUndoBar')!.hidden = false;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndoBar, UNDO_TIMEOUT_MS);
}

document.getElementById('presetUndoBtn')!.addEventListener('click', () => {
  const undo = pendingUndo;
  hideUndoBar();
  undo?.();
});
document.getElementById('presetUndoCloseBtn')!.addEventListener('click', hideUndoBar);

/** 削除したプリセットを元の位置に戻す */
function restoreDeletedPreset(preset: RandomSpeakerPreset, index: number): void {
  chrome.storage.sync.get(['randomSpeakerPresets'], (data) => {
    const presets = (data.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
    if (presets.some((p) => p.id === preset.id)) return;
    const errorEl = document.getElementById('presetError')!;
    if (presets.length >= MAX_PRESETS) {
      errorEl.textContent = `プリセットが${MAX_PRESETS}件あるため元に戻せません。`;
      errorEl.style.display = 'block';
      return;
    }
    errorEl.style.display = 'none';
    presets.splice(Math.min(index, presets.length), 0, preset);
    chrome.storage.sync.set({ randomSpeakerPresets: presets }, () => loadRandomPresets());
  });
}

/** 上書き前の内容に戻す（名前・並び順など他の変更はそのまま） */
function restoreOverwrittenPreset(previous: RandomSpeakerPreset): void {
  chrome.storage.sync.get(['randomSpeakerPresets'], (data) => {
    const presets = (data.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
    const idx = presets.findIndex((p) => p.id === previous.id);
    if (idx < 0) return;
    presets[idx] = { ...presets[idx], engine: previous.engine, allowedIds: previous.allowedIds };
    chrome.storage.sync.set({ randomSpeakerPresets: presets }, () => loadRandomPresets());
  });
}

function deleteRandomPreset(id: string): void {
  chrome.storage.sync.get(['randomSpeakerPresets'], (data) => {
    const presets = (data.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
    const index = presets.findIndex((p) => p.id === id);
    if (index < 0) return;
    const removed = presets[index];
    const updated = presets.filter((p) => p.id !== id);
    chrome.storage.sync.set({ randomSpeakerPresets: updated }, () => {
      loadRandomPresets();
      showUndoBar(`「${removed.name}」を削除しました`, () => restoreDeletedPreset(removed, index));
    });
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
  const engine = currentEngine;
  const key = ENGINE_STORAGE_KEYS[engine];
  chrome.storage.sync.get([key], (data) => {
    const newAllowedIds = buildAllowedIdsForEngine(
      engine,
      (data[key] as string[] | undefined) ?? null,
    );
    const errorEl = document.getElementById('presetError')!;
    if (JSON.stringify(newAllowedIds).length > 7000) {
      errorEl.textContent = '選択話者数が多すぎます。選択数を減らしてください。';
      errorEl.style.display = 'block';
      return;
    }
    chrome.storage.sync.get(['randomSpeakerPresets'], (d2) => {
      const presets = (d2.randomSpeakerPresets as RandomSpeakerPreset[] | undefined) ?? [];
      const idx = presets.findIndex((p) => p.id === id);
      if (idx < 0) return;
      const previous = presets[idx];
      presets[idx] = { ...previous, engine, allowedIds: newAllowedIds };
      chrome.storage.sync.set({ randomSpeakerPresets: presets }, () => {
        loadRandomPresets();
        showUndoBar(`「${previous.name}」を上書きしました`, () =>
          restoreOverwrittenPreset(previous),
        );
      });
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
  updateSelectToggleLabel();
  updateExpandToggleLabel();
}

// --- Resizable panel ---
const PANEL_WIDTH_KEY = 'randomSpeakerPanelWidth';
const PANEL_WIDTH_DEFAULT = 384;

(function initResizer(): void {
  const resizer = document.getElementById('layoutResizer') as HTMLElement;
  const presetPanel = document.getElementById('randomPresetSection') as HTMLElement;

  chrome.storage.sync.get([PANEL_WIDTH_KEY], (data) => {
    const width = (data[PANEL_WIDTH_KEY] as number | undefined) ?? PANEL_WIDTH_DEFAULT;
    presetPanel.style.width = `${width}px`;
  });

  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startWidth = presetPanel.getBoundingClientRect().width;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const dx = startX - ev.clientX;
      const newWidth = Math.max(180, Math.min(600, startWidth + dx));
      presetPanel.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const finalWidth = Math.round(presetPanel.getBoundingClientRect().width);
      chrome.storage.sync.set({ [PANEL_WIDTH_KEY]: finalWidth });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

