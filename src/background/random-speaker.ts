import { stripRandomSentinel, type TtsEngine } from '@/types/state';
import { logWarn } from './messaging';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

export const DEFAULT_TTS_ENGINE: TtsEngine = 'local-voicevox';
export const DEFAULT_LOCAL_VOICEVOX_HOST = 'http://localhost:50021';

let randomSpeakerEnabled = false;
let allSpeakerIds: string[] = [];
let cachedSpeakerIds: string[] = [];
let allowedSpeakerIds: Set<string> | null = null;
let isFetching = false;
let currentEngine: TtsEngine = DEFAULT_TTS_ENGINE;
let localHost: string = DEFAULT_LOCAL_VOICEVOX_HOST;

/** エンジンに応じたランダム話者の許可リスト用ストレージキーを返す */
export function getRandomSpeakerStorageKey(engine: TtsEngine): string {
  if (engine === 'local-voicevox') return 'randomSpeakerAllowedIdsLocal';
  if (engine === 'browser') return 'randomSpeakerAllowedIdsBrowser';
  return 'randomSpeakerAllowedIds';
}

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
    const storageKey = getRandomSpeakerStorageKey(engine);
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

/**
 * ランダム話者設定を storage の内容で丸ごと再適用する。
 * 起動時だけでなく、設定インポートなど background 外からの storage 変更時にも呼ばれるため、
 * 「値があれば上書き」ではなく「storage の状態＝現在の状態」になるよう常に全項目を反映する。
 */
export function loadRandomSpeakerConfigFromStorage(): void {
  chrome.storage.sync.get(
    [
      'randomSpeakerEnabled',
      'ttsEngine',
      'localVoicevoxHost',
      'randomSpeakerAllowedIds',
      'randomSpeakerAllowedIdsLocal',
      'randomSpeakerAllowedIdsBrowser',
    ],
    (data) => {
      const engine = (data.ttsEngine as TtsEngine | undefined) ?? DEFAULT_TTS_ENGINE;
      const host = (data.localVoicevoxHost as string | undefined) || DEFAULT_LOCAL_VOICEVOX_HOST;
      const engineChanged = currentEngine !== engine;
      const hostChanged = localHost !== host;
      currentEngine = engine;
      localHost = host;

      // エンジン／ホストが変わったら話者リストのキャッシュは無効
      if (engineChanged || (engine === 'local-voicevox' && hostChanged)) {
        allSpeakerIds = [];
        cachedSpeakerIds = [];
      }

      // エンジンに応じた allowlist を読み込む
      const storageKey = getRandomSpeakerStorageKey(engine);
      const ids = data[storageKey] as string[] | undefined;
      allowedSpeakerIds = ids ? new Set(ids) : null;
      // 取得済みの話者リストがあれば allowlist を即座に反映する
      applyAllowedFilter();

      randomSpeakerEnabled = Boolean(data.randomSpeakerEnabled);
      if (randomSpeakerEnabled) {
        fetchAndCacheSpeakerIds();
      }
    }
  );
}

function fetchAndCacheSpeakerIds(): void {
  if (isFetching || allSpeakerIds.length > 0) return;
  isFetching = true;

  if (currentEngine === 'browser') {
    fetchBrowserVoiceNames();
  } else if (currentEngine === 'local-voicevox') {
    fetchLocalSpeakerIds();
  } else {
    fetchApiSpeakerIds();
  }
}

function fetchApiSpeakerIds(): void {
  fetchWithTimeout('https://static.tts.quest/voicevox_speakers.json', 10_000)
    .then((res) => res.json())
    .then((speakers: (string | null)[]) => {
      allSpeakerIds = speakers
        .map((name, index) => (name !== null ? String(index) : null))
        .filter((id): id is string => id !== null);
      applyAllowedFilter();
    })
    .catch((err) => {
      logWarn(`⚠ ランダム話者リスト取得失敗: ${(err as Error).message}`);
    })
    .finally(() => {
      isFetching = false;
    });
}

function fetchLocalSpeakerIds(): void {
  fetchWithTimeout(`${localHost}/speakers`, 10_000)
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
      logWarn(`⚠ ローカル話者リスト取得失敗: ${(err as Error).message}`);
    })
    .finally(() => {
      isFetching = false;
    });
}

function fetchBrowserVoiceNames(): void {
  chrome.tts.getVoices((voices) => {
    allSpeakerIds = voices
      .filter((v) => v.voiceName)
      .map((v) => v.voiceName!);
    applyAllowedFilter();
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

/**
 * 実際に音声合成へ渡す話者IDを解決する。
 * ランダムモード時はランダムな話者IDを返すが、話者リストのキャッシュが未取得の場合は
 * undefined を返して呼び出し側のフォールバック（storage の保存値 → '1'）に委ねる。
 * センチネル値（'__random__'）はここより先へ絶対に渡さない。
 */
export function resolveSpeakerId(configSpeakerId: string | undefined): string | undefined {
  if (isRandomSpeakerEnabled()) {
    const picked = getRandomSpeakerId();
    if (picked) return picked;
    // キャッシュ未取得。次回以降のために取得を促しつつ、今回は保存値へフォールバックする
    ensureRandomSpeakerCache();
  }
  return stripRandomSentinel(configSpeakerId);
}
