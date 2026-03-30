import type { ExtensionStatus, TtsEngine, RushModeConfig, AutoCatchUpConfig, ParallelPlaybackConfig, ParallelSpeakersConfig } from './state';
import type { FilterConfig } from '@/background/comment-filter';

// ログレベル
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// session storage に保存するログエントリ
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
}

// Popup → Background メッセージ
export interface StartMessage {
  action: 'start';
  apiKeyVOICEVOX: string;
  apiKeyYoutube: string;
  speed: number;
  volume: number;
  latestOnlyMode: boolean;
  latestOnlyCount: number;
  speakerId?: string;
  chatMode?: 'official' | 'standalone' | 'dom';
}

export interface StopMessage {
  action: 'stop';
}

export interface UpdateLatestOnlyModeMessage {
  action: 'updateLatestOnlyMode';
  latestOnlyMode: boolean;
  latestOnlyCount: number;
}

export interface UpdateSpeakerMessage {
  action: 'updateSpeaker';
  speakerId: string;
}

export interface GetStatusMessage {
  action: 'getStatus';
}

export interface SetVolumeMessage {
  action: 'setVolume';
  volume: number;
}

export interface SetSpeedMessage {
  action: 'setSpeed';
  speed: number;
}

export interface UpdateQueueSpeedMessage {
  action: 'updateQueueSpeed';
  speed: number;
}

export interface UpdateFilterConfigMessage {
  action: 'updateFilterConfig';
  filterConfig: FilterConfig;
}

export interface UpdateTtsEngineMessage {
  action: 'updateTtsEngine';
  engine: TtsEngine;
}

export interface UpdateBrowserVoiceMessage {
  action: 'updateBrowserVoice';
  voiceName: string;
}

export interface TestLocalVoicevoxMessage {
  action: 'testLocalVoicevox';
  host: string;
}

export interface GetLocalSpeakersMessage {
  action: 'getLocalSpeakers';
  host: string;
}

export interface UpdateLocalVoicevoxHostMessage {
  action: 'updateLocalVoicevoxHost';
  host: string;
}

export interface UpdateRushModeConfigMessage {
  action: 'updateRushModeConfig';
  rushModeConfig: RushModeConfig;
}

export interface UpdateAutoCatchUpConfigMessage {
  action: 'updateAutoCatchUpConfig';
  autoCatchUpConfig: AutoCatchUpConfig;
}

export interface UpdateRandomSpeakerConfigMessage {
  action: 'updateRandomSpeakerConfig';
  enabled: boolean;
  engine?: TtsEngine;
  host?: string;
}

export interface UpdateRandomSpeakerAllowedIdsMessage {
  action: 'updateRandomSpeakerAllowedIds';
  ids: string[] | null;
  engine: TtsEngine;
}

export interface GetSpeakerListMessage {
  action: 'getSpeakerList';
}

export interface UpdateParallelPlaybackConfigMessage {
  action: 'updateParallelPlaybackConfig';
  parallelPlaybackConfig: ParallelPlaybackConfig;
}

export interface UpdateParallelSpeakersConfigMessage {
  action: 'updateParallelSpeakersConfig';
  parallelSpeakersConfig: ParallelSpeakersConfig;
}

export interface UpdateParallelSynthesisMessage {
  action: 'updateParallelSynthesis';
  count: number;
}

// Background → Content Script メッセージ（スタンドアロンモード）
export interface StartStandalonePollingMessage {
  action: 'startStandalonePolling';
  videoId: string;
  initialContinuation: { continuation: string; timeoutMs: number; isReplay: boolean; needsPlayerState?: boolean };
}

export interface StopStandalonePollingMessage {
  action: 'stopStandalonePolling';
}

// Content Script → Background メッセージ（DOMモード）
export interface DomChatMessagesMessage {
  action: 'domChatMessages';
  messages: Array<{ text: string; timestampMs: number }>;
}

export interface DomChatErrorMessage {
  action: 'domChatError';
  message: string;
}

export interface DomChatLogMessage {
  action: 'domChatLog';
  message: string;
}

// Content Script → Background メッセージ（スタンドアロンモード）
export interface StandaloneChatMessagesMessage {
  action: 'standaloneChatMessages';
  messages: Array<{ text: string; timestampMs: number }>;
}

export interface StandaloneEndedMessage {
  action: 'standaloneEnded';
}

export interface StandaloneErrorMessage {
  action: 'standaloneError';
  message: string;
}

// Content / Offscreen → Background メッセージ
export interface AudioEndedMessage {
  action: 'audioEnded';
  audioId?: string;
}

export interface AudioErrorMessage {
  action: 'audioError';
  audioId?: string;
}

// Background → Popup メッセージ
export interface UpdateStatusMessage {
  action: 'updateStatus';
  status: ExtensionStatus;
  message: string;
  commentCount: number;
  queueLength: number;
  isRushActive: boolean;
}

export interface UpdateErrorMessage {
  action: 'updateErrorMessage';
  message: string;
}

export interface DebugInfoMessage {
  action: 'debugInfo';
  level: LogLevel;
  message: string;
  timestamp?: string;
}

// Popup → Background テスト再生メッセージ
export interface TestSpeakMessage {
  action: 'testSpeak';
  text: string;
  speakerId?: string;
}

// Background → Popup テスト再生結果メッセージ
export interface TestSpeakResultMessage {
  action: 'testSpeakResult';
  status: 'generating' | 'playing' | 'done' | 'error';
  message?: string;
  speakerId?: string;
}

// Background → Stats Page メッセージ
export interface UpdateStatsMessage {
  action: 'updateStats';
  totalCount: number;
}

// Stats Page → Background メッセージ
export interface GetStatsMessage {
  action: 'getStats';
}

// Background が受信するメッセージの Discriminated Union
export type IncomingMessage =
  | StartMessage
  | StopMessage
  | UpdateLatestOnlyModeMessage
  | UpdateSpeakerMessage
  | GetStatusMessage
  | AudioEndedMessage
  | AudioErrorMessage
  | SetVolumeMessage
  | SetSpeedMessage
  | UpdateQueueSpeedMessage
  | UpdateFilterConfigMessage
  | UpdateRushModeConfigMessage
  | UpdateAutoCatchUpConfigMessage
  | UpdateParallelPlaybackConfigMessage
  | UpdateParallelSpeakersConfigMessage
  | UpdateRandomSpeakerConfigMessage
  | UpdateRandomSpeakerAllowedIdsMessage
  | GetSpeakerListMessage
  | UpdateTtsEngineMessage
  | UpdateBrowserVoiceMessage
  | UpdateLocalVoicevoxHostMessage
  | UpdateParallelSynthesisMessage
  | TestLocalVoicevoxMessage
  | GetLocalSpeakersMessage
  | TestSpeakMessage
  | GetStatsMessage
  | StandaloneChatMessagesMessage
  | StandaloneEndedMessage
  | StandaloneErrorMessage
  | DomChatMessagesMessage
  | DomChatErrorMessage
  | DomChatLogMessage;

// メッセージレスポンス
export interface MessageResponse {
  status: 'success' | 'error';
  message?: string;
  details?: string;
  commentCount?: number;
  speakers?: Array<{ name: string; styles: Array<{ id: number; name: string }> }>;
}
