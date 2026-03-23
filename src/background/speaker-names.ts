let speakerNames: Map<string, string> | null = null;
let isFetching = false;

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

export function getSpeakerName(id: string | undefined): string {
  if (!id) return '';
  if (!speakerNames) {
    initSpeakerNames();
    return `ID:${id}`;
  }
  return speakerNames.get(id) || `ID:${id}`;
}
