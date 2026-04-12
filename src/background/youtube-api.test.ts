import { describe, it, expect } from 'vitest';
import { extractVideoId } from './youtube-api';

describe('extractVideoId', () => {
  it('標準形式の URL から VIDEO_ID を取得', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('短縮 URL から VIDEO_ID を取得', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('追加パラメータ付き URL から VIDEO_ID を取得', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123')).toBe(
      'dQw4w9WgXcQ'
    );
  });

  it('/live/ 形式から VIDEO_ID を取得', () => {
    expect(extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('/live/ 形式 + クエリパラメータ付き URL から VIDEO_ID を取得', () => {
    expect(extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share')).toBe(
      'dQw4w9WgXcQ'
    );
  });

  it('不正な URL は null を返す', () => {
    expect(extractVideoId('not-a-url')).toBeNull();
  });

  it('空文字列は null を返す', () => {
    expect(extractVideoId('')).toBeNull();
  });

  it('v パラメータがない youtube.com URL は null を返す', () => {
    expect(extractVideoId('https://www.youtube.com/channel/UC1234')).toBeNull();
  });
});
