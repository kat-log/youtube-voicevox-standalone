import type { TtsEngine } from '@/types/state';

let randomSpeakerEnabled = false;
let cachedSpeakerIds: string[] = [];
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
    cachedSpeakerIds = [];
    if (randomSpeakerEnabled) {
      fetchAndCacheSpeakerIds();
    }
  }
}

export function loadRandomSpeakerConfigFromStorage(): void {
  chrome.storage.sync.get(['randomSpeakerEnabled', 'ttsEngine', 'localVoicevoxHost'], (data) => {
    if (data.ttsEngine) currentEngine = data.ttsEngine as TtsEngine;
    if (data.localVoicevoxHost) localHost = data.localVoicevoxHost as string;
    if (data.randomSpeakerEnabled) {
      randomSpeakerEnabled = true;
      fetchAndCacheSpeakerIds();
    }
  });
}

function fetchAndCacheSpeakerIds(): void {
  if (isFetching || cachedSpeakerIds.length > 0) return;
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
      cachedSpeakerIds = speakers
        .map((name, index) => (name !== null ? String(index) : null))
        .filter((id): id is string => id !== null);
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
      cachedSpeakerIds = speakers.flatMap((speaker) =>
        speaker.styles.map((style) => String(style.id))
      );
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch local speaker list for random mode:', err);
    })
    .finally(() => {
      isFetching = false;
    });
}

export function getRandomSpeakerId(): string | undefined {
  if (cachedSpeakerIds.length === 0) return undefined;
  const index = Math.floor(Math.random() * cachedSpeakerIds.length);
  return cachedSpeakerIds[index];
}
