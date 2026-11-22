export type TtsEngine = 'voicevox' | 'browser' | 'local-voicevox';

export interface RushModeConfig {
  enabled: boolean;
  activateThreshold: number;
  returnThreshold: number;
  rushSpeed: number;
}

export interface RandomSpeedConfig {
  enabled: boolean;
  minSpeed: number;
  maxSpeed: number;
}

export interface AutoCatchUpConfig {
  enabled: boolean;
  threshold: number;
}

export interface ParallelPlaybackConfig {
  alwaysEnabled: boolean;
  autoEnabled: boolean;
  autoTriggerThreshold: number;
  autoExtraEnabled: boolean;
  autoExtraThreshold: number;
  autoExtraConcurrent: number;
}

export interface ParallelSpeakersConfig {
  enabled: boolean;
  /**
   * 旧形式の話者ID [話者2のID, 話者3のID, ...]（エンジン共通）。
   * エンジン別の値（speakerIdsByEngine）が未保存のエンジンではこれを使う。
   * 旧バージョンとの互換のため、保存時は最後に保存したエンジンの値も入れておく。
   * 読み書きは src/utils/round-robin.ts のヘルパー経由で行うこと。
   */
  speakerIds: string[];
  /** エンジン別の話者ID。Web API とローカルでは話者IDの体系が異なる場合があるため分けて持つ */
  speakerIdsByEngine?: {
    voicevox?: string[];
    localVoicevox?: string[];
  };
  roundRobinSpeakerCount: number; // 持ち回り話者数（並列再生OFF時に使用、デフォルト3）
}

export interface RandomSpeakerPreset {
  id: string;
  name: string;
  /** プリセットを保存したエンジン。旧形式（未設定）は allowedIds の中身から推定する */
  engine?: TtsEngine;
  allowedIds: {
    voicevox: string[] | null;
    localVoicevox: string[] | null;
    browser: string[] | null;
  };
}

export interface RoundRobinPreset {
  id: string;
  name: string;
  /** プリセットを保存したエンジン。旧形式（未設定）は VOICEVOX 系の両エンジンで使える扱い */
  engine?: TtsEngine;
  speakerIds: string[];
  roundRobinSpeakerCount: number;
}

export interface AudioQueueItem {
  type: 'url' | 'speech';
  url?: string;
  text?: string;
  voiceName?: string;
  lifecycleId?: string;
}

export interface CommentQueueItem {
  apiKeyVOICEVOX: string;
  newMessage: string;
  speed: number;
  tabId: number;
  speakerId?: string;
  lifecycleId?: string;
  fetchTime?: number;
}

export interface ExtensionState {
  audioQueue: AudioQueueItem[];
  playingCount: number;
  playingTimeouts: Map<string, ReturnType<typeof setTimeout>>;
  currentStatus: ExtensionStatus;
  liveChatId: string | null;
  intervalId: ReturnType<typeof setTimeout> | null;
  nextPageToken: string | null;
  commentQueue: CommentQueueItem[];
  latestTimestamp: number | null;
  latestOnlyMode: boolean;
  latestOnlyCount: number;
  activeTabId: number | null;
  consecutiveErrors: number;
  pollingIntervalMs: number;
  commentCount: number;
  sessionId: number;
  pollingCycleCount: number;
  isRushActive: boolean;
  isYouTubeRateLimited: boolean;
}

export const RANDOM_SPEAKER_SENTINEL = '__random__';

/**
 * ランダム話者モードのダミー値を除去する。
 * このセンチネル値は UI 表示専用であり、話者IDとして API に渡してはいけない。
 */
export function stripRandomSentinel(speakerId: string | undefined | null): string | undefined {
  if (!speakerId || speakerId === RANDOM_SPEAKER_SENTINEL) return undefined;
  return speakerId;
}

export type ExtensionStatus =
  | 'idle'
  | 'connecting'
  | 'fetching'
  | 'generating'
  | 'listening'
  | 'rate-limited'
  | 'waiting'
  | 'error';
