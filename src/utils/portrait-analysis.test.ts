import { describe, it, expect } from 'vitest';
import { analyzePortraitPixels, applyFaceHint, isSkinColor, PORTRAIT_FACE_HINTS } from './portrait-analysis';

function makeImage(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, rgba: [number, number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(rgba, (y * w + x) * 4);
  };
  return { data, fill };
}

const SKIN: [number, number, number, number] = [255, 235, 225, 255];
const CLOTH: [number, number, number, number] = [40, 60, 160, 255];

describe('isSkinColor', () => {
  it('淡いピンク〜ピーチを肌とみなし、白や髪色は除く', () => {
    expect(isSkinColor(255, 240, 240)).toBe(true);
    expect(isSkinColor(250, 220, 200)).toBe(true);
    expect(isSkinColor(255, 255, 255)).toBe(false);
    expect(isSkinColor(254, 150, 218)).toBe(false);
    expect(isSkinColor(120, 200, 90)).toBe(false);
  });
});

describe('analyzePortraitPixels', () => {
  it('完全に透明なら null', () => {
    const { data } = makeImage(10, 10);
    expect(analyzePortraitPixels(data, 10, 10)).toBeNull();
  });

  it('キャラの範囲と、上にある顔（肌色の塊）を見つける', () => {
    const { data, fill } = makeImage(100, 200);
    fill(20, 20, 80, 190, CLOTH); // 体
    fill(35, 30, 65, 55, SKIN); // 顔（上）
    fill(25, 120, 75, 180, SKIN); // 脚（顔より大きい）
    const a = analyzePortraitPixels(data, 100, 200)!;
    expect(a.faceFound).toBe(true);
    expect(a.contentTop).toBeCloseTo(0.1);
    expect(a.contentBottom).toBeCloseTo(0.95);
    expect(a.faceX).toBeCloseTo(0.5);
    expect(a.eyeY).toBeGreaterThan(0.15);
    expect(a.eyeY).toBeLessThan(0.28);
  });

  it('肌色がなければ外枠の上の方から推定する', () => {
    const { data, fill } = makeImage(100, 200);
    fill(20, 20, 80, 190, CLOTH);
    const a = analyzePortraitPixels(data, 100, 200)!;
    expect(a.faceFound).toBe(false);
    expect(a.eyeY).toBeGreaterThan(0.1);
    expect(a.eyeY).toBeLessThan(0.3);
  });
});

describe('applyFaceHint', () => {
  const base = {
    contentTop: 0, contentBottom: 1, contentLeft: 0, contentRight: 1,
    eyeY: 0.5, faceX: 0.5, faceWidth: 0.3, faceFound: false,
  };

  it('既知キャラは補正値で上書きし、範囲はそのまま', () => {
    const zundamon = '388f246b-8c41-4ac1-8e2d-5d79f3ff56d9';
    const a = applyFaceHint(base, zundamon);
    expect(a.eyeY).toBe(PORTRAIT_FACE_HINTS[zundamon].eyeY);
    expect(a.faceWidth).toBe(PORTRAIT_FACE_HINTS[zundamon].faceWidth);
    expect(a.contentBottom).toBe(1);
  });

  it('顔の幅だけの補正値なら目元は自動推定のまま', () => {
    const no7 = '044830d2-f23b-44d6-ac0d-b5d733caa900';
    expect(PORTRAIT_FACE_HINTS[no7].eyeY).toBeUndefined();
    const a = applyFaceHint(base, no7);
    expect(a.eyeY).toBe(base.eyeY);
    expect(a.faceWidth).toBe(PORTRAIT_FACE_HINTS[no7].faceWidth);
  });

  it('公式キャラ全員の顔の幅がそろえてある', () => {
    expect(Object.keys(PORTRAIT_FACE_HINTS)).toHaveLength(44);
    for (const hint of Object.values(PORTRAIT_FACE_HINTS)) expect(hint.faceWidth).toBeGreaterThan(0);
  });

  it('未知のキャラはそのまま', () => {
    expect(applyFaceHint(base, 'unknown')).toEqual(base);
    expect(applyFaceHint(base)).toEqual(base);
  });
});
