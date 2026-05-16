import { getState } from './state';

export interface CommentLifecycle {
  id: string;
  text: string;
  fetchTime: number;
  synthStartTime?: number;
  synthEndTime?: number;
  playStartTime?: number;
  playEndTime?: number;
  droppedTime?: number;
}

export interface TimelineStatus {
  pendingSynth: number;
  activeSynth: number;
  pendingPlay: number;
  activePlaying: number;
}

const MAX_COMPLETED = 200;

const lifecycles = new Map<string, CommentLifecycle>();
const audioIdToLifecycleId = new Map<string, string>();
const completedOrder: string[] = [];

// tts-api.ts の ttsProcessingCount を循環依存なしに参照するためのコールバック
let getActiveSynth: () => number = () => 0;
export function setActiveSynthGetter(fn: () => number): void {
  getActiveSynth = fn;
}

export function trackFetch(id: string, text: string, fetchTime: number): void {
  lifecycles.set(id, { id, text: text.slice(0, 30), fetchTime });
  broadcastUpdate(id);
  broadcastStatus();
}

export function trackSynthStart(id: string | undefined): void {
  if (!id) return;
  const lc = lifecycles.get(id);
  if (!lc) return;
  lc.synthStartTime = Date.now();
  broadcastUpdate(id);
  broadcastStatus();
}

export function trackSynthEnd(id: string | undefined): void {
  if (!id) return;
  const lc = lifecycles.get(id);
  if (!lc) return;
  lc.synthEndTime = Date.now();
  broadcastUpdate(id);
  broadcastStatus();
}

export function trackPlayStart(id: string | undefined, audioId: string): void {
  if (!id) return;
  const lc = lifecycles.get(id);
  if (!lc) return;
  lc.playStartTime = Date.now();
  audioIdToLifecycleId.set(audioId, id);
  broadcastUpdate(id);
  broadcastStatus();
}

export function trackDrop(id: string): void {
  const lc = lifecycles.get(id);
  if (!lc || lc.synthStartTime) return;
  lc.droppedTime = Date.now();
  broadcastUpdate(id);
}

export function trackPlayEnd(audioId: string): void {
  const id = audioIdToLifecycleId.get(audioId);
  if (!id) return;
  audioIdToLifecycleId.delete(audioId);
  const lc = lifecycles.get(id);
  if (!lc) return;
  lc.playEndTime = Date.now();
  broadcastUpdate(id);
  broadcastStatus();
  completedOrder.push(id);
  while (completedOrder.length > MAX_COMPLETED) {
    const evictId = completedOrder.shift()!;
    lifecycles.delete(evictId);
  }
}

export function getAllLifecycles(): CommentLifecycle[] {
  return Array.from(lifecycles.values());
}

export function broadcastStatus(): void {
  const state = getState();
  const status: TimelineStatus = {
    pendingSynth: state.commentQueue.length,
    activeSynth: getActiveSynth(),
    pendingPlay: state.audioQueue.length,
    activePlaying: state.playingCount,
  };
  chrome.runtime.sendMessage({ action: 'timelineStatusUpdate', status }).catch(() => {});
}

function broadcastUpdate(id: string): void {
  const lc = lifecycles.get(id);
  if (!lc) return;
  chrome.runtime.sendMessage({ action: 'timelineUpdate', lifecycle: lc }).catch(() => {});
}
