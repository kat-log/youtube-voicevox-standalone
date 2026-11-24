import '../styles/styles.scss';
import type { TtsEngine, ParallelSpeakersConfig, RoundRobinPreset } from '@/types/state';
import { RANDOM_SPEAKER_SENTINEL } from '@/types/state';
import { initTestSpeakResultListener } from '@/utils/test-speak-ui';
import {
  getSpeakerIdsForEngine,
  withSpeakerIdsForEngine,
  isRoundRobinPresetApplicable,
  isRoundRobinSupportedEngine,
  isRoundRobinPresetActive,
} from '@/utils/round-robin';
import { createCachedLimitedLoader } from '@/utils/speaker-icon';

interface SpeakerOption {
  value: string;
  label: string;
  /** ローカル VOICEVOX のキャラ名（optgroup 用） */
  group?: string;
}

let speakerOptions: SpeakerOption[] = [];
let currentEngine: TtsEngine = 'voicevox';
let savedSpeakerIds: string[] = []; // 現在のエンジン用の持ち回り話者ID（話者2以降）
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
/** 話者リストの取得が完了したか（プリセットの内容表示に使う） */
let speakersLoaded = false;
/** 直近に読み込んだプリセット一覧（適用中の判定に使う） */
let cachedPresets: RoundRobinPreset[] = [];
/** 内容を展開中のプリセット ID（再描画しても開閉状態を保つ） */
const openPresetDetails = new Set<string>();
/** 話者1（メインの話者）の現在値。メインの話者設定と同じ storage キーを読み書きする */
let mainSpeakerId = '';

/**
 * ブラウザ内蔵音声は並列再生できず、持ち回り話者も読み上げに使われないため、このページの設定は効かない。
 * 保存済みの設定（VOICEVOX 用）を誤って上書きしないよう、閲覧のみにする。
 */
function isUnsupportedEngine(): boolean {
  return !isRoundRobinSupportedEngine(currentEngine);
}

/** メインの話者の保存先（ポップアップの話者選択と同じキー） */
function getMainSpeakerKey(): 'speakerId' | 'localSpeakerId' {
  return currentEngine === 'local-voicevox' ? 'localSpeakerId' : 'speakerId';
}

const ENGINE_LABELS: Record<TtsEngine, string> = {
  voicevox: 'VOICEVOX（Web API）',
  'local-voicevox': 'ローカル VOICEVOX',
  browser: 'ブラウザ内蔵音声',
};

const DEFAULT_PSC: ParallelSpeakersConfig = {
  enabled: false,
  speakerIds: [],
  roundRobinSpeakerCount: 3,
};

function applyUnsupportedEngineUI(): void {
  document.getElementById('browser-unsupported-note')!.style.display = 'block';
  document.getElementById('speaker-assignments')!.style.display = 'none';
  document.getElementById('test-text-form')!.style.display = 'none';
  const countSlider = document.getElementById('speakerCount') as HTMLInputElement;
  countSlider.disabled = true;
  (document.getElementById('rrPresetNameInput') as HTMLInputElement).disabled = true;
  (document.getElementById('rrSavePresetBtn') as HTMLButtonElement).disabled = true;
}

// テスト再生結果リスナーを初期化
initTestSpeakResultListener();

function getTestText(): string {
  const input = document.getElementById('testText') as HTMLInputElement;
  const text = input.value.trim();
  if (!text) {
    // 空のまま試聴を押しても無反応にならないよう、入力欄へ誘導する
    input.classList.add('needs-text');
    input.focus();
  }
  return text;
}

document.getElementById('testText')!.addEventListener('input', (e) => {
  (e.target as HTMLInputElement).classList.remove('needs-text');
});

// --- Character icons (ローカル VOICEVOX のみ。画像は同梱せず実行時に取得) ---
const ICON_FETCH_CONCURRENCY = 3;
/** スタイル ID → speaker_uuid（ローカル VOICEVOX のときだけ埋まる） */
let styleToUuid = new Map<string, string>();
/** `${uuid}|${styleId}` → アイコン src のローダー（失敗も null でキャッシュ） */
let loadStyleIcon: ((key: string) => Promise<string | null>) | null = null;

