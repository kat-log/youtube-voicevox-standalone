import { describe, it, expect } from 'vitest';
import { RANDOM_SPEAKER_SENTINEL, stripRandomSentinel } from './state';

describe('stripRandomSentinel', () => {
  it('センチネル値は undefined になる（API に渡してはいけない）', () => {
    expect(stripRandomSentinel(RANDOM_SPEAKER_SENTINEL)).toBeUndefined();
    expect(stripRandomSentinel('__random__')).toBeUndefined();
  });

  it('通常の話者IDはそのまま返す', () => {
    expect(stripRandomSentinel('1')).toBe('1');
    expect(stripRandomSentinel('47')).toBe('47');
    expect(stripRandomSentinel('Kyoko')).toBe('Kyoko');
  });

  it('未設定・空文字は undefined になる（呼び出し側のデフォルトに委ねる）', () => {
    expect(stripRandomSentinel(undefined)).toBeUndefined();
    expect(stripRandomSentinel(null)).toBeUndefined();
    expect(stripRandomSentinel('')).toBeUndefined();
  });
});
