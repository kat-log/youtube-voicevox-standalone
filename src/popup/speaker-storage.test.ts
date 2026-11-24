import { describe, it, expect } from 'vitest';
import { buildSpeakerStoragePatch, getSpeakerSelectId, applyExternalSpeakerChange } from './speaker-storage';
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

describe('applyExternalSpeakerChange', () => {
  // テスト環境に DOM がないため、使うプロパティだけを持つ select もどきで確認する
  const makeSelect = (value: string, values: string[]) =>
    ({ value, options: values.map((v) => ({ value: v })), dataset: {} as DOMStringMap }) as unknown as HTMLSelectElement;

  it('別ページで変わった話者を選択に反映する', () => {
    const select = makeSelect('1', ['1', '3']);
    applyExternalSpeakerChange(select, '3');
    expect(select.value).toBe('3');
  });

  it('一覧にない ID は反映しない', () => {
    const select = makeSelect('1', ['1', '3']);
    applyExternalSpeakerChange(select, '99');
    expect(select.value).toBe('1');
  });

  it('ランダムモード中はダミー選択のまま、復帰先だけ差し替える', () => {
    const select = makeSelect(RANDOM_SPEAKER_SENTINEL, [RANDOM_SPEAKER_SENTINEL, '1', '3']);
    applyExternalSpeakerChange(select, '3');
    expect(select.value).toBe(RANDOM_SPEAKER_SENTINEL);
    expect(select.dataset.realValue).toBe('3');
  });

  it('センチネル値や空値は無視する', () => {
    const select = makeSelect('1', ['1', RANDOM_SPEAKER_SENTINEL]);
    applyExternalSpeakerChange(select, RANDOM_SPEAKER_SENTINEL);
    applyExternalSpeakerChange(select, undefined);
    expect(select.value).toBe('1');
  });
});
