export interface FilterConfig {
  enabled: boolean;
  minLength: number;
  skipEmojiOnly: boolean;
  stripEmoji: boolean;
  ngWords: string[];
  ngWordAction: 'skip' | 'remove';
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  enabled: false,
  minLength: 1,
  skipEmojiOnly: false,
  stripEmoji: false,
  ngWords: [],
  ngWordAction: 'skip',
};

const EMOJI_ONLY_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\s]+$/u;

// Unicode絵文字（ZWJシーケンス・スキントーン含む）
const UNICODE_EMOJI_REGEX =
  /[\p{Emoji_Presentation}\p{Extended_Pictographic}][\uFE0F\u200D\p{Emoji_Presentation}\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*/gu;

// YouTube絵文字ショートコード: :_2BROOtojya: や :thumbsup: 等
const EMOJI_SHORTCODE_REGEX = /:[a-zA-Z_][a-zA-Z0-9_]*:/g;

// モジュール内キャッシュ
let cachedConfig: FilterConfig = { ...DEFAULT_FILTER_CONFIG };

export function getFilterConfig(): FilterConfig {
  return cachedConfig;
}

export function setFilterConfig(config: FilterConfig): void {
  cachedConfig = config;
}

export async function loadFilterConfigFromStorage(): Promise<void> {
  const data = await chrome.storage.sync.get('filterConfig');
  if (data.filterConfig) {
    cachedConfig = { ...DEFAULT_FILTER_CONFIG, ...data.filterConfig };
  }
}

function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(/\s/g, '');
  if (stripped.length === 0) return true;
  return EMOJI_ONLY_REGEX.test(stripped);
}

export function shouldFilter(message: string, config: FilterConfig): boolean {
  if (!config.enabled) return false;

  // 最小文字数チェック
  if (config.minLength > 1 && message.length < config.minLength) {
    return true;
  }

  // 絵文字のみチェック
  if (config.skipEmojiOnly && isEmojiOnly(message)) {
    return true;
  }

  // NGワードチェック
  if (config.ngWords.length > 0) {
    const lowerText = message.toLowerCase();
    if (config.ngWords.some((word) => lowerText.includes(word.toLowerCase()))) {
      return true;
    }
  }

  return false;
}

/** テキストからUnicode絵文字とYouTubeカスタム絵文字コードを除去する */
export function stripEmojis(text: string): string {
  return text
    .replace(UNICODE_EMOJI_REGEX, '')
    .replace(EMOJI_SHORTCODE_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** テキストからNGワードを除去する（大文字小文字無視） */
export function removeNgWords(text: string, ngWords: string[]): string {
  if (ngWords.length === 0) return text;
  const escaped = ngWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(escaped.join('|'), 'gi');
  return text.replace(pattern, '').replace(/\s+/g, ' ').trim();
}