function setupIconLoader(host: string): void {
  loadStyleIcon = createCachedLimitedLoader<string>(
    (key) =>
      new Promise((resolve) => {
        const [uuid, styleId] = key.split('|');
        chrome.runtime.sendMessage(
          { action: 'getLocalSpeakerIcon', host, speakerUuid: uuid, styleId: Number(styleId) },
          (response: { status: string; icon?: string } | undefined) => {
            if (chrome.runtime.lastError || !response || response.status !== 'success') {
              resolve(null);
              return;
            }
            resolve(response.icon ?? null);
          },
        );
      }),
    ICON_FETCH_CONCURRENCY,
  );
}

/** 選択中のスタイルのアイコンを表示する。取得できなければ空のまま（従来どおりの表示） */
function updateRowIcon(slot: HTMLElement, value: string): void {
  slot.dataset.value = value;
  slot.innerHTML = '';
  const uuid = styleToUuid.get(value);
  if (!uuid || !loadStyleIcon) return;
  loadStyleIcon(`${uuid}|${value}`).then((src) => {
    // 取得中に選択が変わった・行が作り直された場合は差し込まない
    if (!src || !slot.isConnected || slot.dataset.value !== value) return;
    const img = document.createElement('img');
    img.className = 'char-icon';
    img.alt = '';
    img.width = 28;
    img.height = 28;
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', () => img.remove());
    img.src = src;
    slot.appendChild(img);
  });
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
  ['ttsEngine', 'localVoicevoxHost', 'parallelSpeakersConfig', 'randomSpeakerEnabled', 'speakerId', 'localSpeakerId'],
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
    // Web API とローカルでは話者IDの体系が異なる場合があるため、現在のエンジン用の値を使う
    savedSpeakerIds = getSpeakerIdsForEngine(psc, currentEngine);

    const stored = data[getMainSpeakerKey()];
    mainSpeakerId = typeof stored === 'string' && stored !== RANDOM_SPEAKER_SENTINEL ? stored : '';

    const countSlider = document.getElementById('speakerCount') as HTMLInputElement;
    countSlider.value = String(psc.roundRobinSpeakerCount);
    document.getElementById('current-count')!.textContent = String(psc.roundRobinSpeakerCount);
    countSlider.setAttribute('aria-valuetext', String(psc.roundRobinSpeakerCount));

    // プリセット一覧は「使えるか」がエンジン依存のため、エンジン確定後に描画する
    loadRoundRobinPresets();

    if (isUnsupportedEngine()) {
      applyUnsupportedEngineUI();
      return;
    }

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

    initMainSpeakerSync();
    fetchSpeakers(host);
  }
);

/**
 * ポップアップ（別タブで開いている場合を含む）でメインの話者が変わったら話者1に反映する。
 */
function initMainSpeakerSync(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    const change = changes[getMainSpeakerKey()];
    if (!change) return;
    const value = change.newValue;
    if (typeof value !== 'string' || value === RANDOM_SPEAKER_SENTINEL || value === mainSpeakerId) return;
    mainSpeakerId = value;
    const select = document.getElementById('mainSpeakerSelect') as HTMLSelectElement | null;
    if (!select) return;
    setSelectValue(select, value);
    const slot = select.closest('.speaker-row')?.querySelector<HTMLElement>('.char-icon-slot');
    if (slot) updateRowIcon(slot, value);
    syncPlayButton(select);
  });
}

function fetchSpeakers(localHost: string): void {
  const onFailed = (message: string) => {
    document.getElementById('speaker-list')!.innerHTML =
      `<p class="info-text" style="color: var(--error-color)">${message}</p>`;
  };

  if (currentEngine === 'local-voicevox') {
    chrome.runtime.sendMessage(
      { action: 'getLocalSpeakers', host: localHost },
      (response: {
        status: string;
        speakers?: Array<{ name: string; speaker_uuid?: string; styles: Array<{ id: number; name: string }> }>;
      }) => {
        if (chrome.runtime.lastError || !response || response.status !== 'success' || !response.speakers) {
          onFailed('ローカル VOICEVOX から話者リストを取得できませんでした。');
          return;
        }
        speakerOptions = [];
        styleToUuid = new Map();
        for (const speaker of response.speakers) {
          for (const style of speaker.styles) {
            speakerOptions.push({
              value: String(style.id),
              label: `${speaker.name} (${style.name})`,
              group: speaker.name,
            });
            if (speaker.speaker_uuid) styleToUuid.set(String(style.id), speaker.speaker_uuid);
          }
        }
        setupIconLoader(localHost);
        // ポップアップと同じく、未保存時は先頭の話者をメインの話者として保存する
        if (!mainSpeakerId && speakerOptions.length > 0) {
          mainSpeakerId = speakerOptions[0].value;
          chrome.storage.sync.set({ localSpeakerId: mainSpeakerId });
        }
        onSpeakersLoaded();
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
        // ポップアップと同じ既定値
        if (!mainSpeakerId) mainSpeakerId = '1';
        onSpeakersLoaded();
      })
      .catch(() => onFailed('話者リストの取得に失敗しました。'));
  }
}

