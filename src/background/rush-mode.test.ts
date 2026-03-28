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
  evaluateRushMode,
  resolveEffectiveSpeed,
  getRushConfig,
  setRushConfig,
} from './rush-mode';

vi.mock('./messaging', () => ({
  sendStatus: vi.fn(),
  sendLog: vi.fn(),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  sendDebugInfo: vi.fn(),
}));

function makeComment(id: number): CommentQueueItem {
  return { apiKeyVOICEVOX: '', newMessage: `msg-${id}`, speed: 1, tabId: 1 };
}

function makeAudio(id: number): AudioQueueItem {
  return { type: 'url', url: `https://example.com/${id}.mp3` };
}

function fillQueues(commentCount: number, audioCount: number): void {
  for (let i = 0; i < commentCount; i++) pushComment(makeComment(i));
  for (let i = 0; i < audioCount; i++) pushAudio(makeAudio(i));
}

describe('rush-mode', () => {
  beforeEach(() => {
    resetState();
    setRushConfig({
      enabled: true,
      activateThreshold: 20,
      returnThreshold: 0,
      rushSpeed: 2.0,
    });
  });

  describe('getRushConfig / setRushConfig', () => {
    it('設定を取得・更新できる', () => {
      setRushConfig({
        enabled: false,
        activateThreshold: 50,
        returnThreshold: 5,
        rushSpeed: 3.0,
      });
      const config = getRushConfig();
      expect(config.enabled).toBe(false);
      expect(config.activateThreshold).toBe(50);
      expect(config.returnThreshold).toBe(5);
      expect(config.rushSpeed).toBe(3.0);
    });
  });

  describe('evaluateRushMode', () => {
    it('無効時は何もしない', () => {
      setRushConfig({
        enabled: false,
        activateThreshold: 20,
        returnThreshold: 0,
        rushSpeed: 2.0,
      });
      fillQueues(30, 0);
      evaluateRushMode();
      expect(getState().isRushActive).toBe(false);
    });

    it('無効化された時にアクティブ状態を解除する', () => {
      updateState({ isRushActive: true });
      setRushConfig({
        enabled: false,
        activateThreshold: 20,
        returnThreshold: 0,
        rushSpeed: 2.0,
      });
      evaluateRushMode();
      expect(getState().isRushActive).toBe(false);
    });

    it('待機数がしきい値以上でラッシュモードを発動する', () => {
      fillQueues(15, 5); // pending = 20, threshold = 20
      evaluateRushMode();
      expect(getState().isRushActive).toBe(true);
    });

    it('待機数がしきい値未満では発動しない', () => {
      fillQueues(10, 5); // pending = 15, threshold = 20
      evaluateRushMode();
      expect(getState().isRushActive).toBe(false);
    });

    it('commentQueue と audioQueue の合計で判定する', () => {
      fillQueues(0, 20); // audioQueue だけで 20
      evaluateRushMode();
      expect(getState().isRushActive).toBe(true);
    });

    it('アクティブ中に待機数が復帰しきい値以下で解除する', () => {
      updateState({ isRushActive: true });
      // returnThreshold = 0、キュー空 → pending = 0
      evaluateRushMode();
      expect(getState().isRushActive).toBe(false);
    });

    it('アクティブ中に待機数が復帰しきい値超なら維持する（ヒステリシス）', () => {
      setRushConfig({
        enabled: true,
        activateThreshold: 20,
        returnThreshold: 5,
        rushSpeed: 2.0,
      });
      updateState({ isRushActive: true });
      fillQueues(6, 0); // pending = 6 > returnThreshold = 5
      evaluateRushMode();
      expect(getState().isRushActive).toBe(true);
    });

    it('ヒステリシス: 発動しきい値と復帰しきい値の間では状態を維持する', () => {
      setRushConfig({
        enabled: true,
        activateThreshold: 20,
        returnThreshold: 5,
        rushSpeed: 2.0,
      });
      // 非アクティブで pending=10 → 発動しきい値(20)未満なので発動しない
      fillQueues(10, 0);
      evaluateRushMode();
      expect(getState().isRushActive).toBe(false);

      // アクティブ状態を手動設定し pending=10 → 復帰しきい値(5)超なので解除しない
      updateState({ isRushActive: true });
      evaluateRushMode();
      expect(getState().isRushActive).toBe(true);
    });
  });

  describe('resolveEffectiveSpeed', () => {
    it('ラッシュモード非アクティブ時は baseSpeed を返す', () => {
      expect(resolveEffectiveSpeed(1.5)).toBe(1.5);
    });

    it('ラッシュモード有効かつアクティブ時は rushSpeed を返す', () => {
      updateState({ isRushActive: true });
      expect(resolveEffectiveSpeed(1.0)).toBe(2.0);
    });

    it('isRushActive でも設定が無効なら baseSpeed を返す', () => {
      updateState({ isRushActive: true });
      setRushConfig({
        enabled: false,
        activateThreshold: 20,
        returnThreshold: 0,
        rushSpeed: 2.0,
      });
      expect(resolveEffectiveSpeed(1.0)).toBe(1.0);
    });
  });
});
