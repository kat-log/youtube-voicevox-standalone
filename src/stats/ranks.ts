export interface Rank {
  threshold: number;
  name: string;
  emoji: string;
  color: string;
}

export const RANKS: Rank[] = [
  { threshold: 0, name: '見習い配信リスナー', emoji: '🔰', color: '#94a3b8' },
  { threshold: 10, name: '駆け出しリスナー', emoji: '🌱', color: '#84cc16' },
  { threshold: 50, name: 'コメント読み師', emoji: '📖', color: '#22c55e' },
  { threshold: 100, name: '声の伝道師', emoji: '🗣️', color: '#14b8a6' },
  { threshold: 300, name: '読み上げ職人', emoji: '🛠️', color: '#3b82f6' },
  { threshold: 500, name: 'ずんだもんの友', emoji: '💚', color: '#8b5cf6' },
  { threshold: 1000, name: '配信の守護者', emoji: '🛡️', color: '#a855f7' },
  { threshold: 2000, name: '伝説のリスナー', emoji: '🌟', color: '#f59e0b' },
  { threshold: 5000, name: 'チャットの神', emoji: '👑', color: '#ef4444' },
  { threshold: 10000, name: '読み上げの覇王', emoji: '🐉', color: '#dc2626' },
];

export function getCurrentRank(count: number): Rank {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (count >= rank.threshold) {
      current = rank;
    } else {
      break;
    }
  }
  return current;
}

export function getNextRank(count: number): Rank | null {
  for (const rank of RANKS) {
    if (count < rank.threshold) {
      return rank;
    }
  }
  return null;
}

export function getProgressToNextRank(count: number): number {
  const current = getCurrentRank(count);
  const next = getNextRank(count);
  if (!next) return 100;
  const range = next.threshold - current.threshold;
  const progress = count - current.threshold;
  return Math.floor((progress / range) * 100);
}