function onSpeakersLoaded(): void {
  speakersLoaded = true;
  renderDropdowns();
  // プリセットの内容表示に話者名が必要なため作り直す
  renderRoundRobinPresetList(cachedPresets);
}

/** 選択肢を作る（ローカル VOICEVOX はキャラごとの optgroup にまとめる） */
function buildOptions(select: HTMLSelectElement, includeRandom: boolean): void {
  let group: HTMLOptGroupElement | null = null;
  for (const opt of speakerOptions) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.group) {
      if (!group || group.label !== opt.group) {
        group = document.createElement('optgroup');
        group.label = opt.group;
        select.appendChild(group);
      }
      group.appendChild(option);
    } else {
      select.appendChild(option);
    }
  }
  if (includeRandom) {
    const randomOption = document.createElement('option');
    randomOption.value = RANDOM_SPEAKER_SENTINEL;
    randomOption.textContent = 'ランダム';
    select.appendChild(randomOption);
  }
}

/**
 * 値を選択する。一覧にない ID（エンジンの話者が変わった等）は先頭の話者にすり替わって見えないよう、
 * その ID の選択肢を足して表示する。
 */
function setSelectValue(select: HTMLSelectElement, value: string): void {
  if (!value) return;
  if (!Array.from(select.options).some((o) => o.value === value)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `ID ${value}（一覧にない話者）`;
    select.insertBefore(option, select.firstChild);
  }
  select.value = value;
}

function getSpeakerLabel(id: string | undefined): string {
  if (!id) return '（未設定）';
  if (id === RANDOM_SPEAKER_SENTINEL) return 'ランダム';
  return speakerOptions.find((o) => o.value === id)?.label ?? `ID ${id}（一覧にない話者）`;
}

/** 試聴ボタンの状態・対象話者を選択値に合わせる */
function syncPlayButton(select: HTMLSelectElement): void {
  const row = select.closest('.speaker-row');
  const playBtn = row?.querySelector<HTMLButtonElement>('.play-btn');
  const playStatus = row?.querySelector<HTMLElement>('.play-status');
  if (!playBtn || !playStatus) return;
  const isRandom = select.value === RANDOM_SPEAKER_SENTINEL;
  playBtn.disabled = isRandom;
  playBtn.title = isRandom
    ? 'ランダムは試聴できません'
    : `「${getSpeakerLabel(select.value)}」の声でテスト再生テキストを読み上げます`;
  // data-speaker-id を更新して結果を正しく受信できるようにする
  playBtn.dataset.speakerId = select.value;
  playStatus.dataset.speakerId = select.value;
  playStatus.textContent = '';
}

function createSpeakerRow(params: {
  labelText: string;
  value: string;
  includeRandom: boolean;
  onChange: (select: HTMLSelectElement) => void;
}): { row: HTMLDivElement; select: HTMLSelectElement } {
  const row = document.createElement('div');
  row.className = 'speaker-row';

  const label = document.createElement('label');
  label.textContent = params.labelText;

  const iconSlot = document.createElement('span');
  iconSlot.className = 'char-icon-slot';
  // アイコンが出るのはローカル VOICEVOX のみ。他エンジンでは枠ごと詰める
  if (currentEngine !== 'local-voicevox') iconSlot.hidden = true;

  const select = document.createElement('select');
  select.setAttribute('aria-label', `${params.labelText.replace(/:$/, '')}の選択`);
  buildOptions(select, params.includeRandom);
  setSelectValue(select, params.value);

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'play-btn';
  playBtn.textContent = '▶ 試聴';
  playBtn.addEventListener('click', () => {
    const selectedId = select.value;
    if (selectedId === RANDOM_SPEAKER_SENTINEL) return;
    const text = getTestText();
    if (!text) return;
    playBtn.disabled = true;
    chrome.runtime.sendMessage({ action: 'testSpeak', text, speakerId: selectedId });
  });

  const playStatus = document.createElement('span');
  playStatus.className = 'play-status';

  select.addEventListener('change', () => {
    updateRowIcon(iconSlot, select.value);
    syncPlayButton(select);
    params.onChange(select);
  });

  row.appendChild(label);
  row.appendChild(iconSlot);
  row.appendChild(select);
  row.appendChild(playBtn);
  row.appendChild(playStatus);

  syncPlayButton(select);
  updateRowIcon(iconSlot, select.value);
  return { row, select };
}

