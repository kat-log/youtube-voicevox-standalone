/**
 * ローカル VOICEVOX エンジンの /speaker_info から取得するキャラクターアイコンの補助関数。
 *
 * 権利面の方針: 画像は拡張機能に同梱しない。ユーザーの PC で動くローカル VOICEVOX から
 * 実行時に取得したときだけ表示する（ストア素材にも写さない）。
 */

export interface SpeakerInfoStyle {
  id: number;
  icon?: string | null;
  /** スタイル固有の立ち絵（エンジンによってはない） */
  portrait?: string | null;
}

export interface SpeakerInfoResponse {
  /** キャラクターの立ち絵 */
  portrait?: string | null;
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
 * 立ち絵を選ぶ。指定スタイル固有の立ち絵があればそれを、なければキャラクター共通の立ち絵を返す。
 */
export function pickPortrait(info: SpeakerInfoResponse, preferredStyleId?: number): string | null {
  if (preferredStyleId !== undefined && Array.isArray(info.style_infos)) {
    const preferred = info.style_infos.find((s) => s.id === preferredStyleId);
    const src = toIconSrc(preferred?.portrait);
    if (src) return src;
  }
  return toIconSrc(info.portrait);
}

/** 立ち絵の中で目のあたりが来る縦位置（画像の高さに対する割合）。立ち絵は頭が上端付近にある前提 */
export const PORTRAIT_EYE_RATIO = 0.2;
/** 立ち絵の最小表示高さ(px)。スタイルが少ない（表示領域が低い）ときはこの大きさで目元を切り出す */
export const PORTRAIT_MIN_HEIGHT = 420;
/** 表示領域の高さに対する立ち絵の表示高さの倍率（スタイルが多いときに顔〜上半身が収まる程度） */
export const PORTRAIT_HEIGHT_SCALE = 1.6;

export interface PortraitLayout {
  width: number;
  height: number;
  /** 表示領域上端からの位置（負の値で上にはみ出す） */
  top: number;
}

/**
 * スタイル一覧の背景に置く立ち絵の大きさと縦位置を決める。
 * - 表示領域が高い（スタイルが多い）: 頭を上端に合わせ、顔〜上半身が見えるように大きく出す
 * - 表示領域が低い（スタイルが少ない）: 目元が領域の縦中央に来るように切り出す
 * 両者は連続的に切り替わる（目元を中央に置こうとして上端が空く場合は上端に揃える）。
 */
export function computePortraitLayout(
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): PortraitLayout | null {
  if (!(containerHeight > 0 && naturalWidth > 0 && naturalHeight > 0)) return null;
  const height = Math.max(containerHeight * PORTRAIT_HEIGHT_SCALE, PORTRAIT_MIN_HEIGHT);
  const width = (height * naturalWidth) / naturalHeight;
  const eyeCentered = containerHeight / 2 - PORTRAIT_EYE_RATIO * height;
  // 上端より下には下げない（上に隙間を作らない）／下端より上には上げない（下に隙間を作らない）
  const top = Math.min(0, Math.max(containerHeight - height, eyeCentered));
  return { width, height, top };
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
