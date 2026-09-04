/**
 * タイムラインの時間表示フォーマット。
 *
 * 所要時間は既定で「秒（小数2桁）」で見せる。体感と結びつけやすいのは秒だが、
 * ミリ秒の生値で見たい場面（チューニングや不具合調査）もあるため単位を切り替えられる。
 * DOM に触れない純粋関数だけを置く。
 */

/** 所要時間の表示単位 */
export type TimeUnit = 'sec' | 'ms';

/** 単位の既定値。ギーク向けの ms ではなく、体感に近い秒を既定にする */
export const DEFAULT_TIME_UNIT: TimeUnit = 'sec';

/** 保存値を単位として正規化する。未設定・不正値は既定に戻す */
export function normalizeTimeUnit(value: unknown): TimeUnit {
  return value === 'ms' || value === 'sec' ? value : DEFAULT_TIME_UNIT;
}

/**
 * 所要時間を表示用文字列にする。
 * 秒表示は 2.35秒 のように小数2桁。60秒以上は 1分02.35秒 と分を繰り上げる
 */
export function formatDuration(ms: number, unit: TimeUnit): string {
  if (!Number.isFinite(ms)) return '-';
  if (unit === 'ms') return `${Math.round(ms)}ms`;

  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  if (abs < 60000) return `${sign}${(abs / 1000).toFixed(2)}秒`;

  const minutes = Math.floor(abs / 60000);
  const seconds = (abs - minutes * 60000) / 1000;
  return `${sign}${minutes}分${seconds.toFixed(2).padStart(5, '0')}秒`;
}

/**
 * 目盛りのラベル。経過時間そのものなので所要時間とは別の書式にする。
 * - 60秒未満: 15s
 * - 60秒以上: 1:15（長い放送でも桁が増えない）
 * 目盛り間隔が 1 秒未満のときだけ小数1桁まで出す
 */
export function formatRulerLabel(ms: number, intervalMs: number): string {
  const decimals = intervalMs < 1000 ? 1 : 0;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(decimals)}s`;

  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec - minutes * 60;
  // 0:05 のように秒は必ず2桁（小数がある場合は "05.5" で4桁）
  return `${minutes}:${seconds.toFixed(decimals).padStart(decimals > 0 ? 4 : 2, '0')}`;
}
