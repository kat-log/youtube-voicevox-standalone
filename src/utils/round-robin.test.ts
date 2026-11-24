import { describe, it, expect } from 'vitest';
import type { ParallelSpeakersConfig, RoundRobinPreset } from '@/types/state';
import {
  getSpeakerIdsForEngine,
  withSpeakerIdsForEngine,
  isRoundRobinPresetApplicable,
  isRoundRobinPresetActive,
} from './round-robin';

const legacy: ParallelSpeakersConfig = {
  enabled: true,
  speakerIds: ['3', '8'],
  roundRobinSpeakerCount: 3,
};

describe('getSpeakerIdsForEngine', () => {
  it('旧形式の設定は Web API・ローカルの両方で同じ話者を返す', () => {
    expect(getSpeakerIdsForEngine(legacy, 'voicevox')).toEqual(['3', '8']);
    expect(getSpeakerIdsForEngine(legacy, 'local-voicevox')).toEqual(['3', '8']);
  });

  it('ブラウザ内蔵音声では空を返す', () => {
    expect(getSpeakerIdsForEngine(legacy, 'browser')).toEqual([]);
  });

  it('エンジン別の値があればそちらを優先する', () => {
    const config = { ...legacy, speakerIdsByEngine: { localVoicevox: ['1000'] } };
    expect(getSpeakerIdsForEngine(config, 'local-voicevox')).toEqual(['1000']);
    expect(getSpeakerIdsForEngine(config, 'voicevox')).toEqual(['3', '8']);
  });

  it('設定がなければ空を返す', () => {
    expect(getSpeakerIdsForEngine(undefined, 'voicevox')).toEqual([]);
  });
});

describe('withSpeakerIdsForEngine', () => {
  it('ローカル用を保存しても Web API 用は旧データのまま残る', () => {
    const next = withSpeakerIdsForEngine(legacy, 'local-voicevox', ['1000', '1001']);
    expect(getSpeakerIdsForEngine(next, 'local-voicevox')).toEqual(['1000', '1001']);
    expect(getSpeakerIdsForEngine(next, 'voicevox')).toEqual(['3', '8']);
    // 旧バージョン互換のため speakerIds には最後に保存した値が入る
    expect(next.speakerIds).toEqual(['1000', '1001']);
  });

  it('元の設定を変更しない', () => {
    withSpeakerIdsForEngine(legacy, 'voicevox', ['1']);
    expect(legacy).toEqual({ enabled: true, speakerIds: ['3', '8'], roundRobinSpeakerCount: 3 });
  });

  it('ブラウザ内蔵音声では何も変えない', () => {
    expect(withSpeakerIdsForEngine(legacy, 'browser', ['x'])).toBe(legacy);
  });
});

describe('isRoundRobinPresetApplicable', () => {
  const base: RoundRobinPreset = { id: 'p', name: 'p', speakerIds: [], roundRobinSpeakerCount: 3 };

  it('旧形式のプリセットは VOICEVOX 系の両エンジンで使える', () => {
    expect(isRoundRobinPresetApplicable(base, 'voicevox')).toBe(true);
    expect(isRoundRobinPresetApplicable(base, 'local-voicevox')).toBe(true);
  });

  it('エンジン付きのプリセットはそのエンジンでのみ使える', () => {
    const preset = { ...base, engine: 'local-voicevox' as const };
    expect(isRoundRobinPresetApplicable(preset, 'local-voicevox')).toBe(true);
    expect(isRoundRobinPresetApplicable(preset, 'voicevox')).toBe(false);
  });

  it('ブラウザ内蔵音声ではどのプリセットも使えない', () => {
    expect(isRoundRobinPresetApplicable(base, 'browser')).toBe(false);
  });
});

describe('isRoundRobinPresetActive', () => {
  const preset: RoundRobinPreset = {
    id: 'p',
    name: 'p',
    engine: 'local-voicevox',
    speakerIds: ['3', '8'],
    roundRobinSpeakerCount: 3,
  };

  it('話者数と話者2以降が一致すれば適用中', () => {
    expect(isRoundRobinPresetActive(preset, 'local-voicevox', 3, ['3', '8'])).toBe(true);
  });

  it('話者数が違えば適用中ではない', () => {
    expect(isRoundRobinPresetActive(preset, 'local-voicevox', 2, ['3'])).toBe(false);
  });

  it('割り当てが1つでも違えば適用中ではない', () => {
    expect(isRoundRobinPresetActive(preset, 'local-voicevox', 3, ['3', '9'])).toBe(false);
  });

  it('話者数を超える余分な保存値は比較しない', () => {
    const long = { ...preset, roundRobinSpeakerCount: 2, speakerIds: ['3', '8'] };
    expect(isRoundRobinPresetActive(long, 'local-voicevox', 2, ['3'])).toBe(true);
  });

  it('別エンジン用のプリセットは一致していても適用中にしない', () => {
    expect(isRoundRobinPresetActive(preset, 'voicevox', 3, ['3', '8'])).toBe(false);
  });
});
