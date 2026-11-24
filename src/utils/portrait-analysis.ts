/**
 * 立ち絵の画素から「キャラが描かれている範囲」と「顔（目元）の位置」を推定する。
 *
 * 立ち絵は画像ごとに余白・ポーズ・頭身がばらばらなので、固定の比率では目元を合わせられない。
 * そこで透明でない範囲（キャラの外枠）と、肌色の塊（顔）を探して位置を決める。
 * 推定はあくまで目安で、肌色が見つからない（ロボット等）場合は外枠から決め打ちで推定する。
 *
 * 座標はすべて画像サイズに対する割合（0〜1）で返す。
 */
export interface PortraitAnalysis {
  /** キャラが描かれている範囲（透明でない画素の外接矩形） */
  contentTop: number;
  contentBottom: number;
  contentLeft: number;
  contentRight: number;
  /** 目元の縦位置 */
  eyeY: number;
  /** 顔の中心の横位置 */
  faceX: number;
  /** 顔の幅（画像の幅に対する割合） */
  faceWidth: number;
  /** 肌色から顔を見つけられたか（false なら外枠からの推定） */
  faceFound: boolean;
}

const ALPHA_THRESHOLD = 32;

/** アニメ調の肌色（明るいピーチ系）か */
export function isSkinColor(r: number, g: number, b: number): boolean {
  // 白に近い淡いピンク（255,240,240 など）から、やや影のついたピーチ色までを肌とみなす
  return r >= 190 && r - g >= 8 && r - g <= 75 && g - b >= -6 && g - b <= 50 && r - b >= 10 && r - b <= 110;
}

export function analyzePortraitPixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): PortraitAnalysis | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;

  // 1. キャラの外枠
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return null;
  const contentH = bottom - top + 1;
  const contentW = right - left + 1;

  // 2. 上半分ほどの範囲で肌色の塊を探し、いちばん大きいものを顔とみなす
  const searchBottom = Math.min(bottom, top + Math.floor(contentH * 0.45));
  const skin = new Uint8Array(width * height);
  for (let y = top; y <= searchBottom; y++) {
    for (let x = left; x <= right; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 200 && isSkinColor(data[i], data[i + 1], data[i + 2])) skin[y * width + x] = 1;
    }
  }

  const label = new Int32Array(width * height);
  const stack: number[] = [];
  const comps: Array<{ count: number; minY: number; id: number }> = [];
  let nextId = 1;
  for (let y = top; y <= searchBottom; y++) {
    for (let x = left; x <= right; x++) {
      const start = y * width + x;
      if (!skin[start] || label[start]) continue;
      const id = nextId++;
      let count = 0;
      let minY = y;
      label[start] = id;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop()!;
        count++;
        const py = (p / width) | 0;
        const px = p - py * width;
        if (py < minY) minY = py;
        const neighbors = [
          px > 0 ? p - 1 : -1,
          px < width - 1 ? p + 1 : -1,
          py > top ? p - width : -1,
          py < searchBottom ? p + width : -1,
        ];
        for (const n of neighbors) {
          if (n >= 0 && skin[n] && !label[n]) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
      comps.push({ count, minY, id });
    }
  }

  // 脚や胸元のほうが顔より大きく写ることがあるので、「ある程度大きい塊のうち一番上にあるもの」を顔とする
  const maxCount = comps.reduce((m, c) => Math.max(m, c.count), 0);
  const minFaceArea = Math.max(contentW * contentH * 0.002, maxCount * 0.25);
  const best = comps
    .filter((c) => c.count >= minFaceArea)
    .sort((a, b) => a.minY - b.minY)[0];
  if (best) {
    // 顔の上端（前髪の下あたり）から少し下までの行で、顔の幅と中心を測る
    const bandBottom = Math.min(searchBottom, best.minY + Math.max(2, Math.round(contentH * 0.08)));
    let faceW = 0;
    let centerSum = 0;
    let rows = 0;
    for (let y = best.minY; y <= bandBottom; y++) {
      let minX = -1;
      let maxX = -1;
      for (let x = left; x <= right; x++) {
        if (label[y * width + x] === best.id) {
          if (minX < 0) minX = x;
          maxX = x;
        }
      }
      if (minX < 0) continue;
      faceW = Math.max(faceW, maxX - minX + 1);
      centerSum += (minX + maxX + 1) / 2;
      rows++;
    }
    if (rows > 0 && faceW > 0) {
      const eyeY = best.minY + faceW * 0.3;
      return {
        contentTop: top / height,
        contentBottom: (bottom + 1) / height,
        contentLeft: left / width,
        contentRight: (right + 1) / width,
        eyeY: Math.min(eyeY, bottom) / height,
        faceX: centerSum / rows / width,
        faceWidth: faceW / width,
        faceFound: true,
      };
    }
  }

  // 3. 肌色が見つからない: 外枠の上の方を頭とみなす
  const headBottom = top + Math.floor(contentH * 0.15);
  let sum = 0;
  let n = 0;
  for (let y = top; y <= headBottom; y++) {
    for (let x = left; x <= right; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        sum += x + 0.5;
        n++;
      }
    }
  }
  return {
    contentTop: top / height,
    contentBottom: (bottom + 1) / height,
    contentLeft: left / width,
    contentRight: (right + 1) / width,
    eyeY: (top + contentH * 0.12) / height,
    faceX: n > 0 ? sum / n / width : (left + right + 1) / 2 / width,
    faceWidth: (contentW * 0.35) / width,
    faceFound: false,
  };
}

