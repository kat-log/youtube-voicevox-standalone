/**
 * タイムラインの横軸スケール（ズーム）まわりの純粋ロジック。
 *
 * スケールは px/ms。既定は 0.01（= 10px/秒）で、これまでの固定値と同じ見え方になる。
 * 長い放送を俯瞰したい場合は縮小、1コメントの内訳を細かく見たい場合は拡大する。
 * DOM に触れない判定だけを持ち、実際のスクロール操作は timeline.ts が行う。
 */

/** 既定のスケール（px/ms）= 10px/秒 */
export const DEFAULT_SCALE = 0.01;
/** 最小スケール = 0.2px/秒（1時間がおよそ 720px に収まる） */
export const MIN_SCALE = 0.0002;
/** 最大スケール = 500px/秒（1コメントの内訳をミリ秒単位で見る用） */
export const MAX_SCALE = 0.5;
/** ズームボタン・ホイール1段あたりの倍率 */
export const ZOOM_FACTOR = 1.5;

/** 目盛りに使う「きりの良い」間隔（ms）。小さい順 */
export const TICK_INTERVALS_MS = [
  100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000,
  3600000,
];

/** 目盛りラベルが重ならないための最小間隔（px） */
export const MIN_TICK_PX = 60;

export function clampScale(value: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

/** 保存値をスケールとして正規化する。未設定・不正値は既定に戻す（設定リセット時など） */
export function normalizeScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? clampScale(value)
    : DEFAULT_SCALE;
}

/** steps 段だけ拡大（正）／縮小（負）したスケール */
export function zoomScale(current: number, steps: number): number {
  return clampScale(current * Math.pow(ZOOM_FACTOR, steps));
}

/** 表示中の拡大率（既定を 100% とした百分率） */
export function zoomPercent(scale: number): number {
  return Math.round((scale / DEFAULT_SCALE) * 100);
}

/** 全体（contentMs）が可視幅に収まるスケール */
export function fitScale(contentMs: number, visibleAxisWidth: number): number {
  if (contentMs <= 0 || visibleAxisWidth <= 0) return DEFAULT_SCALE;
  return clampScale(visibleAxisWidth / contentMs);
}

/** そのスケールで MIN_TICK_PX 以上の間隔になる、最小の「きりの良い」目盛り間隔（ms） */
export function chooseTickIntervalMs(scale: number): number {
  for (const interval of TICK_INTERVALS_MS) {
    if (interval * scale >= MIN_TICK_PX) return interval;
  }
  return TICK_INTERVALS_MS[TICK_INTERVALS_MS.length - 1];
}

/**
 * ズームの支点（アンカー）計算。
 *
 * 固定列は左端に貼り付いて可視領域を覆うため、可視の軸領域の左端は
 * コンテンツ座標 scrollLeft + 固定列幅、つまり時刻 scrollLeft / scale にあたる。
 * offsetPx は可視の軸領域の左端からの距離（px）。
 */
export function anchorMsAt(scrollLeft: number, offsetPx: number, scale: number): number {
  return (scrollLeft + offsetPx) / scale;
}

/** アンカーの時刻を同じ位置に留めるための scrollLeft（呼び出し側で範囲内に丸める） */
export function scrollLeftForAnchor(anchorMs: number, offsetPx: number, scale: number): number {
  return anchorMs * scale - offsetPx;
}
