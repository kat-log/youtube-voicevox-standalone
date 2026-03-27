import type { ExtensionState, CommentQueueItem, AudioQueueItem } from '@/types/state';

export const ERROR_THRESHOLD_FOR_STATUS = 3;
export const MAX_COMMENT_QUEUE = 200;
export const MAX_AUDIO_QUEUE = 50;

const state: ExtensionState = {
  audioQueue: [],
  playingCount: 0,
  playingTimeouts: new Map(),
  currentStatus: 'idle',
  liveChatId: null,
  intervalId: null,
  nextPageToken: null,
  commentQueue: [],
  latestTimestamp: null,
  latestOnlyMode: false,
  latestOnlyCount: 3,
  activeTabId: null,
  consecutiveErrors: 0,
  pollingIntervalMs: 5000,
  commentCount: 0,
  sessionId: 0,
  pollingCycleCount: 0,
  isRushActive: false,
  isYouTubeRateLimited: false,
};

export function getState(): ExtensionState {
  return state;
}

export function updateState(updates: Partial<ExtensionState>): void {
  Object.assign(state, updates);
}

export function resetState(): void {
  state.audioQueue = [];
  state.commentQueue = [];
  state.playingCount = 0;
  clearAllPlayingTimeouts();
  state.liveChatId = null;
  state.nextPageToken = null;
  state.latestTimestamp = null;
  state.commentCount = 0;
  state.currentStatus = 'idle';
  state.consecutiveErrors = 0;
  state.pollingIntervalMs = 5000;
  state.pollingCycleCount = 0;
  state.isRushActive = false;
  state.isYouTubeRateLimited = false;
}

export function incrementSessionId(): number {
  state.sessionId++;
  return state.sessionId;
}

// キュー操作
export function pushComment(item: CommentQueueItem): void {
  if (state.commentQueue.length >= MAX_COMMENT_QUEUE) {
    const discardCount = state.commentQueue.length - MAX_COMMENT_QUEUE + 1;
    state.commentQueue.splice(0, discardCount);
    // eslint-disable-next-line no-console
    console.warn(
      `commentQueue安全上限到達: ${discardCount}件の古いコメントを破棄 (上限: ${MAX_COMMENT_QUEUE})`
    );
  }
  state.commentQueue.push(item);
}

export function shiftComment(): CommentQueueItem | undefined {
  return state.commentQueue.shift();
}

export function unshiftComment(item: CommentQueueItem): void {
  state.commentQueue.unshift(item);
}

export function clearCommentQueue(keepCount = 1): CommentQueueItem[] {
  const kept = state.commentQueue.slice(-keepCount);
  state.commentQueue = [];
  return kept;
}

export function clearAudioQueue(): void {
  state.audioQueue = [];
}

export function pushAudio(item: AudioQueueItem): void {
  if (state.audioQueue.length >= MAX_AUDIO_QUEUE) {
    const discardCount = state.audioQueue.length - MAX_AUDIO_QUEUE + 1;
    state.audioQueue.splice(0, discardCount);
    // eslint-disable-next-line no-console
    console.warn(
      `audioQueue安全上限到達: ${discardCount}件の古い音声を破棄 (上限: ${MAX_AUDIO_QUEUE})`
    );
  }
  state.audioQueue.push(item);
}

export function shiftAudio(): AudioQueueItem | undefined {
  return state.audioQueue.shift();
}

export function unshiftAudio(item: AudioQueueItem): void {
  state.audioQueue.unshift(item);
}

// 再生カウント操作
export function incrementPlayingCount(): void {
  state.playingCount++;
}

export function decrementPlayingCount(): void {
  if (state.playingCount > 0) state.playingCount--;
}

// フェイルセーフタイムアウト操作（audioId単位）
export function setPlayingTimeout(audioId: string, timeout: ReturnType<typeof setTimeout>): void {
  state.playingTimeouts.set(audioId, timeout);
}

export function clearPlayingTimeout(audioId: string): void {
  const timeout = state.playingTimeouts.get(audioId);
  if (timeout) {
    clearTimeout(timeout);
    state.playingTimeouts.delete(audioId);
  }
}

export function clearAllPlayingTimeouts(): void {
  for (const timeout of state.playingTimeouts.values()) {
    clearTimeout(timeout);
  }
  state.playingTimeouts.clear();
}
