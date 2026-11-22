import { describe, it, expect } from 'vitest';
import { buildSpeakerStoragePatch, getSpeakerSelectId } from './speaker-storage';
import { RANDOM_SPEAKER_SENTINEL } from '@/types/state';

describe('buildSpeakerStoragePatch', () => {
  it('Web API VOICEVOX は speakerId に保存する', () => {
    expect(buildSpeakerStoragePatch('voicevox', '3')).toEqual({ speakerId: '3' });
  });

  it('ローカルVOICEVOX は localSpeakerId に保存し、Web API の speakerId を上書きしない', () => {
    expect(buildSpeakerStoragePatch('local-voicevox', '46')).toEqual({ localSpeakerId: '46' });
  });

  it('ブラウザ内蔵音声では話者IDを保存しない（VOICEVOX 用キーを汚さない）', () => {
    expect(buildSpeakerStoragePatch('browser', '3')).toEqual({});
  });

  it('ランダム話者モード中（ダミー値選択中）は保存しない', () => {
    expect(buildSpeakerStoragePatch('voicevox', RANDOM_SPEAKER_SENTINEL)).toEqual({});
    expect(buildSpeakerStoragePatch('local-voicevox', RANDOM_SPEAKER_SENTINEL)).toEqual({});
  });

  it('未選択（空文字）は保存しない', () => {
    expect(buildSpeakerStoragePatch('voicevox', '')).toEqual({});
  });
});

describe('getSpeakerSelectId', () => {
  it('エンジンごとの話者ドロップダウンを返す', () => {
    expect(getSpeakerSelectId('voicevox')).toBe('speaker');
    expect(getSpeakerSelectId('local-voicevox')).toBe('localSpeaker');
    expect(getSpeakerSelectId('browser')).toBe('browserVoice');
  });
});
