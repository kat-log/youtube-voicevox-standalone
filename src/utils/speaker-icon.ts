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
 * 立ち絵を選ぶ。キャラクター共通の立ち絵を優先し（目元の補正値はこれに合わせてある）、
 * なければ指定スタイル固有の立ち絵を返す。
 */
export function pickPortrait(info: SpeakerInfoResponse, preferredStyleId?: number): string | null {
  const common = toIconSrc(info.portrait);
  if (common) return common;
  if (preferredStyleId !== undefined && Array.isArray(info.style_infos)) {
    const preferred = info.style_infos.find((s) => s.id === preferredStyleId);
    return toIconSrc(preferred?.portrait);
  }
  return null;
}

/**
 * 顔の表示幅(px)。スタイルの数に関係なく全キャラでこの大きさにそろえる
 * （スタイルが多いキャラも少ないキャラも同じ倍率感で並ぶ）。
 */
export const PORTRAIT_FACE_DISPLAY_WIDTH = 80;
/** 拡大しすぎ防止（立ち絵は 500px 程度なので、これ以上はぼやける） */
export const PORTRAIT_MAX_SCALE = 2;

/** 立ち絵の中のキャラの範囲と顔の位置（画像サイズに対する割合） */
export interface PortraitFaceInfo {
  contentTop: number;
  contentBottom: number;
  eyeY: number;
  faceX: number;
  faceWidth: number;
}

export interface PortraitLayout {
  width: number;
  height: number;
  /** 表示領域上端からの位置（負の値で上にはみ出す） */
  top: number;
  /** 表示領域左端からの位置 */
  left: number;
}

/**
 * スタイル一覧の背景に置く立ち絵の大きさと位置を決める。
 * - 大きさ: 顔の幅が全キャラで PORTRAIT_FACE_DISPLAY_WIDTH になるようにする
 * - 横: 顔の中心を faceTargetX（スタイル名と試聴ボタンの間）に合わせる
 * - 縦: 目元を領域の縦中央に置く。ただしキャラの頭より上に余白ができる場合は頭を上端に揃える
 *   （スタイルが多い＝領域が高いキャラは頭から下が、少ないキャラは目元が見える）
 */
export function computePortraitLayout(params: {
  containerHeight: number;
  faceTargetX: number;
  naturalWidth: number;
  naturalHeight: number;
  face: PortraitFaceInfo;
}): PortraitLayout | null {
  const { containerHeight: c, faceTargetX, naturalWidth: w, naturalHeight: h, face } = params;
  if (!(c > 0 && w > 0 && h > 0)) return null;
  const facePx = Math.max(1, face.faceWidth * w);
  const scale = Math.min(PORTRAIT_MAX_SCALE, PORTRAIT_FACE_DISPLAY_WIDTH / facePx);
  const width = w * scale;
  const height = h * scale;
  const eyeCentered = c / 2 - face.eyeY * height;
  // キャラの頭より上に余白を作らない（キャラが領域より短い場合も頭を上端に揃える）
  const maxTop = -face.contentTop * height;
  const minTop = c - face.contentBottom * height;
  const top = Math.min(maxTop, Math.max(minTop, eyeCentered));
  const left = faceTargetX - face.faceX * width;
  return { width, height, top, left };
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
