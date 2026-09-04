import { describe, it, expect } from 'vitest';
import { formatDuration, formatRulerLabel, normalizeTimeUnit } from './format';

describe('formatDuration', () => {
  it('秒表示は小数2桁にする', () => {
    expect(formatDuration(2350, 'sec')).toBe('2.35秒');
    expect(formatDuration(0, 'sec')).toBe('0.00秒');
    expect(formatDuration(40, 'sec')).toBe('0.04秒');
  });

  it('60秒以上は分に繰り上げる', () => {
    expect(formatDuration(62350, 'sec')).toBe('1分02.35秒');
    expect(formatDuration(60000, 'sec')).toBe('1分00.00秒');
  });

  it('ms 表示は整数のミリ秒にする', () => {
    expect(formatDuration(2350, 'ms')).toBe('2350ms');
    expect(formatDuration(2350.4, 'ms')).toBe('2350ms');
  });

  it('負値でも符号を保つ', () => {
    expect(formatDuration(-120, 'sec')).toBe('-0.12秒');
  });

  it('数値でない場合はプレースホルダを返す', () => {
    expect(formatDuration(NaN, 'sec')).toBe('-');
    expect(formatDuration(Infinity, 'ms')).toBe('-');
  });
});

describe('normalizeTimeUnit', () => {
  it('保存値をそのまま使う', () => {
    expect(normalizeTimeUnit('ms')).toBe('ms');
    expect(normalizeTimeUnit('sec')).toBe('sec');
  });

  it('未設定・不正値は秒に戻す', () => {
    expect(normalizeTimeUnit(undefined)).toBe('sec');
    expect(normalizeTimeUnit('minutes')).toBe('sec');
    expect(normalizeTimeUnit(1)).toBe('sec');
  });
});

describe('formatRulerLabel', () => {
  it('60秒未満は秒で表す', () => {
    expect(formatRulerLabel(0, 5000)).toBe('0s');
    expect(formatRulerLabel(15000, 5000)).toBe('15s');
  });

  it('60秒以上は分:秒で表す', () => {
    expect(formatRulerLabel(60000, 5000)).toBe('1:00');
    expect(formatRulerLabel(75000, 5000)).toBe('1:15');
    expect(formatRulerLabel(3675000, 30000)).toBe('61:15');
  });

  it('目盛り間隔が1秒未満なら小数1桁まで出す', () => {
    expect(formatRulerLabel(1500, 500)).toBe('1.5s');
    expect(formatRulerLabel(61500, 500)).toBe('1:01.5');
  });
});
