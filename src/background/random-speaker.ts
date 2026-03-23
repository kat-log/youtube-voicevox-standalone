let randomSpeakerEnabled = false;
let cachedSpeakerIds: string[] = [];
let isFetching = false;

export function isRandomSpeakerEnabled(): boolean {
  return randomSpeakerEnabled;
}

export function setRandomSpeakerEnabled(enabled: boolean): void {
  randomSpeakerEnabled = enabled;
  if (enabled && cachedSpeakerIds.length === 0) {
    fetchAndCacheSpeakerIds();
  }
}

export function loadRandomSpeakerConfigFromStorage(): void {
  chrome.storage.sync.get(['randomSpeakerEnabled'], (data) => {
    if (data.randomSpeakerEnabled) {
      randomSpeakerEnabled = true;
      fetchAndCacheSpeakerIds();
    }
  });
}

function fetchAndCacheSpeakerIds(): void {
  if (isFetching || cachedSpeakerIds.length > 0) return;
  isFetching = true;
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

export function getRandomSpeakerId(): string | undefined {
  if (cachedSpeakerIds.length === 0) return undefined;
  const index = Math.floor(Math.random() * cachedSpeakerIds.length);
  return cachedSpeakerIds[index];
}
