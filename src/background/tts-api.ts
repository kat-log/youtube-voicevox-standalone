import type { TTSQuestSynthesisResponse, TTSQuestAudioStatusResponse } from '@/types/api-responses';
import type { TtsEngine } from '@/types/state';
import { getState, shiftComment, pushAudio, unshiftComment } from './state';
import { sendDebugInfo, formatQueueState, sendStatus } from './messaging';
import { playNextAudio, updateBadge } from './audio-player';
import { evaluateRushMode } from './rush-mode';
import { getEffectiveMaxConcurrent, getParallelSpeakerId, resetParallelSlotCounter } from './parallel-playback';
import { getSpeakerName } from './speaker-names';

export class RateLimitError extends Error {
  constructor(public retryAfter: number) {
    super(`Rate limited: retry after ${retryAfter}s`);
    this.name = 'RateLimitError';
  }
}

// TTSエンジン設定（モジュールレベルキャッシュ）
let currentEngine: TtsEngine = 'voicevox';
let browserVoiceName: string | null = null;
let localVoicevoxHost: string = 'http://localhost:50021';

// 先読みパイプライン制御
let isTtsProcessing = false;
let processingTimeoutId: ReturnType<typeof setTimeout> | null = null;

const PREFETCH_THRESHOLD = 5;   // audioQueue にこの数まで先読み
const MIN_PROCESS_DELAY = 500;  // TTS API呼出の最低間隔(ms)
const MAX_RATE_LIMIT_RETRIES = 5; // レート制限リトライ上限

