import type { TtsEngine } from '@/types/state';

let speakerNames: Map<string, string> | null = null;
let isFetching = false;

let localSpeakerNames: Map<string, string> | null = null;
let isLocalFetching = false;

let currentEngine: TtsEngine = 'voicevox';

export function initSpeakerNames(): void {
  if (speakerNames || isFetching) return;
  isFetching = true;
  fetch('https://static.tts.quest/voicevox_speakers.json')
    .then((res) => res.json())
    .then((speakers: (string | null)[]) => {
      speakerNames = new Map();
      speakers.forEach((name, index) => {
        if (name !== null) {
          speakerNames!.set(String(index), name);
        }
      });
    })
    .catch(() => {
      // フェッチ失敗時はフォールバック（ID表示）で継続
    })
    .finally(() => {
      isFetching = false;
    });
}

export function initLocalSpeakerNames(host: string): void {
  if (isLocalFetching) return;
  isLocalFetching = true;
  fetch(`${host}/speakers`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((speakers: Array<{ name: string; styles: Array<{ id: number; name: string }> }>) => {
      localSpeakerNames = new Map();
      speakers.forEach((speaker) => {
        speaker.styles.forEach((style) => {
          localSpeakerNames!.set(String(style.id), `${speaker.name} (${style.name})`);
        });
      });
    })
    .catch(() => {
      // フェッチ失敗時はフォールバック（ID表示）で継続
    })
    .finally(() => {
      isLocalFetching = false;
    });
}

export function setSpeakerNameEngine(engine: TtsEngine): void {
  currentEngine = engine;
}

export function getSpeakerName(id: string | undefined): string {
  if (!id) return '';

  if (currentEngine === 'local-voicevox') {
    if (!localSpeakerNames) {
      return `ID:${id}`;
    }
    return localSpeakerNames.get(id) || `ID:${id}`;
  }

  if (!speakerNames) {
    initSpeakerNames();
    return `ID:${id}`;
  }
  return speakerNames.get(id) || `ID:${id}`;
}
