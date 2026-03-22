import type { ExtensionState, CommentQueueItem, AudioQueueItem } from '@/types/state';

export const ERROR_THRESHOLD_FOR_STATUS = 3;

const state: ExtensionState = {
  audioQueue: [],
  isPlaying: false,
  currentStatus: 'idle',
  liveChatId: null,
  intervalId: null,
  nextPageToken: null,
  commentQueue: [],
  latestTimestamp: null,
  latestOnlyMode: false,
  latestOnlyCount: 3,
  activeTabId: null,
  playingTimeout: null,
  consecutiveErrors: 0,
  pollingIntervalMs: 5000,
  commentCount: 0,
  sessionId: 0,
  pollingCycleCount: 0,
  isRushActive: false,
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
  state.isPlaying = false;
  state.liveChatId = null;
  state.nextPageToken = null;
  state.latestTimestamp = null;
  state.commentCount = 0;
  state.currentStatus = 'idle';
  state.consecutiveErrors = 0;
  state.pollingIntervalMs = 5000;
  state.pollingCycleCount = 0;
  state.isRushActive = false;
}

export function incrementSessionId(): number {
  state.sessionId++;
  return state.sessionId;
}

// キュー操作
export function pushComment(item: CommentQueueItem): void {
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
  state.audioQueue.push(item);
}

export function shiftAudio(): AudioQueueItem | undefined {
  return state.audioQueue.shift();
}
