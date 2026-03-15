export interface FilterConfig {
  enabled: boolean;
  minLength: number;
  skipEmojiOnly: boolean;
  ngWords: string[];
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  enabled: false,
  minLength: 1,
  skipEmojiOnly: false,
  ngWords: [],
};

const EMOJI_ONLY_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\s]+$/u;

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
