import { loadSettings } from './settings-loader';

const SYNC_KEYS_WITHOUT_API = [
  'speed',
  'volume',
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
] as const;

const API_KEYS = ['apiKeyVOICEVOX', 'apiKeyYoutube'] as const;

const EXPORT_FORMAT_VERSION = '1';

type ExportData = {
  _meta: { version: string; exportedAt: string; extensionVersion: string };
  sync: Record<string, unknown>;
  local: { stats: unknown };
};

export function initDataManagement(): void {
  document.getElementById('export-settings-btn')!.addEventListener('click', handleExport);
  document.getElementById('import-settings-btn')!.addEventListener('click', () => {
    (document.getElementById('import-settings-file') as HTMLInputElement).click();
  });
  document.getElementById('import-settings-file')!.addEventListener('change', handleImport);
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
    ? '⚠️ このファイルにはAPIキーが含まれています。\n\n現在の設定が上書きされます。続行しますか？'
    : '現在の設定が上書きされます。続行しますか？';

  if (!confirm(confirmMessage)) return;

  await chrome.storage.sync.set(parsed.sync);
  if (parsed.local.stats != null) {
    await chrome.storage.local.set({ stats: parsed.local.stats });
  }

  loadSettings();
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
