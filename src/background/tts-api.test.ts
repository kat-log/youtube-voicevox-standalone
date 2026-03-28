import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitError } from './tts-api';

describe('RateLimitError', () => {
  it('retryAfter の値を保持する', () => {
    const error = new RateLimitError(10);
    expect(error.retryAfter).toBe(10);
  });

  it('name が "RateLimitError" である', () => {
    const error = new RateLimitError(5);
    expect(error.name).toBe('RateLimitError');
  });

  it('メッセージに retryAfter の秒数を含む', () => {
    const error = new RateLimitError(30);
    expect(error.message).toBe('Rate limited: retry after 30s');
  });

  it('Error のインスタンスである', () => {
    const error = new RateLimitError(5);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RateLimitError);
  });
});

// insertInOrder のテスト（モジュール依存をモック）
const pushedItems: Array<{ type: string; url?: string }> = [];

vi.mock('./state', () => ({
  getState: () => ({ audioQueue: [], commentQueue: [], sessionId: 1 }),
  shiftComment: () => undefined,
  pushAudio: (item: { type: string; url?: string }) => { pushedItems.push(item); },
  unshiftComment: () => {},
}));

vi.mock('./messaging', () => ({
  sendLog: () => {},
  logDebug: () => {},
  logInfo: () => {},
  logWarn: () => {},
  logError: () => {},
  sendDebugInfo: () => {},
  formatQueueState: () => '',
  sendStatus: () => {},
}));

vi.mock('./audio-player', () => ({
  playNextAudio: () => {},
  updateBadge: () => {},
}));

vi.mock('./rush-mode', () => ({
  evaluateRushMode: () => {},
}));

vi.mock('./parallel-playback', () => ({
  getEffectiveMaxConcurrent: () => 1,
  getParallelSpeakerId: (id?: string) => id,
  resetParallelSlotCounter: () => {},
}));

vi.mock('./speaker-names', () => ({
  getSpeakerName: () => 'test',
}));

vi.mock('./random-speaker', () => ({
  isRandomSpeakerEnabled: () => false,
  getRandomSpeakerId: () => null,
}));

describe('insertInOrder', () => {
  let insertInOrder: typeof import('./tts-api').insertInOrder;
  let cancelScheduledProcessing: typeof import('./tts-api').cancelScheduledProcessing;

  beforeEach(async () => {
    pushedItems.length = 0;
    const mod = await import('./tts-api');
    insertInOrder = mod.insertInOrder;
    cancelScheduledProcessing = mod.cancelScheduledProcessing;
    // シーケンス番号をリセット
    cancelScheduledProcessing();
  });

  it('順番通りに挿入するとすぐに pushAudio される', () => {
    insertInOrder(0, { type: 'url', url: 'a.wav' });
    insertInOrder(1, { type: 'url', url: 'b.wav' });
    insertInOrder(2, { type: 'url', url: 'c.wav' });

    expect(pushedItems).toHaveLength(3);
    expect(pushedItems[0].url).toBe('a.wav');
    expect(pushedItems[1].url).toBe('b.wav');
    expect(pushedItems[2].url).toBe('c.wav');
  });

  it('逆順に完了しても正しい順序で pushAudio される', () => {
    insertInOrder(2, { type: 'url', url: 'c.wav' });
    expect(pushedItems).toHaveLength(0); // seq=0 が未完了

    insertInOrder(1, { type: 'url', url: 'b.wav' });
    expect(pushedItems).toHaveLength(0); // まだ seq=0 待ち

    insertInOrder(0, { type: 'url', url: 'a.wav' });
    // seq=0,1,2 すべてフラッシュ
    expect(pushedItems).toHaveLength(3);
    expect(pushedItems[0].url).toBe('a.wav');
    expect(pushedItems[1].url).toBe('b.wav');
    expect(pushedItems[2].url).toBe('c.wav');
  });

  it('null（スキップ）で番号が進む', () => {
    insertInOrder(0, null); // seq=0 をスキップ
    insertInOrder(1, { type: 'url', url: 'b.wav' });

    expect(pushedItems).toHaveLength(1);
    expect(pushedItems[0].url).toBe('b.wav');
  });

  it('途中のスキップでも後続が正しくフラッシュされる', () => {
    insertInOrder(2, { type: 'url', url: 'c.wav' });
    insertInOrder(0, { type: 'url', url: 'a.wav' });
    expect(pushedItems).toHaveLength(1); // seq=0 のみ
    expect(pushedItems[0].url).toBe('a.wav');

    insertInOrder(1, null); // seq=1 スキップ → seq=2 もフラッシュ
    expect(pushedItems).toHaveLength(2);
    expect(pushedItems[1].url).toBe('c.wav');
  });
});
