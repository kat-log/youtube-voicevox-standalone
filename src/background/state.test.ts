import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommentQueueItem, AudioQueueItem } from '@/types/state';
import {
  getState,
  resetState,
  pushComment,
  pushAudio,
  unshiftComment,
  unshiftAudio,
  MAX_COMMENT_QUEUE,
  MAX_AUDIO_QUEUE,
} from './state';

function makeComment(id: number): CommentQueueItem {
  return {
    apiKeyVOICEVOX: '',
    newMessage: `msg-${id}`,
    speed: 1,
    tabId: 1,
  };
}

function makeAudio(id: number): AudioQueueItem {
  return { type: 'url', url: `https://example.com/${id}.mp3` };
}

describe('commentQueue サイズ上限', () => {
  beforeEach(() => {
    resetState();
    vi.restoreAllMocks();
  });

  it('上限未満では全件保持される', () => {
    for (let i = 0; i < 10; i++) {
      pushComment(makeComment(i));
    }
    expect(getState().commentQueue.length).toBe(10);
  });

  it('上限到達時に古いコメントが破棄される', () => {
    for (let i = 0; i < MAX_COMMENT_QUEUE; i++) {
      pushComment(makeComment(i));
    }
    expect(getState().commentQueue.length).toBe(MAX_COMMENT_QUEUE);

    // 上限を超える1件を追加
    pushComment(makeComment(999));
    expect(getState().commentQueue.length).toBe(MAX_COMMENT_QUEUE);
    // 最も古い msg-0 が破棄され、最新の msg-999 が末尾にある
    expect(getState().commentQueue[0].newMessage).toBe('msg-1');
    expect(getState().commentQueue[MAX_COMMENT_QUEUE - 1].newMessage).toBe('msg-999');
  });

  it('上限到達時に console.warn が呼ばれる', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < MAX_COMMENT_QUEUE; i++) {
      pushComment(makeComment(i));
    }
    expect(warnSpy).not.toHaveBeenCalled();

    pushComment(makeComment(999));
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('commentQueue安全上限到達');
  });

  it('上限未満では console.warn が呼ばれない', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 5; i++) {
      pushComment(makeComment(i));
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('unshiftComment は上限を超えてもそのまま挿入する', () => {
    for (let i = 0; i < MAX_COMMENT_QUEUE; i++) {
      pushComment(makeComment(i));
    }
    unshiftComment(makeComment(999));
    // MAX + 1 を許容
    expect(getState().commentQueue.length).toBe(MAX_COMMENT_QUEUE + 1);
  });
});

describe('audioQueue サイズ上限', () => {
  beforeEach(() => {
    resetState();
    vi.restoreAllMocks();
  });

  it('上限未満では全件保持される', () => {
    for (let i = 0; i < 10; i++) {
      pushAudio(makeAudio(i));
    }
    expect(getState().audioQueue.length).toBe(10);
  });

  it('上限到達時に古い音声が破棄される', () => {
    for (let i = 0; i < MAX_AUDIO_QUEUE; i++) {
      pushAudio(makeAudio(i));
    }
    expect(getState().audioQueue.length).toBe(MAX_AUDIO_QUEUE);

    pushAudio(makeAudio(999));
    expect(getState().audioQueue.length).toBe(MAX_AUDIO_QUEUE);
    expect(getState().audioQueue[0].url).toBe('https://example.com/1.mp3');
    expect(getState().audioQueue[MAX_AUDIO_QUEUE - 1].url).toBe('https://example.com/999.mp3');
  });

  it('上限到達時に console.warn が呼ばれる', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < MAX_AUDIO_QUEUE; i++) {
      pushAudio(makeAudio(i));
    }
    expect(warnSpy).not.toHaveBeenCalled();

    pushAudio(makeAudio(999));
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('audioQueue安全上限到達');
  });

  it('unshiftAudio は上限を超えてもそのまま挿入する', () => {
    for (let i = 0; i < MAX_AUDIO_QUEUE; i++) {
      pushAudio(makeAudio(i));
    }
    unshiftAudio(makeAudio(999));
    expect(getState().audioQueue.length).toBe(MAX_AUDIO_QUEUE + 1);
  });
});
