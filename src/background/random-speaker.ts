import type { TtsEngine } from '@/types/state';

let randomSpeakerEnabled = false;
let allSpeakerIds: string[] = [];
let cachedSpeakerIds: string[] = [];
let allowedSpeakerIds: Set<string> | null = null;
let isFetching = false;
let currentEngine: TtsEngine = 'voicevox';
let localHost: string = 'http://localhost:50021';

export function isRandomSpeakerEnabled(): boolean {
  return randomSpeakerEnabled;
}

export function setRandomSpeakerEnabled(enabled: boolean): void {
  randomSpeakerEnabled = enabled;
  if (enabled && cachedSpeakerIds.length === 0) {
    fetchAndCacheSpeakerIds();
  }
}

/**
 * ランダム話者のソースエンジンを設定する。
 * エンジン変更時はキャッシュをクリアして再フェッチする。
 */
export function setRandomSpeakerEngine(engine: TtsEngine, host?: string): void {
  const engineChanged = currentEngine !== engine;
  const hostChanged = host !== undefined && localHost !== host;
  currentEngine = engine;
  if (host !== undefined) {
    localHost = host;
  }
  if (engineChanged || hostChanged) {
    // エンジンまたはホスト変更時はキャッシュをクリア
    allSpeakerIds = [];
    cachedSpeakerIds = [];
    // エンジンに応じた allowlist を読み込む
    const storageKey = engine === 'local-voicevox'
      ? 'randomSpeakerAllowedIdsLocal'
      : 'randomSpeakerAllowedIds';
    chrome.storage.sync.get([storageKey], (data) => {
      const ids = data[storageKey] as string[] | undefined;
      allowedSpeakerIds = ids ? new Set(ids) : null;
      if (randomSpeakerEnabled) {
        fetchAndCacheSpeakerIds();
      }
    });
  }
}

/**
 * ランダム話者の許可リストを設定する。null = 全話者。
 */
export function setAllowedSpeakerIds(ids: string[] | null): void {
  allowedSpeakerIds = ids ? new Set(ids) : null;
  if (allSpeakerIds.length > 0) {
    applyAllowedFilter();
  }
}

function applyAllowedFilter(): void {
  if (allowedSpeakerIds === null) {
    cachedSpeakerIds = [...allSpeakerIds];
  } else {
    cachedSpeakerIds = allSpeakerIds.filter((id) => allowedSpeakerIds!.has(id));
  }
  // フィルタ結果が空なら全話者にフォールバック
  if (cachedSpeakerIds.length === 0 && allSpeakerIds.length > 0) {
    cachedSpeakerIds = [...allSpeakerIds];
  }
}

export function loadRandomSpeakerConfigFromStorage(): void {
  chrome.storage.sync.get(
    [
      'randomSpeakerEnabled',
      'ttsEngine',
      'localVoicevoxHost',
      'randomSpeakerAllowedIds',
      'randomSpeakerAllowedIdsLocal',
    ],
    (data) => {
      if (data.ttsEngine) currentEngine = data.ttsEngine as TtsEngine;
      if (data.localVoicevoxHost) localHost = data.localVoicevoxHost as string;

      // エンジンに応じた allowlist を読み込む
      const storageKey = currentEngine === 'local-voicevox'
        ? 'randomSpeakerAllowedIdsLocal'
        : 'randomSpeakerAllowedIds';
      const ids = data[storageKey] as string[] | undefined;
      allowedSpeakerIds = ids ? new Set(ids) : null;

      if (data.randomSpeakerEnabled) {
        randomSpeakerEnabled = true;
        fetchAndCacheSpeakerIds();
      }
    }
  );
}

function fetchAndCacheSpeakerIds(): void {
  if (isFetching || allSpeakerIds.length > 0) return;
  isFetching = true;

  if (currentEngine === 'local-voicevox') {
    fetchLocalSpeakerIds();
  } else {
    fetchApiSpeakerIds();
  }
}

function fetchApiSpeakerIds(): void {
  fetch('https://static.tts.quest/voicevox_speakers.json')
    .then((res) => res.json())
    .then((speakers: (string | null)[]) => {
      allSpeakerIds = speakers
        .map((name, index) => (name !== null ? String(index) : null))
        .filter((id): id is string => id !== null);
      applyAllowedFilter();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch speaker list for random mode:', err);
    })
    .finally(() => {
      isFetching = false;
    });
}

function fetchLocalSpeakerIds(): void {
  fetch(`${localHost}/speakers`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((speakers: Array<{ name: string; styles: Array<{ id: number; name: string }> }>) => {
      allSpeakerIds = speakers.flatMap((speaker) =>
        speaker.styles.map((style) => String(style.id))
      );
      applyAllowedFilter();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch local speaker list for random mode:', err);
    })
    .finally(() => {
      isFetching = false;
    });
}

export function ensureRandomSpeakerCache(): void {
  if (cachedSpeakerIds.length === 0) {
    fetchAndCacheSpeakerIds();
  }
}

export function getRandomSpeakerId(): string | undefined {
  if (cachedSpeakerIds.length === 0) return undefined;
  const index = Math.floor(Math.random() * cachedSpeakerIds.length);
  return cachedSpeakerIds[index];
}
