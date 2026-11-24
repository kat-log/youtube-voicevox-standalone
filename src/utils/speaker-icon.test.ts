import { describe, it, expect } from 'vitest';
import {
  toIconSrc,
  pickStyleIcon,
  pickPortrait,
  computePortraitLayout,
  createCachedLimitedLoader,
  PORTRAIT_FACE_DISPLAY_WIDTH,
} from './speaker-icon';

describe('toIconSrc', () => {
  it('URL はそのまま返す', () => {
    expect(toIconSrc('http://localhost:50021/_resources/abc')).toBe('http://localhost:50021/_resources/abc');
    expect(toIconSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
  });

  it('base64 は data URL に変換する', () => {
    expect(toIconSrc('iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('data URL はそのまま返す', () => {
    expect(toIconSrc('data:image/png;base64,xx')).toBe('data:image/png;base64,xx');
  });

  it('空・null・非文字列は null', () => {
    expect(toIconSrc('')).toBeNull();
    expect(toIconSrc('   ')).toBeNull();
    expect(toIconSrc(null)).toBeNull();
    expect(toIconSrc(undefined)).toBeNull();
  });
});

describe('pickStyleIcon', () => {
  const info = {
    style_infos: [
      { id: 2, icon: 'http://h/_resources/a' },
      { id: 3, icon: 'http://h/_resources/b' },
    ],
  };

  it('指定スタイルのアイコンを優先する', () => {
    expect(pickStyleIcon(info, 3)).toBe('http://h/_resources/b');
  });

  it('指定スタイルがなければ最初のアイコン', () => {
    expect(pickStyleIcon(info, 99)).toBe('http://h/_resources/a');
    expect(pickStyleIcon(info)).toBe('http://h/_resources/a');
  });

  it('指定スタイルのアイコンが空なら他のアイコンを使う', () => {
    expect(pickStyleIcon({ style_infos: [{ id: 1, icon: '' }, { id: 2, icon: 'x' }] }, 1)).toBe(
      'data:image/png;base64,x',
    );
  });

  it('style_infos がなければ null', () => {
    expect(pickStyleIcon({})).toBeNull();
    expect(pickStyleIcon({ style_infos: [] })).toBeNull();
  });
});

describe('createCachedLimitedLoader', () => {
  it('同時実行数を制限する', async () => {
    let active = 0;
    let maxActive = 0;
    const load = createCachedLimitedLoader(async (key) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return key;
    }, 2);

    const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k) => load(k)));
    expect(results).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(maxActive).toBe(2);
  });

  it('同じキーはキャッシュし、再取得しない', async () => {
    let calls = 0;
    const load = createCachedLimitedLoader(async (key) => {
      calls++;
      return `v-${key}`;
    }, 3);
    expect(await load('a')).toBe('v-a');
    expect(await load('a')).toBe('v-a');
    expect(calls).toBe(1);
  });

  it('失敗は null としてキャッシュし、再リクエストしない', async () => {
    let calls = 0;
    const load = createCachedLimitedLoader(async () => {
      calls++;
      throw new Error('fail');
    }, 1);
    expect(await load('a')).toBeNull();
    expect(await load('a')).toBeNull();
    expect(calls).toBe(1);
  });

  it('失敗しても後続のリクエストは進む', async () => {
    const load = createCachedLimitedLoader(async (key) => {
      if (key === 'bad') throw new Error('fail');
      return key;
    }, 1);
    const results = await Promise.all([load('bad'), load('ok1'), load('ok2')]);
    expect(results).toEqual([null, 'ok1', 'ok2']);
  });
});

describe('pickPortrait', () => {
  it('キャラ共通の立ち絵を優先し、なければスタイル固有の立ち絵', () => {
    const info = { portrait: 'http://h/p', style_infos: [{ id: 1, portrait: 'http://h/p1' }] };
    expect(pickPortrait(info, 1)).toBe('http://h/p');
    expect(pickPortrait({ style_infos: [{ id: 1, portrait: 'http://h/p1' }] }, 1)).toBe('http://h/p1');
  });

  it('立ち絵がなければ null', () => {
    expect(pickPortrait({ style_infos: [{ id: 1, icon: 'x' }] }, 1)).toBeNull();
  });
});

describe('computePortraitLayout', () => {
  const face = { contentTop: 0.05, contentBottom: 0.95, eyeY: 0.2, faceX: 0.5, faceWidth: 0.2 };
  const base = { faceTargetX: 300, naturalWidth: 500, naturalHeight: 1000, face };

  it('表示領域が低いときは顔を十分な大きさにして目元を縦中央に置く', () => {
    const l = computePortraitLayout({ ...base, containerHeight: 40, naturalWidth: 1000, naturalHeight: 2000 })!;
    expect(l.width * face.faceWidth).toBeCloseTo(PORTRAIT_FACE_DISPLAY_WIDTH);
    expect(l.top + face.eyeY * l.height).toBeCloseTo(20);
  });

  it('表示領域が高いときはキャラの上端を領域の上端に揃える', () => {
    const l = computePortraitLayout({ ...base, containerHeight: 400 })!;
    expect(l.top).toBeCloseTo(-face.contentTop * l.height);
    expect((face.contentBottom - face.contentTop) * l.height).toBeGreaterThanOrEqual(400);
  });

  it('顔の中心を faceTargetX に合わせる', () => {
    const l = computePortraitLayout({ ...base, containerHeight: 100 })!;
    expect(l.left + face.faceX * l.width).toBeCloseTo(300);
  });

  it('不正な値なら null', () => {
    expect(computePortraitLayout({ ...base, containerHeight: 0 })).toBeNull();
    expect(computePortraitLayout({ ...base, containerHeight: 100, naturalWidth: 0 })).toBeNull();
  });
});
