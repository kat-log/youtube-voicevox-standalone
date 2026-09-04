import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_RANDOM_SPEED_CONFIG,
  getRandomSpeedConfig,
  isRandomSpeedEnabled,
  pickRandomSpeed,
  setRandomSpeedConfig,
} from './random-speed';

describe('random-speed', () => {
  beforeEach(() => {
    setRandomSpeedConfig({ ...DEFAULT_RANDOM_SPEED_CONFIG });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setRandomSpeedConfig', () => {
    it('設定値をそのまま保持する', () => {
      setRandomSpeedConfig({ enabled: true, minSpeed: 0.5, maxSpeed: 2.5 });
      expect(getRandomSpeedConfig()).toEqual({ enabled: true, minSpeed: 0.5, maxSpeed: 2.5 });
      expect(isRandomSpeedEnabled()).toBe(true);
    });

    it('下限と上限が逆転していたら入れ替える', () => {
      setRandomSpeedConfig({ enabled: true, minSpeed: 2.5, maxSpeed: 0.5 });
      expect(getRandomSpeedConfig()).toMatchObject({ minSpeed: 0.5, maxSpeed: 2.5 });
    });

    it('スライダーの範囲外の値は 0.1〜3.0 に丸める', () => {
      setRandomSpeedConfig({ enabled: true, minSpeed: -5, maxSpeed: 99 });
      expect(getRandomSpeedConfig()).toMatchObject({ minSpeed: 0.1, maxSpeed: 3.0 });
    });

    it('数値でない値が保存されていてもデフォルトへフォールバックする', () => {
      setRandomSpeedConfig({ enabled: true, minSpeed: NaN, maxSpeed: NaN });
      const config = getRandomSpeedConfig();
      expect(Number.isFinite(config.minSpeed)).toBe(true);
      expect(Number.isFinite(config.maxSpeed)).toBe(true);
    });
  });

  describe('pickRandomSpeed', () => {
    it('Math.random の下端では下限を返す', () => {
      setRandomSpeedConfig({ enabled: true, minSpeed: 0.8, maxSpeed: 1.5 });
      vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(pickRandomSpeed()).toBe(0.8);
    });

    it('Math.random の上端でも上限を超えない', () => {
      setRandomSpeedConfig({ enabled: true, minSpeed: 0.8, maxSpeed: 1.5 });
      vi.spyOn(Math, 'random').mockReturnValue(0.999999);
      expect(pickRandomSpeed()).toBe(1.5);
    });

    it('スライダーと同じ 0.1 刻みに丸める', () => {
      setRandomSpeedConfig({ enabled: true, minSpeed: 1.0, maxSpeed: 2.0 });
      vi.spyOn(Math, 'random').mockReturnValue(0.34);
      // 1.0 + 0.34 = 1.34 → 1.3
      expect(pickRandomSpeed()).toBe(1.3);
    });

    it('常に設定範囲内の値を返す', () => {
      setRandomSpeedConfig({ enabled: true, minSpeed: 0.5, maxSpeed: 2.0 });
      for (let i = 0; i < 200; i++) {
        const speed = pickRandomSpeed();
        expect(speed).toBeGreaterThanOrEqual(0.5);
        expect(speed).toBeLessThanOrEqual(2.0);
      }
    });

    it('下限と上限が同じなら常にその値を返す', () => {
      setRandomSpeedConfig({ enabled: true, minSpeed: 1.2, maxSpeed: 1.2 });
      expect(pickRandomSpeed()).toBe(1.2);
    });
  });
});
