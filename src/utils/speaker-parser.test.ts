import { describe, it, expect } from 'vitest';
import {
  parseSpeakerName,
  parseLocalSpeakers,
  groupByCharacter,
  getUniqueStyles,
} from './speaker-parser';

describe('parseSpeakerName', () => {
  it('全角括弧付きの話者名をキャラ名+スタイルに分解する', () => {
    const result = parseSpeakerName('3', 'ずんだもん（ノーマル）');
    expect(result).toEqual({
      id: '3',
      character: 'ずんだもん',
      style: 'ノーマル',
      fullName: 'ずんだもん（ノーマル）',
    });
  });

  it('あまあまスタイルをパースする', () => {
    const result = parseSpeakerName('1', '四国めたん（あまあま）');
    expect(result).toEqual({
      id: '1',
      character: '四国めたん',
      style: 'あまあま',
      fullName: '四国めたん（あまあま）',
    });
  });

  it('括弧なしの名前はキャラ名のみ・スタイル空文字', () => {
    const result = parseSpeakerName('99', 'テスト話者');
    expect(result).toEqual({
      id: '99',
      character: 'テスト話者',
      style: '',
      fullName: 'テスト話者',
    });
  });

  it('空文字列を処理する', () => {
    const result = parseSpeakerName('0', '');
    expect(result).toEqual({
      id: '0',
      character: '',
      style: '',
      fullName: '',
    });
  });
});

describe('parseLocalSpeakers', () => {
  it('ローカルVOICEVOXのデータをParsedSpeaker配列に変換する', () => {
    const input = [
      {
        name: 'ずんだもん',
        styles: [
          { id: 3, name: 'ノーマル' },
          { id: 4, name: 'あまあま' },
        ],
      },
      {
        name: '四国めたん',
        styles: [{ id: 0, name: 'ノーマル' }],
      },
    ];
    const result = parseLocalSpeakers(input);
    expect(result).toEqual([
      { id: '3', character: 'ずんだもん', style: 'ノーマル', fullName: 'ずんだもん（ノーマル）' },
      { id: '4', character: 'ずんだもん', style: 'あまあま', fullName: 'ずんだもん（あまあま）' },
      { id: '0', character: '四国めたん', style: 'ノーマル', fullName: '四国めたん（ノーマル）' },
    ]);
  });

  it('空配列は空配列を返す', () => {
    expect(parseLocalSpeakers([])).toEqual([]);
  });
});

describe('groupByCharacter', () => {
  it('キャラクター名でグループ化する', () => {
    const speakers = [
      { id: '0', character: '四国めたん', style: 'ノーマル', fullName: '四国めたん（ノーマル）' },
      { id: '1', character: '四国めたん', style: 'あまあま', fullName: '四国めたん（あまあま）' },
      { id: '3', character: 'ずんだもん', style: 'ノーマル', fullName: 'ずんだもん（ノーマル）' },
    ];
    const groups = groupByCharacter(speakers);
    expect(groups.size).toBe(2);
    expect(groups.get('四国めたん')).toHaveLength(2);
    expect(groups.get('ずんだもん')).toHaveLength(1);
  });

  it('空配列は空Mapを返す', () => {
    expect(groupByCharacter([]).size).toBe(0);
  });
});

describe('getUniqueStyles', () => {
  it('ユニークなスタイル名をソートして返す', () => {
    const speakers = [
      { id: '0', character: '四国めたん', style: 'ノーマル', fullName: '' },
      { id: '1', character: '四国めたん', style: 'あまあま', fullName: '' },
      { id: '3', character: 'ずんだもん', style: 'ノーマル', fullName: '' },
      { id: '4', character: 'ずんだもん', style: 'ツンツン', fullName: '' },
    ];
    const styles = getUniqueStyles(speakers);
    expect(styles).toEqual(['あまあま', 'ツンツン', 'ノーマル']);
  });

  it('スタイルが空文字のものは除外する', () => {
    const speakers = [
      { id: '0', character: 'テスト', style: '', fullName: 'テスト' },
      { id: '1', character: '四国めたん', style: 'ノーマル', fullName: '' },
    ];
    const styles = getUniqueStyles(speakers);
    expect(styles).toEqual(['ノーマル']);
  });
});
