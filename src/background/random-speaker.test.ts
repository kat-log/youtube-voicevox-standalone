import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./messaging', () => ({ logWarn: vi.fn() }));

type Voice = { voiceName?: string; lang?: string };

/** chrome.storage.sync（コールバック形式）と chrome.tts.getVoices を最小限モックする */
function installChrome(store: Record<string, unknown>, voices: Voice[]): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      sync: {
        get: (keys: string[], cb: (data: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = {};
          for (const k of keys) if (k in store) result[k] = store[k];
          cb(result);
        },
      },
    },
    tts: { getVoices: (cb: (v: Voice[]) => void) => cb(voices) },
  };
}

const VOICES: Voice[] = [
  { voiceName: 'Kyoko', lang: 'ja-JP' },
  { voiceName: 'Samantha', lang: 'en-US' },
  { voiceName: 'Google 日本語', lang: 'ja-JP' },
];

async function loadModule() {
  vi.resetModules();
  return import('./random-speaker');
}

function collectPicks(pick: () => string | undefined, n = 200): Set<string | undefined> {
  const seen = new Set<string | undefined>();
  for (let i = 0; i < n; i++) seen.add(pick());
  return seen;
}

describe('random-speaker（ブラウザ内蔵音声）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('許可リスト未設定なら日本語の音声だけから選ぶ', async () => {
    installChrome({ ttsEngine: 'browser', randomSpeakerEnabled: true }, VOICES);
    const mod = await loadModule();
    mod.loadRandomSpeakerConfigFromStorage();
    expect(collectPicks(mod.getRandomSpeakerId)).toEqual(new Set(['Kyoko', 'Google 日本語']));
  });

  it('許可リストで外国語の音声を明示的に選べば使える', async () => {
    installChrome(
      {
        ttsEngine: 'browser',
        randomSpeakerEnabled: true,
        randomSpeakerAllowedIdsBrowser: ['Samantha'],
      },
      VOICES,
    );
    const mod = await loadModule();
    mod.loadRandomSpeakerConfigFromStorage();
    expect(collectPicks(mod.getRandomSpeakerId)).toEqual(new Set(['Samantha']));
  });

  it('日本語の音声がない環境では全音声から選ぶ', async () => {
    installChrome({ ttsEngine: 'browser', randomSpeakerEnabled: true }, [
      { voiceName: 'Samantha', lang: 'en-US' },
      { voiceName: 'Daniel', lang: 'en-GB' },
    ]);
    const mod = await loadModule();
    mod.loadRandomSpeakerConfigFromStorage();
    expect(collectPicks(mod.getRandomSpeakerId)).toEqual(new Set(['Samantha', 'Daniel']));
  });
});
