import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VOLUME_STEP_COUNT,
  formatVolume,
  normalizeVolumeStepCount,
  quantizeVolume,
  volumeStepSize,
} from './volume';

describe('normalizeVolumeStepCount', () => {
  it('有効な段階数はそのまま返す', () => {
    expect(normalizeVolumeStepCount(10)).toBe(10);
    expect(normalizeVolumeStepCount(20)).toBe(20);
    expect(normalizeVolumeStepCount(100)).toBe(100);
  });

  it('未設定・不正値はデフォルト（10段階）', () => {
    expect(normalizeVolumeStepCount(undefined)).toBe(DEFAULT_VOLUME_STEP_COUNT);
    expect(normalizeVolumeStepCount(50)).toBe(10);
    expect(normalizeVolumeStepCount('20')).toBe(10);
    expect(normalizeVolumeStepCount(null)).toBe(10);
  });
});

describe('volumeStepSize', () => {
  it('段階数に対応する step 値を返す', () => {
    expect(volumeStepSize(10)).toBeCloseTo(0.1);
    expect(volumeStepSize(20)).toBeCloseTo(0.05);
    expect(volumeStepSize(100)).toBeCloseTo(0.01);
  });
});

describe('quantizeVolume', () => {
  it('段階数のグリッドに丸める', () => {
    expect(quantizeVolume(0.07, 10)).toBe(0.1);
    expect(quantizeVolume(0.07, 20)).toBe(0.05);
    expect(quantizeVolume(0.07, 100)).toBe(0.07);
    expect(quantizeVolume(0.03, 10)).toBe(0);
  });

  it('0〜1 にクランプする', () => {
    expect(quantizeVolume(1.5, 10)).toBe(1);
    expect(quantizeVolume(-0.5, 10)).toBe(0);
  });

  it('数値でない場合は 1.0', () => {
    expect(quantizeVolume(NaN, 10)).toBe(1.0);
  });
});

describe('formatVolume', () => {
  it('10段階は小数1桁', () => {
    expect(formatVolume(1, 10)).toBe('1.0');
    expect(formatVolume(0.1, 10)).toBe('0.1');
  });

  it('20・100段階は小数2桁', () => {
    expect(formatVolume(0.05, 20)).toBe('0.05');
    expect(formatVolume(1, 100)).toBe('1.00');
    expect(formatVolume(0.01, 100)).toBe('0.01');
  });
});
