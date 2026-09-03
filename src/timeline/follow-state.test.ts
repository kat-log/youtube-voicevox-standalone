import { describe, it, expect } from 'vitest';
import {
  FOLLOW_THRESHOLD_PX,
  shouldResumeFollow,
  isOwnScrollPosition,
  easeOutCubic,
} from './follow-state';

describe('shouldResumeFollow', () => {
  it('端に到達していれば追従を再開する', () => {
    expect(shouldResumeFollow(0)).toBe(true);
  });

  it('しきい値未満なら追従を再開する', () => {
    expect(shouldResumeFollow(FOLLOW_THRESHOLD_PX - 1)).toBe(true);
  });

  it('しきい値以上なら追従しない', () => {
    expect(shouldResumeFollow(FOLLOW_THRESHOLD_PX)).toBe(false);
    expect(shouldResumeFollow(FOLLOW_THRESHOLD_PX + 1)).toBe(false);
  });
});

describe('isOwnScrollPosition', () => {
  it('自分が書いた位置と一致すれば true', () => {
    expect(isOwnScrollPosition(1200, 1200)).toBe(true);
  });

  it('丸め誤差の範囲なら true', () => {
    expect(isOwnScrollPosition(1200.5, 1200)).toBe(true);
    expect(isOwnScrollPosition(1199.5, 1200)).toBe(true);
  });

  it('大きくずれていればユーザー操作とみなす', () => {
    expect(isOwnScrollPosition(1100, 1200)).toBe(false);
  });

  it('書き込み位置が無効化されていれば常に false', () => {
    // 追従 OFF 直後は古い値との偶然の一致で誤判定しないよう null にする
    expect(isOwnScrollPosition(1200, null)).toBe(false);
  });
});

describe('easeOutCubic', () => {
  it('始点と終点が 0/1 になる', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('単調増加する', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const value = easeOutCubic(i / 10);
      expect(value).toBeGreaterThan(prev);
      prev = value;
    }
  });

  it('範囲外の入力は 0..1 に丸める', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});