// 次のコメント処理をスケジュール（audioQueue が閾値未満なら先読み）
export function scheduleNextProcessing(): void {
  if (processingTimeoutId !== null) return;
  if (isTtsProcessing) return;

  const state = getState();
  if (state.commentQueue.length === 0) return;
  const effectiveThreshold = PREFETCH_THRESHOLD + getEffectiveMaxConcurrent();
  if (state.audioQueue.length >= effectiveThreshold) {
    sendDebugInfo(`⏳ audioQueue満杯 (${state.audioQueue.length}/${effectiveThreshold}) - TTS先読み一時停止`);
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
  resetParallelSlotCounter();
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

export function setLocalVoicevoxHost(host: string): void {
  localVoicevoxHost = host;
}

export function getLocalVoicevoxHost(): string {
  return localVoicevoxHost;
}

export function processCommentQueue(): void {
  const state = getState();
  if (state.commentQueue.length === 0) return;
  if (isTtsProcessing) return;

  const comment = shiftComment();
  if (!comment) return;

  // 並列再生マルチ話者: スロットに基づいて話者IDを上書き
  comment.speakerId = getParallelSpeakerId(comment.speakerId);

  if (currentEngine === 'browser') {
    // ブラウザTTS: API不要、直接audioQueueに追加
    const voiceLabel = browserVoiceName || 'default';
    sendDebugInfo(`ブラウザTTS [${voiceLabel}]：${comment.newMessage} | キュー: ${formatQueueState()}`);
    pushAudio({
      type: 'speech',
      text: comment.newMessage,
      voiceName: browserVoiceName || undefined,
    });
    updateBadge();
    evaluateRushMode();
    playNextAudio();
    scheduleNextProcessing();
    return;
  }

  if (currentEngine === 'local-voicevox') {
    // ローカルVOICEVOX: ローカルエンジンで音声合成
    isTtsProcessing = true;
    const localSpeakerLabel = getSpeakerName(comment.speakerId);
    sendDebugInfo(`ローカルVOICEVOX REQUEST [${localSpeakerLabel}]：${comment.newMessage} | キュー: ${formatQueueState()}`);
    synthesizeLocalWithRetry(comment, 0);
    return;
  }

  // VOICEVOX: TTS Quest APIで音声合成
  isTtsProcessing = true;
  const speakerLabel = getSpeakerName(comment.speakerId);
  sendDebugInfo(`VOICEVOX REQUEST [${speakerLabel}]：${comment.newMessage} | キュー: ${formatQueueState()}`);
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
  retryCount: number,
  rateLimitRetryCount = 0
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

      sendDebugInfo(`VOICEVOX RESPONSE：${audioUrl} | キュー: ${formatQueueState()}`);

      pushAudio({ type: 'url', url: audioUrl });
      updateBadge();
      evaluateRushMode();
      playNextAudio();
      scheduleNextProcessing();
    })
    .catch((error: Error) => {
      // Stop後に完了した古いリクエストは破棄
      if (getState().sessionId !== currentSession) {
        isTtsProcessing = false;
        return;
      }

      // レート制限: パイプラインを解放し、遅延リトライをスケジュール
      if (error instanceof RateLimitError) {
        isTtsProcessing = false;
        sendStatus('rate-limited');
        sendDebugInfo(
          `⚠ レート制限: ${error.retryAfter}秒待機 | text="${newMessage.substring(0, 20)}..." | キュー: ${formatQueueState()}`
        );

        if (rateLimitRetryCount >= MAX_RATE_LIMIT_RETRIES) {
          sendDebugInfo(
            `レート制限リトライ上限到達（${MAX_RATE_LIMIT_RETRIES}回）— コメントをスキップ: "${newMessage.substring(0, 20)}..."`
          );
          scheduleNextProcessing();
          return;
        }

        // 遅延リトライ（この間 audioQueue の再生は継続される）
        setTimeout(() => {
          if (getState().sessionId !== currentSession) return;

          // 別のコメントが処理中なら、このコメントをキューの先頭に戻す
          if (isTtsProcessing) {
            unshiftComment(comment);
            sendDebugInfo(
              `レート制限リトライ: 別コメント処理中のためキュー先頭に再挿入: "${newMessage.substring(0, 20)}..."`
            );
            return;
          }

          isTtsProcessing = true;
          synthesizeWithRetry(comment, retryCount, rateLimitRetryCount + 1);
        }, error.retryAfter * 1000);

        return;
      }

      // 通常のエラー処理
      if (retryCount < maxRetries) {
        sendDebugInfo(`VOICEVOXリトライ（${retryCount + 1}/${maxRetries}）: ${newMessage}`);
        // リトライ中は isTtsProcessing = true のまま
        setTimeout(() => synthesizeWithRetry(comment, retryCount + 1, rateLimitRetryCount), 1000);
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

  // レート制限（HTTP 429）— 即座にthrowしてパイプラインをブロックしない
  if (response.status === 429) {
    const data = await response.json();
    throw new RateLimitError(data.retryAfter || 5);
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

// --- ローカル VOICEVOX エンジン ---

function synthesizeLocalWithRetry(
  comment: {
    newMessage: string;
    speakerId?: string;
  },
  retryCount: number
): void {
  const maxRetries = 3;
  const currentSession = getState().sessionId;
  const { newMessage, speakerId } = comment;

  sendStatus('generating');

  fetchLocalVoiceVox(newMessage, speakerId)
    .then((dataUri) => {
      isTtsProcessing = false;
      if (getState().sessionId !== currentSession) return;

      sendDebugInfo(`ローカルVOICEVOX RESPONSE：data URI (${dataUri.length} chars) | キュー: ${formatQueueState()}`);

      pushAudio({ type: 'url', url: dataUri });
      updateBadge();
      evaluateRushMode();
      playNextAudio();
      scheduleNextProcessing();
    })
    .catch((error: Error) => {
      if (getState().sessionId !== currentSession) {
        isTtsProcessing = false;
        return;
      }

      if (retryCount < maxRetries) {
        sendDebugInfo(`ローカルVOICEVOXリトライ（${retryCount + 1}/${maxRetries}）: ${newMessage}`);
        setTimeout(() => synthesizeLocalWithRetry(comment, retryCount + 1), 1000);
      } else {
        isTtsProcessing = false;
        sendDebugInfo(`ローカルVOICEVOXエラー（スキップ）: ${error.message} - "${newMessage}"`);
        // eslint-disable-next-line no-console
        console.error('ローカルVOICEVOXエラー:', error);
        scheduleNextProcessing();
      }
    });
}

// ローカル VOICEVOX API で音声合成（audio_query → synthesis → data URI）
async function fetchLocalVoiceVox(text: string, speakerId?: string): Promise<string> {
  const effectiveSpeakerId =
    speakerId || (await chrome.storage.sync.get(['localSpeakerId'])).localSpeakerId || '1';
  const encodedText = encodeURIComponent(text);

  // Step 1: audio_query
  let audioQueryRes: Response;
  try {
    audioQueryRes = await fetch(
      `${localVoicevoxHost}/audio_query?text=${encodedText}&speaker=${effectiveSpeakerId}`,
      { method: 'POST' }
    );
  } catch {
    throw new Error('VOICEVOXエンジンに接続できません。アプリが起動しているか確認してください。');
  }

  if (!audioQueryRes.ok) {
    throw new Error(`audio_query エラー (${audioQueryRes.status})`);
  }

  const audioQuery: unknown = await audioQueryRes.json();

  // Step 2: synthesis
  let synthesisRes: Response;
  try {
    synthesisRes = await fetch(
      `${localVoicevoxHost}/synthesis?speaker=${effectiveSpeakerId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioQuery),
      }
    );
  } catch {
    throw new Error('VOICEVOXエンジンとの通信中にエラーが発生しました。');
  }

  if (!synthesisRes.ok) {
    throw new Error(`synthesis エラー (${synthesisRes.status})`);
  }

  // Step 3: WAV バイナリ → data URI
  const arrayBuffer = await synthesisRes.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  return `data:audio/wav;base64,${base64}`;
}

// ArrayBuffer → Base64 文字列変換
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
