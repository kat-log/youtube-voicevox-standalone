/**
 * タイムラインの「最新への自動追従」まわりの純粋ロジック。
 *
 * 追従の解除・再開をスクロール位置だけから推測すると、自分が出した自動スクロールの
 * scroll イベントをユーザー操作と区別できず、追従が勝手に復活してしまう。
 * ここでは DOM に触れない判定だけを持ち、実際のスクロール操作は timeline.ts が行う。
 */

/** スクロール位置の書き手のモード。書き手を 1 つに保つための状態 */
export type ScrollMode = 'follow' | 'animate' | 'idle';

/** 端付近とみなす距離（px）。追従の再開判定に使う */
export const FOLLOW_THRESHOLD_PX = 40;

/** 行クリック時に中央へ寄せるアニメーションの長さ（ms） */
export const CENTER_ANIM_MS = 250;

/** 自分が書いた位置とみなす許容誤差（px）。端数・ズームの丸め対策 */
const OWN_SCROLL_TOLERANCE_PX = 1;

/** 端付近（＝ユーザーが最新に追いついた）かどうか */
export function shouldResumeFollow(distFromEdge: number): boolean {
  return distFromEdge < FOLLOW_THRESHOLD_PX;
}

/**
 * scroll イベントの発生源が自分の書き込みかどうか。
 * written が null（追従 OFF 直後など）なら、偶然の一致を避けるため常に false を返す。
 */
export function isOwnScrollPosition(current: number, written: number | null): boolean {
  if (written === null) return false;
  return Math.abs(current - written) <= OWN_SCROLL_TOLERANCE_PX;
}

/** 中央寄せアニメーションのイージング（終盤で減速する） */
export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}
