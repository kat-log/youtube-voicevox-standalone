import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getState,
  resetState,
  updateState,
  pushComment,
  pushAudio,
} from './state';
import type { CommentQueueItem, AudioQueueItem } from '@/types/state';
import {
  evaluateAutoCatchUp,
  getAutoCatchUpConfig,
  setAutoCatchUpConfig,
} from './auto-catchup';

vi.mock('./messaging', () => ({
  sendDebugInfo: vi.fn(),
  formatQueueState: vi.fn(() => '[音声生成待ち:0, 再生待ち:0, 再生中:0]'),
}));

function makeComment(id: number): CommentQueueItem {
  return { apiKeyVOICEVOX: '', newMessage: `msg-${id}`, speed: 1, tabId: 1 };
}

function makeAudio(id: number): AudioQueueItem {
  return { type: 'url', url: `https://example.com/${id}.mp3` };
}

describe('auto-catchup', () => {
  beforeEach(() => {
    resetState();
    setAutoCatchUpConfig({ enabled: true, threshold: 50 });
    updateState({ latestOnlyMode: true, latestOnlyCount: 3 });
  });

  describe('getAutoCatchUpConfig / setAutoCatchUpConfig', () => {
    it('設定を取得・更新できる', () => {
      setAutoCatchUpConfig({ enabled: false, threshold: 100 });
      const config = getAutoCatchUpConfig();
      expect(config.enabled).toBe(false);
      expect(config.threshold).toBe(100);
    });
  });

  describe('evaluateAutoCatchUp', () => {
    it('無効時は false を返す', () => {
      setAutoCatchUpConfig({ enabled: false, threshold: 50 });
      for (let i = 0; i < 60; i++) pushComment(makeComment(i));
      expect(evaluateAutoCatchUp()).toBe(false);
    });

    it('latestOnlyMode が OFF なら false を返す', () => {
      updateState({ latestOnlyMode: false });
      for (let i = 0; i < 60; i++) pushComment(makeComment(i));
      expect(evaluateAutoCatchUp()).toBe(false);
    });

    it('待機数がしきい値未満なら false を返す', () => {
      for (let i = 0; i < 40; i++) pushComment(makeComment(i));
      expect(evaluateAutoCatchUp()).toBe(false);
      expect(getState().commentQueue.length).toBe(40);
    });

    it('しきい値以上でフラッシュし true を返す', () => {
      for (let i = 0; i < 50; i++) pushComment(makeComment(i));
      const result = evaluateAutoCatchUp();
      expect(result).toBe(true);
      // latestOnlyCount=3 → 最新3件だけ残る
      expect(getState().commentQueue.length).toBe(3);
    });

    it('フラッシュ後は最新のコメントが保持される', () => {
      for (let i = 0; i < 50; i++) pushComment(makeComment(i));
      evaluateAutoCatchUp();
      const messages = getState().commentQueue.map((c) => c.newMessage);
      expect(messages).toEqual(['msg-47', 'msg-48', 'msg-49']);
    });

    it('audioQueue もクリアされる', () => {
      for (let i = 0; i < 30; i++) pushComment(makeComment(i));
      for (let i = 0; i < 20; i++) pushAudio(makeAudio(i));
      // pending = 50
      evaluateAutoCatchUp();
      expect(getState().audioQueue.length).toBe(0);
    });

    it('commentQueue と audioQueue の合計でしきい値を判定する', () => {
      for (let i = 0; i < 20; i++) pushComment(makeComment(i));
      for (let i = 0; i < 30; i++) pushAudio(makeAudio(i));
      // pending = 50 >= threshold
      const result = evaluateAutoCatchUp();
      expect(result).toBe(true);
    });

    it('latestOnlyCount に応じた件数を保持する', () => {
      updateState({ latestOnlyCount: 5 });
      for (let i = 0; i < 60; i++) pushComment(makeComment(i));
      evaluateAutoCatchUp();
      expect(getState().commentQueue.length).toBe(5);
      expect(getState().commentQueue[0].newMessage).toBe('msg-55');
    });

    it('しきい値ちょうどでもフラッシュする（境界値）', () => {
      // commentQueue=50, audioQueue=0 → pending=50 = threshold
      for (let i = 0; i < 50; i++) pushComment(makeComment(i));
      expect(evaluateAutoCatchUp()).toBe(true);
    });

    it('しきい値-1ではフラッシュしない（境界値）', () => {
      for (let i = 0; i < 49; i++) pushComment(makeComment(i));
      expect(evaluateAutoCatchUp()).toBe(false);
      expect(getState().commentQueue.length).toBe(49);
    });
  });
});
