import type { TTSQuestSynthesisResponse, TTSQuestAudioStatusResponse } from '@/types/api-responses';
import type { TtsEngine } from '@/types/state';
import { getState, shiftComment, pushAudio } from './state';
import { sendDebugInfo, formatQueueState, sendStatus } from './messaging';
import { playNextAudio, updateBadge } from './audio-player';

// TTSエンジン設定（モジュールレベルキャッシュ）
let currentEngine: TtsEngine = 'voicevox';
let browserVoiceName: string | null = null;

// 先読みパイプライン制御
let isTtsProcessing = false;
let processingTimeoutId: ReturnType<typeof setTimeout> | null = null;

const PREFETCH_THRESHOLD = 5;   // audioQueue にこの数まで先読み
const MIN_PROCESS_DELAY = 500;  // TTS API呼出の最低間隔(ms)

// 次のコメント処理をスケジュール（audioQueue が閾値未満なら先読み）
export function scheduleNextProcessing(): void {
  if (processingTimeoutId !== null) return;
  if (isTtsProcessing) return;

  const state = getState();
  if (state.commentQueue.length === 0) return;
  if (state.audioQueue.length >= PREFETCH_THRESHOLD) {
    sendDebugInfo(`⏳ audioQueue満杯 (${state.audioQueue.length}/${PREFETCH_THRESHOLD}) - TTS先読み一時停止`);
    return;
  }

  processingTimeoutId = setTimeout(() => {
    processingTimeoutId = null;
    processCommentQueue();
  }, MIN_PROCESS_DELAY);
}

// スケジュール済み処理のキャンセル（停止用）
export function cancelScheduledProcessing(): void {
  if (processingTimeoutId !== null) {
    clearTimeout(processingTimeoutId);
    processingTimeoutId = null;
  }
  isTtsProcessing = false;
}

export function setTtsEngine(engine: TtsEngine): void {
  currentEngine = engine;
}

export function getTtsEngine(): TtsEngine {
  return currentEngine;
}

export function setBrowserVoice(voiceName: string | null): void {
  browserVoiceName = voiceName;
}

export function getBrowserVoice(): string | null {
  return browserVoiceName;
}

export function processCommentQueue(): void {
  const state = getState();
  if (state.commentQueue.length === 0) return;
  if (isTtsProcessing) return;

  const comment = shiftComment();
  if (!comment) return;

  if (currentEngine === 'browser') {
    // ブラウザTTS: API不要、直接audioQueueに追加
    sendDebugInfo(`ブラウザTTS：${comment.newMessage} | Queue: ${formatQueueState()}`);
    pushAudio({
      type: 'speech',
      text: comment.newMessage,
      voiceName: browserVoiceName || undefined,
    });
    updateBadge();
    playNextAudio();
    scheduleNextProcessing();
    return;
  }

  // VOICEVOX: TTS Quest APIで音声合成
  isTtsProcessing = true;
  sendDebugInfo(`VOICEVOX REQUEST：${comment.newMessage} | Queue: ${formatQueueState()}`);
  synthesizeWithRetry(comment, 0);
}

function synthesizeWithRetry(
  comment: {
    apiKeyVOICEVOX: string;
    newMessage: string;
    speed: number;
    tabId: number;
    speakerId?: string;
  },
  retryCount: number
): void {
  const maxRetries = 3;
  const currentSession = getState().sessionId;
  const { apiKeyVOICEVOX, newMessage, speakerId } = comment;

  // VOICEVOX APIへのリクエスト直前にステータスを更新
  sendStatus('generating');

  fetchVoiceVox(apiKeyVOICEVOX, newMessage, speakerId)
    .then((audioUrl) => {
      isTtsProcessing = false;
      // Stop後に完了した古いリクエストは破棄
      if (getState().sessionId !== currentSession) return;

      sendDebugInfo(`VOICEVOX RESPONSE：${audioUrl} | Queue: ${formatQueueState()}`);

      pushAudio({ type: 'url', url: audioUrl });
      updateBadge();
      playNextAudio();
      scheduleNextProcessing();
    })
    .catch((error: Error) => {
      // Stop後に完了した古いリクエストは破棄
      if (getState().sessionId !== currentSession) {
        isTtsProcessing = false;
        return;
      }

      if (retryCount < maxRetries) {
        sendDebugInfo(`VOICEVOXリトライ（${retryCount + 1}/${maxRetries}）: ${newMessage}`);
        // リトライ中は isTtsProcessing = true のまま
        setTimeout(() => synthesizeWithRetry(comment, retryCount + 1), 1000);
      } else {
        // リトライ上限到達: コメントをスキップ
        isTtsProcessing = false;
        sendDebugInfo(`VOICEVOXエラー（スキップ）: ${error.message} - "${newMessage}"`);
        // eslint-disable-next-line no-console
        console.error('VoiceVoxエラー:', error);
        scheduleNextProcessing();
      }
    });
}

// TTS Quest v3 API で音声合成を行い、音声URLを返す
async function fetchVoiceVox(apiKey: string, text: string, speakerId?: string): Promise<string> {
  const encodedText = encodeURIComponent(text);
  const effectiveSpeakerId =
    speakerId || (await chrome.storage.sync.get(['speakerId'])).speakerId || '1';

  let url = `https://api.tts.quest/v3/voicevox/synthesis?text=${encodedText}&speaker=${effectiveSpeakerId}`;
  if (apiKey) {
    url += `&key=${encodeURIComponent(apiKey)}`;
  }

  const response = await fetch(url);

  // レート制限（HTTP 429）
  if (response.status === 429) {
    const data = await response.json();
    const waitMs = (data.retryAfter || 5) * 1000;
    sendStatus('rate-limited');
    sendDebugInfo(`⚠ レート制限: ${data.retryAfter || 5}秒待機 | text="${text.substring(0, 20)}..." | Queue: ${formatQueueState()}`);
    await new Promise((r) => setTimeout(r, waitMs));
    sendStatus('generating');
    return fetchVoiceVox(apiKey, text, speakerId);
  }

  if (!response.ok) {
    throw new Error(`TTS Quest API エラー (${response.status})`);
  }

  const data: TTSQuestSynthesisResponse = await response.json();
  if (!data.success) {
    throw new Error(data.errorMessage || 'TTS Quest APIリクエスト失敗');
  }

  // mp3StreamingUrl を優先（ポーリング不要で即時利用可能）
  if (data.mp3StreamingUrl) {
    return data.mp3StreamingUrl;
  }

  // フォールバック: ポーリングして mp3DownloadUrl を使用
  const audioUrl = data.mp3DownloadUrl || data.wavDownloadUrl;
  if (!audioUrl || !data.audioStatusUrl) {
    throw new Error('音声URLが取得できません');
  }
  await waitForAudio(data.audioStatusUrl);
  return audioUrl;
}

// audioStatusUrl をポーリングして音声生成完了を待つ（フォールバック用）
async function waitForAudio(
  audioStatusUrl: string,
  maxAttempts = 30,
  intervalMs = 1000
): Promise<void> {
  sendDebugInfo(`音声生成ポーリング開始（最大${maxAttempts}秒）`);
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const res = await fetch(audioStatusUrl);
      if (!res.ok) continue;
      const status: TTSQuestAudioStatusResponse = await res.json();
      if (status.isAudioError) throw new Error('音声生成エラー');
      if (status.isAudioReady) return;
    } catch (e) {
      if (e instanceof Error && e.message === '音声生成エラー') throw e;
      continue; // ネットワークエラーは続行
    }
  }
  throw new Error(`音声生成タイムアウト（${maxAttempts}秒）`);
}
