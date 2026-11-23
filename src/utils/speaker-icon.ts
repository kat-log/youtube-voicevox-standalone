/**
 * ローカル VOICEVOX エンジンの /speaker_info から取得するキャラクターアイコンの補助関数。
 *
 * 権利面の方針: 画像は拡張機能に同梱しない。ユーザーの PC で動くローカル VOICEVOX から
 * 実行時に取得したときだけ表示する（ストア素材にも写さない）。
 */

export interface SpeakerInfoStyle {
  id: number;
  icon?: string | null;
}

export interface SpeakerInfoResponse {
  style_infos?: SpeakerInfoStyle[];
}

/**
 * /speaker_info の icon 値を <img src> に使える文字列へ変換する。
 * resource_format=url 対応エンジンは URL を、未対応（古い）エンジンは base64 を返すため両対応する。
 */
export function toIconSrc(icon: string | null | undefined): string | null {
  if (typeof icon !== 'string') return null;
  const trimmed = icon.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('data:')) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

/**
 * 指定スタイル ID のアイコンを優先して選び、なければ最初に見つかったアイコンを返す。
 */
export function pickStyleIcon(info: SpeakerInfoResponse, preferredStyleId?: number): string | null {
  const styles = Array.isArray(info.style_infos) ? info.style_infos : [];
  if (preferredStyleId !== undefined) {
    const preferred = styles.find((s) => s.id === preferredStyleId);
    const src = toIconSrc(preferred?.icon);
    if (src) return src;
  }
  for (const s of styles) {
    const src = toIconSrc(s.icon);
    if (src) return src;
  }
  return null;
}

/**
 * 同時実行数を制限し、結果（失敗も含む）をキーごとにキャッシュするローダーを作る。
 * キャラ数ぶんのリクエストが一気にエンジンへ飛ばないようにするためのもの。
 */
export function createCachedLimitedLoader<T>(
  fetcher: (key: string) => Promise<T | null>,
  concurrency: number,
): (key: string) => Promise<T | null> {
  const limit = Math.max(1, Math.floor(concurrency));
  const cache = new Map<string, Promise<T | null>>();
  const waiting: Array<() => void> = [];
  let active = 0;

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };

  const release = (): void => {
    const next = waiting.shift();
    // 待ちがあれば枠をそのまま引き渡す（active は減らさない）
    if (next) next();
    else active--;
  };

  return (key: string) => {
    const cached = cache.get(key);
    if (cached) return cached;
    const promise = (async () => {
      await acquire();
      try {
        return await fetcher(key);
      } catch {
        return null;
      } finally {
        release();
      }
    })();
    cache.set(key, promise);
    return promise;
  };
}
