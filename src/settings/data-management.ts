import { normalizeVolumeStepCount, quantizeVolume } from '../utils/volume';

/**
 * エクスポート／インポートの対象となる chrome.storage.sync のキー（APIキーを除く）。
 *
 * 設定を追加したらここにも必ず追加すること。
 * ここに無いキーはエクスポートされず、インポート時にも復元されない。
 */
const SYNC_KEYS_WITHOUT_API = [
  'speed',
  'volume',
  'volumeStepCount',
  'ttsEngine',
  'speakerId',
  'localSpeakerId',
  'browserVoice',
  'localVoicevoxHost',
  'parallelSynthesisCount',
  'chatMode',
  'darkMode',
  'latestOnlyMode',
  'latestOnlyCount',
  'randomSpeakerEnabled',
  'randomSpeakerAllowedIds',
  'randomSpeakerAllowedIdsLocal',
  'randomSpeakerAllowedIdsBrowser',
  'filterConfig',
  'rushModeConfig',
  'autoCatchUpConfig',
  'parallelPlaybackConfig',
  'parallelSpeakersConfig',
  'randomSpeakerPresets',
  'roundRobinPresets',
  'randomSpeakerPanelWidth',
  'roundRobinPanelWidth',
  'popupSectionCollapsed',
  'popupSectionOrder',
  'timelineSpeakerWidth',
  'timelineLabelWidth',
] as const;

const API_KEYS = ['apiKeyVOICEVOX', 'apiKeyYoutube'] as const;

const EXPORT_FORMAT_VERSION = '1';

type ExportData = {
  _meta: { version: string; exportedAt: string; extensionVersion: string };
  sync: Record<string, unknown>;
  local: { stats: unknown };
};

/** インポート／リセット後にページ側の表示を storage の値へ揃えるコールバック */
let refreshPage: () => void = () => {};

export function initDataManagement(onChanged: () => void): void {
  refreshPage = onChanged;
  document.getElementById('export-settings-btn')!.addEventListener('click', handleExport);
  document.getElementById('import-settings-btn')!.addEventListener('click', () => {
    (document.getElementById('import-settings-file') as HTMLInputElement).click();
  });
  document.getElementById('import-settings-file')!.addEventListener('change', handleImport);
  document.getElementById('reset-settings-btn')!.addEventListener('click', handleResetToDefaults);
}

async function handleExport(): Promise<void> {
  const includeApiKeys = (document.getElementById('export-include-api-keys') as HTMLInputElement)
    .checked;
  const keysToFetch = includeApiKeys
    ? ([...SYNC_KEYS_WITHOUT_API, ...API_KEYS] as string[])
    : ([...SYNC_KEYS_WITHOUT_API] as string[]);

  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(keysToFetch),
    chrome.storage.local.get('stats'),
  ]);

  const extensionVersion = chrome.runtime.getManifest().version;

  const exportObj = {
    _meta: {
      version: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      extensionVersion,
    },
    sync: syncData,
    local: {
      stats: localData.stats ?? null,
    },
  };

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `youtube-voicevox-settings-${dateStr}.json`;
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * インポートファイルの sync 部分から、storage への書き込み内容と削除キーを決める。
 *
 * 初期値のままの設定は storage に保存されず、エクスポートファイルにも現れない。
 * そのため単純にマージすると「ファイルでは初期値なのに現在値が残る」ズレが起きる。
 * 管理対象キーはファイルの内容で置き換え、ファイルに無いキーは削除して初期値へ戻す。
 * ただしAPIキーはエクスポート時に意図的に除外できるため、含まれている場合のみ上書きする。
 */
export function planSyncImport(fileSync: Record<string, unknown>): {
  set: Record<string, unknown>;
  remove: string[];
} {
  const set: Record<string, unknown> = {};
  const remove: string[] = [];

  for (const key of SYNC_KEYS_WITHOUT_API) {
    if (fileSync[key] === undefined) remove.push(key);
    else set[key] = fileSync[key];
  }

  for (const key of API_KEYS) {
    if (fileSync[key] !== undefined) set[key] = fileSync[key];
  }

  // 音量の段階数だけが初期値へ戻るとグリッドから外れた音量が残るため、丸め直す
  if (typeof set.volume === 'number') {
    set.volume = quantizeVolume(set.volume, normalizeVolumeStepCount(set.volumeStepCount));
  }

  return { set, remove };
}

async function handleImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  let parsed: unknown;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch {
    alert('ファイルの読み込みに失敗しました。JSONファイルを選択してください。');
    return;
  }

  if (!isValidExportFile(parsed)) {
    alert('このファイルは対応していない形式です。');
    return;
  }

  const sync = parsed.sync as Record<string, unknown>;
  const hasApiKeys =
    (typeof sync['apiKeyVOICEVOX'] === 'string' && sync['apiKeyVOICEVOX'] !== '') ||
    (typeof sync['apiKeyYoutube'] === 'string' && sync['apiKeyYoutube'] !== '');
  const confirmMessage = hasApiKeys
    ? '⚠️ このファイルにはAPIキーが含まれています。\n\n現在の設定が上書きされ、ファイルに含まれない設定は初期値に戻ります。続行しますか？'
    : '現在の設定が上書きされ、ファイルに含まれない設定は初期値に戻ります。\n（APIキーはこのファイルに含まれていないため、現在の値を保持します）\n\n続行しますか？';

  if (!confirm(confirmMessage)) return;

  const { set, remove } = planSyncImport(sync);
  if (remove.length > 0) await chrome.storage.sync.remove(remove);
  await chrome.storage.sync.set(set);

  if (parsed.local.stats != null) {
    await chrome.storage.local.set({ stats: parsed.local.stats });
  }

  refreshPage();
}

async function handleResetToDefaults(): Promise<void> {
  if (
    !confirm(
      '⚠️ すべての設定をデフォルト（初期設定）に戻します。\n\nAPIキーを含むすべての設定が失われます。続行しますか？'
    )
  )
    return;

  await Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()]);
  refreshPage();
}

function isValidExportFile(obj: unknown): obj is ExportData {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  if (typeof o._meta !== 'object' || o._meta === null) return false;
  if (typeof (o._meta as Record<string, unknown>).version !== 'string') return false;
  if (typeof o.sync !== 'object' || o.sync === null) return false;
  if (typeof o.local !== 'object' || o.local === null) return false;
  return true;
}
