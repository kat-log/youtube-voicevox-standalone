import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  MIN_TICK_PX,
  ZOOM_FACTOR,
  anchorMsAt,
  chooseTickIntervalMs,
  clampScale,
  fitScale,
  normalizeScale,
  scrollLeftForAnchor,
  zoomPercent,
  zoomScale,
} from './scale';

describe('clampScale', () => {
  it('範囲内はそのまま返す', () => {
    expect(clampScale(DEFAULT_SCALE)).toBe(DEFAULT_SCALE);
  });

  it('範囲外は丸める', () => {
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(1000)).toBe(MAX_SCALE);
  });
});

describe('normalizeScale', () => {
  it('保存値を範囲内に丸めて使う', () => {
    expect(normalizeScale(0.02)).toBe(0.02);
    expect(normalizeScale(999)).toBe(MAX_SCALE);
  });

  it('未設定・不正値は既定に戻す', () => {
    expect(normalizeScale(undefined)).toBe(DEFAULT_SCALE);
    expect(normalizeScale('0.02')).toBe(DEFAULT_SCALE);
    expect(normalizeScale(0)).toBe(DEFAULT_SCALE);
    expect(normalizeScale(NaN)).toBe(DEFAULT_SCALE);
  });
});

describe('zoomScale', () => {
  it('1段の拡大・縮小は倍率どおり', () => {
    expect(zoomScale(DEFAULT_SCALE, 1)).toBeCloseTo(DEFAULT_SCALE * ZOOM_FACTOR, 10);
    expect(zoomScale(DEFAULT_SCALE, -1)).toBeCloseTo(DEFAULT_SCALE / ZOOM_FACTOR, 10);
  });

  it('上限・下限を越えない', () => {
    expect(zoomScale(MAX_SCALE, 5)).toBe(MAX_SCALE);
    expect(zoomScale(MIN_SCALE, -5)).toBe(MIN_SCALE);
  });
});

describe('zoomPercent', () => {
  it('既定を 100% とする', () => {
    expect(zoomPercent(DEFAULT_SCALE)).toBe(100);
    expect(zoomPercent(DEFAULT_SCALE * 2)).toBe(200);
  });
});

describe('fitScale', () => {
  it('全体が可視幅に収まるスケールを返す', () => {
    expect(fitScale(60000, 600)).toBeCloseTo(0.01, 10);
  });

  it('範囲外になる場合は丸める', () => {
    expect(fitScale(60 * 60 * 1000 * 10, 600)).toBe(MIN_SCALE);
    expect(fitScale(10, 600)).toBe(MAX_SCALE);
  });

  it('内容や幅が無い場合は既定に戻す', () => {
    expect(fitScale(0, 600)).toBe(DEFAULT_SCALE);
    expect(fitScale(60000, 0)).toBe(DEFAULT_SCALE);
  });
});

describe('chooseTickIntervalMs', () => {
  it('選ばれた間隔は最小間隔以上の幅を持つ', () => {
    for (const scale of [MIN_SCALE, 0.001, DEFAULT_SCALE, 0.1, MAX_SCALE]) {
      expect(chooseTickIntervalMs(scale) * scale).toBeGreaterThanOrEqual(MIN_TICK_PX);
    }
  });

  it('既定スケールでは10秒間隔になる', () => {
    expect(chooseTickIntervalMs(DEFAULT_SCALE)).toBe(10000);
  });

  it('拡大するほど細かい間隔になる', () => {
    expect(chooseTickIntervalMs(MAX_SCALE)).toBeLessThan(chooseTickIntervalMs(DEFAULT_SCALE));
    expect(chooseTickIntervalMs(MIN_SCALE)).toBeGreaterThan(chooseTickIntervalMs(DEFAULT_SCALE));
  });
});

describe('ズームのアンカー', () => {
  it('支点の時刻は拡大後も同じ位置に留まる', () => {
    const scrollLeft = 500;
    const offsetPx = 200;
    const anchor = anchorMsAt(scrollLeft, offsetPx, DEFAULT_SCALE);
    expect(anchor).toBe(70000);

    const zoomed = zoomScale(DEFAULT_SCALE, 1);
    const next = scrollLeftForAnchor(anchor, offsetPx, zoomed);
    expect(anchorMsAt(next, offsetPx, zoomed)).toBeCloseTo(anchor, 10);
  });
});