function renderDropdowns(): void {
  if (!speakersLoaded) return;
  const container = document.getElementById('speaker-list')!;
  container.innerHTML = '';

  // 話者1: メインの話者（ポップアップの話者選択と同じ設定を読み書きする）
  const main = createSpeakerRow({
    labelText: '話者1:',
    value: mainSpeakerId,
    includeRandom: false,
    onChange: (select) => {
      mainSpeakerId = select.value;
      chrome.storage.sync.set({ [getMainSpeakerKey()]: select.value });
      // ポップアップで話者を変えたときと同様に、生成待ちキューの話者も切り替える
      chrome.runtime.sendMessage({ action: 'updateSpeaker', speakerId: select.value });
    },
  });
  main.select.id = 'mainSpeakerSelect';
  main.row.classList.add('main-speaker-row');
  const badge = document.createElement('span');
  badge.className = 'main-speaker-badge';
  badge.textContent = 'メイン';
  badge.title = 'メインの話者設定と共通です。ここで変えるとポップアップの話者も変わります';
  main.row.querySelector('label')!.appendChild(badge);
  container.appendChild(main.row);

  const count = parseInt(
    (document.getElementById('speakerCount') as HTMLInputElement).value,
    10
  );
  const dropdownCount = Math.max(0, count - 1);

  for (let i = 0; i < dropdownCount; i++) {
    const { row, select } = createSpeakerRow({
      labelText: `話者${i + 2}:`,
      value: savedSpeakerIds[i] ?? '',
      includeRandom: true,
      onChange: () => {
        autoSave();
        updatePresetActiveState();
      },
    });
    select.dataset.index = String(i);
    container.appendChild(row);
  }
  updatePresetActiveState();
}

/** 話者2以降の現在の選択（未描画なら保存値） */
function getCurrentRoundRobinIds(): string[] {
  if (!speakersLoaded) return savedSpeakerIds.slice(0, Math.max(0, getCurrentCount() - 1));
  const selects = document.querySelectorAll<HTMLSelectElement>('#speaker-list select[data-index]');
  return Array.from(selects, (sel) => sel.value);
}

function getCurrentCount(): number {
  return parseInt((document.getElementById('speakerCount') as HTMLInputElement).value, 10);
}

function autoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    const roundRobinSpeakerCount = getCurrentCount();
    const speakerIds = getCurrentRoundRobinIds();

    // 有効/無効（ポップアップで切り替える）と他エンジンの話者は最新の保存値を引き継ぐ
    chrome.storage.sync.get(['parallelSpeakersConfig'], (data) => {
      const base: ParallelSpeakersConfig = { ...DEFAULT_PSC, ...data.parallelSpeakersConfig };
      const config = withSpeakerIdsForEngine(
        { ...base, roundRobinSpeakerCount },
        currentEngine,
        speakerIds,
      );

      chrome.runtime.sendMessage(
        {
          action: 'updateParallelSpeakersConfig',
          parallelSpeakersConfig: config,
        },
        () => {
          // 話者数を減らした分の選択は、増やし直したときのためにページ内で覚えておく
          savedSpeakerIds = speakerIds.concat(savedSpeakerIds.slice(speakerIds.length));
        }
      );
    });
  }, 300);
}

// --- Slider change ---
const countSlider = document.getElementById('speakerCount') as HTMLInputElement;
countSlider.addEventListener('input', () => {
  const val = parseInt(countSlider.value, 10);
  document.getElementById('current-count')!.textContent = String(val);
  countSlider.setAttribute('aria-valuetext', String(val));
  // 話者数を減らして増やし直しても選択が消えないよう、描画前に現在の選択を控えておく
  if (speakersLoaded) {
    const current = getCurrentRoundRobinIds();
    savedSpeakerIds = current.concat(savedSpeakerIds.slice(current.length));
  }
  renderDropdowns();
  updatePresetActiveState();
  autoSave();
});

// --- Round-robin preset management ---
const RR_MAX_PRESETS = 10;
let rrDragStartId: string | null = null;

