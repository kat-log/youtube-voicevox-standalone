export type TtsEngine = 'voicevox' | 'browser';

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
  isPlaying: boolean;
  liveChatId: string | null;
  intervalId: ReturnType<typeof setTimeout> | null;
  nextPageToken: string | null;
  commentQueue: CommentQueueItem[];
  commentIntervalId: ReturnType<typeof setInterval> | null;
  latestTimestamp: number | null;
  latestOnlyMode: boolean;
  activeTabId: number | null;
  playingTimeout: ReturnType<typeof setTimeout> | null;
  consecutiveErrors: number;
  pollingIntervalMs: number;
  commentCount: number;
  sessionId: number;
}

export type ExtensionStatus =
  | 'idle'
  | 'connecting'
  | 'fetching'
  | 'generating'
  | 'listening'
  | 'error';
