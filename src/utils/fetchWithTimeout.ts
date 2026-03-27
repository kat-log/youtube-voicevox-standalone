/**
 * タイムアウト付き fetch ユーティリティ。
 * 指定した時間内に応答がなければ AbortError をスローする。
 */
export function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId)
  );
}
