import type { ExtensionStatus } from './state';

// Popup → Background メッセージ
export interface StartMessage {
  action: 'start';
  apiKeyVOICEVOX: string;
  apiKeyYoutube: string;
  speed: number;
  volume: number;
  latestOnlyMode: boolean;
  speakerId: string;
}

export interface StopMessage {
  action: 'stop';
}

export interface UpdateLatestOnlyModeMessage {
  action: 'updateLatestOnlyMode';
  latestOnlyMode: boolean;
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

// Content → Background メッセージ
export interface AudioEndedMessage {
  action: 'audioEnded';
}

// Background → Popup メッセージ
export interface UpdateStatusMessage {
  action: 'updateStatus';
  status: ExtensionStatus;
  message: string;
  commentCount: number;
}

export interface UpdateErrorMessage {
  action: 'updateErrorMessage';
  message: string;
}

export interface DebugInfoMessage {
  action: 'debugInfo';
  message: string;
}

// メッセージレスポンス
export interface MessageResponse {
  status: 'success' | 'error';
  message?: string;
  details?: string;
  commentCount?: number;
}