function loadRoundRobinPresets(): void {
  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    cachedPresets = presets;
    renderRoundRobinPresetList(presets);
    const saveBtn = document.getElementById('rrSavePresetBtn') as HTMLButtonElement;
    saveBtn.disabled = presets.length >= RR_MAX_PRESETS || isUnsupportedEngine();
  });
}

function isPresetActive(preset: RoundRobinPreset): boolean {
  if (isUnsupportedEngine()) return false;
  return isRoundRobinPresetActive(preset, currentEngine, getCurrentCount(), getCurrentRoundRobinIds());
}

/** プリセット一覧の「適用中」表示と、話者リスト上の適用中プリセット表示を更新する */
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
    el.textContent = 'プリセット未適用（カスタム）';
    el.title = 'どのお気に入りプリセットとも一致していません';
    el.classList.remove('active');
  }
}

/** プリセットの内容（話者2以降の割り当て）を表示する要素を作る */
function createPresetDetail(preset: RoundRobinPreset): HTMLDetailsElement {
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

  const addItem = (head: string, body: string, muted = false) => {
    const li = document.createElement('li');
    const headEl = document.createElement('span');
    headEl.className = 'preset-detail-char';
    headEl.textContent = head;
    const bodyEl = document.createElement('span');
    bodyEl.className = muted ? 'preset-detail-styles' : '';
    bodyEl.textContent = body;
    li.appendChild(headEl);
    li.appendChild(bodyEl);
    list.appendChild(li);
  };

  if (!speakersLoaded) {
    addItem('', '話者リストを取得中...', true);
  } else {
    addItem('話者1: ', 'メインの話者（プリセットには含まれません）', true);
    const slots = Math.max(0, preset.roundRobinSpeakerCount - 1);
    for (let i = 0; i < slots; i++) {
      addItem(`話者${i + 2}: `, getSpeakerLabel(preset.speakerIds[i]));
    }
  }

  details.appendChild(list);
  return details;
}

function renderRoundRobinPresetList(presets: RoundRobinPreset[]): void {
  const container = document.getElementById('rrPresetList')!;
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
    const applicable = isRoundRobinPresetApplicable(preset, currentEngine);
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

    const activeBadge = document.createElement('span');
    activeBadge.className = 'preset-active-badge';
    activeBadge.textContent = '適用中';
    activeBadge.title = '現在の話者数・話者の割り当てがこのプリセットと一致しています';
    activeBadge.style.display = 'none';

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
    loadBtn.title = 'このプリセットの設定を読み込む';
    loadBtn.addEventListener('click', () => applyRoundRobinPreset(preset));

    const overwriteBtn = document.createElement('button');
    overwriteBtn.textContent = '上書き';
    overwriteBtn.title = '現在の設定でこのプリセットを更新';
    if (!applicable) {
      loadBtn.disabled = true;
      overwriteBtn.disabled = true;
      if (isUnsupportedEngine()) {
        loadBtn.title = overwriteBtn.title = 'ブラウザ内蔵音声では使えません';
      } else {
        loadBtn.title = '別のエンジン用のプリセットのため呼び出せません';
        overwriteBtn.title = '別のエンジン用のプリセットのため上書きできません';
      }
    }
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

    const metaEl = document.createElement('div');
    metaEl.className = 'preset-item-meta';
    metaEl.textContent =
      preset.engine && !applicable
        ? `${preset.roundRobinSpeakerCount}話者・${ENGINE_LABELS[preset.engine]}用（現在のエンジンでは使えません）`
        : `${preset.roundRobinSpeakerCount}話者`;

    item.appendChild(topRow);
    item.appendChild(metaEl);
    if (applicable) item.appendChild(createPresetDetail(preset));
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
  updatePresetActiveState();
}

