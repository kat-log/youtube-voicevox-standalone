import { describe, it, expect } from 'vitest';
import { getCurrentRank, getNextRank, getProgressToNextRank, RANKS } from './ranks';

describe('getCurrentRank', () => {
  it('0件は見習い配信リスナー', () => {
    expect(getCurrentRank(0).name).toBe('見習い配信リスナー');
  });

  it('10件は駆け出しリスナー', () => {
    expect(getCurrentRank(10).name).toBe('駆け出しリスナー');
  });

  it('9件はまだ見習い配信リスナー', () => {
    expect(getCurrentRank(9).name).toBe('見習い配信リスナー');
  });

  it('9999件はチャットの神', () => {
    expect(getCurrentRank(9999).name).toBe('チャットの神');
  });

  it('10000件は読み上げの覇王', () => {
    expect(getCurrentRank(10000).name).toBe('読み上げの覇王');
  });

  it('99999件でも読み上げの覇王', () => {
    expect(getCurrentRank(99999).name).toBe('読み上げの覇王');
  });

  it('各ランクの閾値ちょうどで正しいランクを返す', () => {
    for (const rank of RANKS) {
      expect(getCurrentRank(rank.threshold).name).toBe(rank.name);
    }
  });
});

describe('getNextRank', () => {
  it('0件の次は駆け出しリスナー (threshold=10)', () => {
    const next = getNextRank(0);
    expect(next).not.toBeNull();
    expect(next!.name).toBe('駆け出しリスナー');
    expect(next!.threshold).toBe(10);
  });

  it('10件の次はコメント読み師 (threshold=50)', () => {
    const next = getNextRank(10);
    expect(next).not.toBeNull();
    expect(next!.name).toBe('コメント読み師');
  });

  it('10000件 (最大ランク) の次は null', () => {
    expect(getNextRank(10000)).toBeNull();
  });

  it('99999件の次も null', () => {
    expect(getNextRank(99999)).toBeNull();
  });
});

describe('getProgressToNextRank', () => {
  it('0件は 0%', () => {
    expect(getProgressToNextRank(0)).toBe(0);
  });

  it('5件は 50% (0→10 の中間)', () => {
    expect(getProgressToNextRank(5)).toBe(50);
  });

  it('閾値ちょうどは 0% (次ランクへの進捗)', () => {
    expect(getProgressToNextRank(10)).toBe(0);
  });

  it('10000件 (最大ランク) は 100%', () => {
    expect(getProgressToNextRank(10000)).toBe(100);
  });

  it('99999件も 100%', () => {
    expect(getProgressToNextRank(99999)).toBe(100);
  });
});
