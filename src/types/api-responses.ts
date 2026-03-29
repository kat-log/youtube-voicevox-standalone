// YouTube Data API v3
export interface YouTubeVideoResponse {
  items?: YouTubeVideoItem[];
  error?: YouTubeApiError;
}

export interface YouTubeVideoItem {
  snippet?: {
    title: string;
  };
  liveStreamingDetails?: {
    activeLiveChatId?: string;
    actualStartTime?: string;
    scheduledStartTime?: string;
  };
}

export interface YouTubeChatResponse {
  items?: YouTubeChatItem[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  error?: YouTubeApiError;
}

export interface YouTubeChatItem {
  snippet: {
    displayMessage: string;
    publishedAt: string;
  };
  authorDetails: {
    displayName: string;
    channelId: string;
  };
}

export interface YouTubeApiError {
  code: number;
  message: string;
  errors?: Array<{
    reason: string;
    domain: string;
    message: string;
  }>;
}

// TTS Quest v3 API
export interface TTSQuestSynthesisResponse {
  success: boolean;
  errorMessage?: string;
  mp3StreamingUrl?: string;
  mp3DownloadUrl?: string;
  wavDownloadUrl?: string;
  audioStatusUrl?: string;
  audioId?: string;
  retryAfter?: number;
}

export interface TTSQuestAudioStatusResponse {
  isAudioReady: boolean;
  isAudioError: boolean;
  status?: string;
  mp3DownloadUrl?: string;
  wavDownloadUrl?: string;
}

// TTS Quest v3 Key Points API
export interface TTSQuestKeyPointsResponse {
  isApiKeyValid: boolean;
  points: number;
}

// YouTubei 内部 API (非公式)
export interface YouTubeiContinuationData {
  continuation: string;
  timeoutMs?: number;
}
