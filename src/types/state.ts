export type TtsEngine = 'voicevox' | 'browser' | 'local-voicevox';

export interface RushModeConfig {
  enabled: boolean;
  activateThreshold: number;
  returnThreshold: number;
  rushSpeed: number;
}

export interface AutoCatchUpConfig {
  enabled: boolean;
  threshold: number;
  keepCount: number;
}

export interface ParallelPlaybackConfig {
  alwaysEnabled: boolean;
  alwaysMaxConcurrent: number;
  autoEnabled: boolean;
  autoTriggerThreshold: number;
  autoMaxConcurrent: number;
}

export interface ParallelSpeakersConfig {
  enabled: boolean;
  speakerIds: string[]; // [話者2のID, 話者3のID, ...]
  roundRobinSpeakerCount: number; // 持ち回り話者数（並列再生OFF時に使用、デフォルト3）
}

export interface AudioQueueItem {
  type: 'url' | 'speech';
  url?: string;
  text?: string;
  voiceName?: string;
}

export interface CommentQueueItem {
  apiKeyVOICEVOX: string;
  newMessage: string;
  speed: number;
  tabId: number;
  speakerId?: string;
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

export type ExtensionStatus =
  | 'idle'
  | 'connecting'
  | 'fetching'
  | 'generating'
  | 'listening'
  | 'rate-limited'
  | 'waiting'
  | 'error';