/**
 * 公式キャラクターの立ち絵の補正値（画像サイズに対する割合）。
 * - faceWidth: 顔の幅（頬から頬）。全キャラの顔を同じ大きさで表示するために全員分そろえてある
 * - eyeY / faceX: 自動推定では目元を外してしまうキャラだけ指定する
 * VOICEVOX 同梱の立ち絵（キャラ共通の portrait）を見て目測したもの。画像そのものは同梱しない。
 * キーは speaker_uuid。ここにないキャラ（新キャラ等）は analyzePortraitPixels の推定をそのまま使う。
 */
export const PORTRAIT_FACE_HINTS: Record<string, { eyeY?: number; faceX?: number; faceWidth?: number }> = {
  // No7
  '044830d2-f23b-44d6-ac0d-b5d733caa900': { faceWidth: 0.208 },
  // Voidoll
  '0ebe2c7d-96f3-4f0e-a2e3-ae13fe27c403': { eyeY: 0.35, faceX: 0.39, faceWidth: 0.17 },
  // WhiteCUL
  '67d5d8da-acd7-4207-bb10-b5542d3a663b': { faceWidth: 0.144 },
  // あいえるたん
  'dda44ade-5f9c-4a3a-9d2c-2a976c7476d9': { eyeY: 0.122, faceX: 0.53, faceWidth: 0.19 },
  // あんこもん
  '3be49e15-34bb-48a0-9e2f-9b80c96e9905': { faceWidth: 0.168 },
  // ずんだもん
  '388f246b-8c41-4ac1-8e2d-5d79f3ff56d9': { eyeY: 0.235, faceX: 0.47, faceWidth: 0.19 },
  // ぞん子
  '0156da66-4300-474a-a398-49eb2e8dd853': { eyeY: 0.31, faceX: 0.49, faceWidth: 0.36 },
  // ちび式じい
  '468b8e94-9da4-4f7a-8715-a22a48844f9e': { eyeY: 0.32, faceX: 0.49, faceWidth: 0.45 },
  // もち子さん
  '9f3ee141-26ad-437e-97bd-d22298d02ad2': { faceWidth: 0.145 },
  // ナースロボタイプＴ
  '882a636f-3bac-431a-966d-c5e6bba9f949': { eyeY: 0.13, faceX: 0.54, faceWidth: 0.19 },
  // ブイブイ・コバコ
  '0d1745d9-ba28-4bf1-b792-3e670ee980ee': { eyeY: 0.29, faceX: 0.49, faceWidth: 0.44 },
  // ユーレイちゃん
  '462cd6b4-c088-42b0-b357-3816e24f112e': { faceWidth: 0.185 },
  // 中国うさぎ
  '1f18ffc3-47ea-4ce0-9829-0576d03a7ec8': { eyeY: 0.24, faceX: 0.51, faceWidth: 0.15 },
  // 中部つるぎ
  '4614a7de-9829-465d-9791-97eb8a5f9b86': { faceWidth: 0.12 },
  // 九州そら
  '481fb609-6446-4870-9f46-90c4dd623403': { faceWidth: 0.155 },
  // 冥鳴ひまり
  '8eaad775-3119-417e-8cf4-2a10bfd592c8': { faceWidth: 0.18 },
  // 剣崎雌雄
  '1a17ca16-7ee5-4ea5-b191-2f02ace24d21': { eyeY: 0.12, faceX: 0.52, faceWidth: 0.16 },
  // 四国めたん
  '7ffcb7ce-00ec-4bdc-82cd-45a8889e43ff': { faceWidth: 0.206 },
  // 夜語トバリ
  'd3be2066-205b-47f6-8818-1d93a9ca9cef': { faceWidth: 0.116 },
  // 小夜SAYO
  'a8cc6d22-aad0-4ab8-bf1e-2f843924164a': { eyeY: 0.235, faceX: 0.5, faceWidth: 0.25 },
  // 後鬼
  '0f56c2f2-644c-49c9-8989-94e11f7129d0': { faceWidth: 0.109 },
  // 春日部つむぎ
  '35b2c544-660e-401e-b503-0e14c635303a': { eyeY: 0.15, faceX: 0.61, faceWidth: 0.19 },
  // 春歌ナナ
  'ba5d2428-f7e0-4c20-ac41-9dd56e9178b4': { eyeY: 0.195, faceX: 0.51, faceWidth: 0.3 },
  // 暁記ミタマ
  'aca7de06-9ff9-49a3-9f08-9d3bc19689e5': { faceWidth: 0.125 },
  // 東北きりたん
  '1bd6b32b-d650-4072-bbe5-1d0ef4aaa28b': { eyeY: 0.25, faceX: 0.52, faceWidth: 0.206 },
  // 東北ずん子
  '80802b2d-8c75-4429-978b-515105017010': { faceWidth: 0.115 },
  // 東北イタコ
  'ab4c31a3-8769-422a-b412-708f5ae637e8': { eyeY: 0.21, faceX: 0.55, faceWidth: 0.125 },
  // 栗田まろん
  '04dbd989-32d0-40b4-9e71-17c920f2a8a9': { eyeY: 0.18, faceX: 0.5, faceWidth: 0.234 },
  // 櫻歌ミコ
  '0693554c-338e-4790-8982-b9c6d476dc69': { faceWidth: 0.2 },
  // 波音リツ
  'b1a81618-b27b-40d2-b0ea-27a9ad408c4b': { faceWidth: 0.128 },
  // 満別花丸
  '287aa49f-e56b-4530-a469-855776c84a8d': { eyeY: 0.17, faceX: 0.49, faceWidth: 0.275 },
  // 猫使アル
  '00a5c10c-d3bd-459f-83fd-43180b521a44': { eyeY: 0.21, faceX: 0.49, faceWidth: 0.21 },
  // 猫使ビィ
  'c20a2254-0349-4470-9fc8-e5c0f8cf3404': { eyeY: 0.21, faceX: 0.51, faceWidth: 0.165 },
  // 玄野武宏
  'c30dc15a-0992-4f8d-8bb8-ad3b314e6a6f': { faceWidth: 0.158 },
  // 琴詠ニア
  '97a4af4b-086e-4efd-b125-7ae2da85e697': { faceWidth: 0.21 },
  // 白上虎太郎
  'e5020595-5c5d-4e87-b849-270a518d0dcf': { faceWidth: 0.256 },
  // 聖騎士紅桜
  '471e39d2-fb11-4c8c-8d89-4b322d2498e0': { eyeY: 0.17, faceX: 0.47, faceWidth: 0.11 },
  // 里石ユカ
  'cc7baa71-6c74-4399-803b-b60576176a08': { faceWidth: 0.109 },
  // 雀松朱司
  '0acebdee-a4a5-4e12-a695-e19609728e30': { faceWidth: 0.19 },
  // 離途
  '3b91e034-e028-4acb-a08d-fbdcd207ea63': { faceWidth: 0.22 },
  // 雨晴はう
  '3474ee95-c274-47f9-aa1a-8322163d96f1': { faceWidth: 0.26 },
  // 青山龍星
  '4f51116a-d9ee-4516-925d-21f183e2afad': { faceWidth: 0.217 },
  // 麒ヶ島宗麟
  '7d1e7ba7-f957-40e5-a3fc-da49f769ab65': { eyeY: 0.13, faceX: 0.5, faceWidth: 0.18 },
  // 黒沢冴白
  '0b466290-f9b6-4718-8d37-6c0c81e824ac': { eyeY: 0.112, faceX: 0.46, faceWidth: 0.18 },
};

/** 自動推定の結果に、既知キャラの補正値があれば上書きする */
export function applyFaceHint(analysis: PortraitAnalysis, speakerUuid?: string): PortraitAnalysis {
  const hint = speakerUuid ? PORTRAIT_FACE_HINTS[speakerUuid] : undefined;
  return hint ? { ...analysis, ...hint } : analysis;
}
