import { describe, it, expect } from 'vitest';
import { getDefaultBrowserVoiceNames } from './browser-voices';

describe('getDefaultBrowserVoiceNames', () => {
  it('日本語の音声だけを返す', () => {
    expect(
      getDefaultBrowserVoiceNames([
        { voiceName: 'Kyoko', lang: 'ja-JP' },
        { voiceName: 'Samantha', lang: 'en-US' },
        { voiceName: 'Google 日本語', lang: 'ja-JP' },
      ]),
    ).toEqual(['Kyoko', 'Google 日本語']);
  });

  it('日本語の音声がなければ全音声を返す', () => {
    expect(
      getDefaultBrowserVoiceNames([
        { voiceName: 'Samantha', lang: 'en-US' },
        { voiceName: 'Daniel', lang: 'en-GB' },
      ]),
    ).toEqual(['Samantha', 'Daniel']);
  });

  it('名前のない音声は除外する', () => {
    expect(
      getDefaultBrowserVoiceNames([{ lang: 'ja-JP' }, { voiceName: 'Kyoko', lang: 'ja-JP' }]),
    ).toEqual(['Kyoko']);
  });
});