function saveCurrentAsRoundRobinPreset(name: string): void {
  const preset: RoundRobinPreset = {
    id: crypto.randomUUID(),
    name,
    engine: currentEngine,
    speakerIds: getCurrentRoundRobinIds(),
    roundRobinSpeakerCount: getCurrentCount(),
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
  // 別エンジン用のプリセットは話者IDの体系が違う可能性があるため適用しない
  if (!isRoundRobinPresetApplicable(preset, currentEngine)) return;
  const slider = document.getElementById('speakerCount') as HTMLInputElement;
  slider.value = String(preset.roundRobinSpeakerCount);
  document.getElementById('current-count')!.textContent = String(preset.roundRobinSpeakerCount);
  slider.setAttribute('aria-valuetext', String(preset.roundRobinSpeakerCount));

  savedSpeakerIds = preset.speakerIds.slice();
  // 話者リスト取得前（または取得失敗時）は保存値のまま保存される
  renderDropdowns();
  updatePresetActiveState();
  autoSave();
}

// --- Undo (上書き・削除の取り消し) ---
const UNDO_TIMEOUT_MS = 10000;
let pendingUndo: (() => void) | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;

function hideUndoBar(): void {
  pendingUndo = null;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = null;
  document.getElementById('rrPresetUndoBar')!.hidden = true;
}

/** 実行直後に「元に戻す」バーを表示する。一定時間で自動的に消える */
function showUndoBar(message: string, undo: () => void): void {
  pendingUndo = undo;
  const messageEl = document.getElementById('rrPresetUndoMessage')!;
  messageEl.textContent = message;
  messageEl.title = message;
  document.getElementById('rrPresetUndoBar')!.hidden = false;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndoBar, UNDO_TIMEOUT_MS);
}

document.getElementById('rrPresetUndoBtn')!.addEventListener('click', () => {
  const undo = pendingUndo;
  hideUndoBar();
  undo?.();
});
document.getElementById('rrPresetUndoCloseBtn')!.addEventListener('click', hideUndoBar);

/** 削除したプリセットを元の位置に戻す */
function restoreDeletedRoundRobinPreset(preset: RoundRobinPreset, index: number): void {
  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    if (presets.some((p) => p.id === preset.id)) return;
    const errorEl = document.getElementById('rrPresetError')!;
    if (presets.length >= RR_MAX_PRESETS) {
      errorEl.textContent = `プリセットが${RR_MAX_PRESETS}件あるため元に戻せません。`;
      errorEl.style.display = 'block';
      return;
    }
    errorEl.style.display = 'none';
    presets.splice(Math.min(index, presets.length), 0, preset);
    chrome.storage.sync.set({ roundRobinPresets: presets }, () => loadRoundRobinPresets());
  });
}

/** 上書き前の内容に戻す（名前・並び順など他の変更はそのまま） */
function restoreOverwrittenRoundRobinPreset(previous: RoundRobinPreset): void {
  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    const idx = presets.findIndex((p) => p.id === previous.id);
    if (idx < 0) return;
    presets[idx] = {
      ...presets[idx],
      engine: previous.engine,
      speakerIds: previous.speakerIds,
      roundRobinSpeakerCount: previous.roundRobinSpeakerCount,
    };
    chrome.storage.sync.set({ roundRobinPresets: presets }, () => loadRoundRobinPresets());
  });
}

function deleteRoundRobinPreset(id: string): void {
  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    const index = presets.findIndex((p) => p.id === id);
    if (index < 0) return;
    const removed = presets[index];
    const updated = presets.filter((p) => p.id !== id);
    chrome.storage.sync.set({ roundRobinPresets: updated }, () => {
      loadRoundRobinPresets();
      showUndoBar(`「${removed.name}」を削除しました`, () =>
        restoreDeletedRoundRobinPreset(removed, index),
      );
    });
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
  const roundRobinSpeakerCount = getCurrentCount();
  const speakerIds = getCurrentRoundRobinIds();

  chrome.storage.sync.get(['roundRobinPresets'], (data) => {
    const presets = (data.roundRobinPresets as RoundRobinPreset[] | undefined) ?? [];
    const idx = presets.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const previous = presets[idx];
    // 上書きした時点で現在のエンジン用として確定させる（旧形式のプリセットもここで engine が付く）
    presets[idx] = { ...previous, engine: currentEngine, speakerIds, roundRobinSpeakerCount };
    chrome.storage.sync.set({ roundRobinPresets: presets }, () => {
      loadRoundRobinPresets();
      showUndoBar(`「${previous.name}」を上書きしました`, () =>
        restoreOverwrittenRoundRobinPreset(previous),
      );
    });
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

// --- Resizable panel ---
const PANEL_WIDTH_KEY = 'roundRobinPanelWidth';
const PANEL_WIDTH_DEFAULT = 344;

(function initResizer(): void {
  const resizer = document.getElementById('layoutResizer') as HTMLElement;
  const presetPanel = document.getElementById('rrPresetSection') as HTMLElement;

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

