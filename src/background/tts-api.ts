import type { TTSQuestSynthesisResponse, TTSQuestAudioStatusResponse } from '@/types/api-responses';
import type { TtsEngine, AudioQueueItem } from '@/types/state';
import { getState, shiftComment, pushAudio, unshiftComment } from './state';
import { sendDebugInfo, formatQueueState, sendStatus } from './messaging';
import { playNextAudio, updateBadge } from './audio-player';
import { evaluateRushMode } from './rush-mode';
import { getEffectiveMaxConcurrent, getParallelSpeakerId, resetParallelSlotCounter } from './parallel-playback';
import { getSpeakerName } from './speaker-names';
import { isRandomSpeakerEnabled, getRandomSpeakerId } from './random-speaker';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

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
let ttsProcessingCount = 0;
let processingTimeoutId: ReturnType<typeof setTimeout> | null = null;

// ローカルVOICEVOX 並列合成
let maxParallelSynthesis = 1;   // デフォルト: シリアル（後方互換）
let nextSynthesisSeq = 0;       // コメント取り出し時に付番
let nextAudioInsertSeq = 0;     // audioQueue に挿入すべき次の番号
const pendingResults = new Map<number, AudioQueueItem | null>();

const PREFETCH_THRESHOLD = 5;   // audioQueue にこの数まで先読み
const MIN_PROCESS_DELAY = 500;  // TTS API呼出の最低間隔(ms)
const MIN_PARALLEL_DELAY = 50;  // 並列合成時の最低間隔(ms)
const MAX_RATE_LIMIT_RETRIES = 5; // レート制限リトライ上限

// 次のコメント処理をスケジュール（audioQueue が閾値未満なら先読み）
export function scheduleNextProcessing(): void {
  if (processingTimeoutId !== null) return;

  const maxConcurrent = currentEngine === 'local-voicevox' ? maxParallelSynthesis : 1;
  if (ttsProcessingCount >= maxConcurrent) return;

  const state = getState();
  if (state.commentQueue.length === 0) return;
  const effectiveThreshold = PREFETCH_THRESHOLD + getEffectiveMaxConcurrent();
  // in-flight の合成リクエスト + pending バッファも考慮
  const totalPending = state.audioQueue.length + ttsProcessingCount + pendingResults.size;
  if (totalPending >= effectiveThreshold) {
    sendDebugInfo(`⏳ audioQueue満杯 (${totalPending}/${effectiveThreshold}) - TTS先読み一時停止`);
    return;
  }

  const delay = currentEngine === 'local-voicevox' && maxParallelSynthesis > 1
    ? MIN_PARALLEL_DELAY
    : MIN_PROCESS_DELAY;

  processingTimeoutId = setTimeout(() => {
    processingTimeoutId = null;
    processCommentQueue();
  }, delay);
}

// スケジュール済み処理のキャンセル（停止用）
export function cancelScheduledProcessing(): void {
  if (processingTimeoutId !== null) {
    clearTimeout(processingTimeoutId);
    processingTimeoutId = null;
  }
  ttsProcessingCount = 0;
  nextSynthesisSeq = 0;
  nextAudioInsertSeq = 0;
  pendingResults.clear();
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

export function setMaxParallelSynthesis(count: number): void {
  maxParallelSynthesis = Math.max(1, Math.min(5, count));
}

export function getMaxParallelSynthesis(): number {
  return maxParallelSynthesis;
}

export function processCommentQueue(): void {
  const state = getState();
  if (state.commentQueue.length === 0) return;

  const maxConcurrent = currentEngine === 'local-voicevox' ? maxParallelSynthesis : 1;
  if (ttsProcessingCount >= maxConcurrent) return;

  const comment = shiftComment();
  if (!comment) return;

  // 並列再生マルチ話者: スロットに基づいて話者IDを上書き
  comment.speakerId = getParallelSpeakerId(comment.speakerId);

  if (currentEngine === 'browser') {
    // ブラウザTTS: API不要、直接audioQueueに追加
    // ランダム話者モード時はランダムな音声名を使用
    const effectiveVoice = isRandomSpeakerEnabled()
      ? (getRandomSpeakerId() || browserVoiceName)
      : browserVoiceName;
    const voiceLabel = effectiveVoice || 'default';
    sendDebugInfo(`ブラウザTTS [${voiceLabel}]：${comment.newMessage} | キュー: ${formatQueueState()}`);
    pushAudio({
      type: 'speech',
      text: comment.newMessage,
      voiceName: effectiveVoice || undefined,
    });
    updateBadge();
    evaluateRushMode();
    playNextAudio();
    scheduleNextProcessing();
    return;
  }

  if (currentEngine === 'local-voicevox') {
    // ローカルVOICEVOX: ローカルエンジンで音声合成
    ttsProcessingCount++;
    const seq = nextSynthesisSeq++;
    const localSpeakerLabel = getSpeakerName(comment.speakerId);
    sendDebugInfo(`ローカルVOICEVOX REQUEST [${localSpeakerLabel}] (seq=${seq}, 並列=${ttsProcessingCount}/${maxParallelSynthesis})：${comment.newMessage} | キュー: ${formatQueueState()}`);
    synthesizeLocalWithRetry(comment, 0, seq);
    // 並列スロットが空いていれば即座に次のコメントもスケジュール
    scheduleNextProcessing();
    return;
  }

  // VOICEVOX: TTS Quest APIで音声合成（常にシリアル）
  ttsProcessingCount++;
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
      // Stop後に完了した古いリクエストは破棄（カウンタはcancelScheduledProcessingでリセット済み）
      if (getState().sessionId !== currentSession) return;
      ttsProcessingCount--;

      sendDebugInfo(`VOICEVOX RESPONSE：${audioUrl} | キュー: ${formatQueueState()}`);

      pushAudio({ type: 'url', url: audioUrl });
      updateBadge();
      evaluateRushMode();
      playNextAudio();
      scheduleNextProcessing();
    })
    .catch((error: Error) => {
      // Stop後に完了した古いリクエストは破棄（カウンタはcancelScheduledProcessingでリセット済み）
      if (getState().sessionId !== currentSession) return;

      // レート制限: パイプラインを解放し、遅延リトライをスケジュール
      if (error instanceof RateLimitError) {
        ttsProcessingCount--;
        sendStatus('rate-limited');
        sendDebugInfo(
          `⚠ レート制限: ${error.retryAfter}秒待機 | text="${newMessage.substring(0, 20)}..." | キュー: ${formatQueueState()}`
        );

        if (rateLimitRetryCount >= MAX_RATE_LIMIT_RETRIES) {
          sendDebugInfo(
            `レート制限リトライ上限到達（${MAX_RATE_LIMIT_RETRIES}回）— コメントをスキップ: "${newMessage.substring(0, 20)}..."`
          );
          sendStatus('error', 'レート制限リトライ上限 — 生成スキップ');
          scheduleNextProcessing();
          return;
        }

        // 遅延リトライ（この間 audioQueue の再生は継続される）
        setTimeout(() => {
          if (getState().sessionId !== currentSession) return;

          // 別のコメントが処理中なら、このコメントをキューの先頭に戻す
          if (ttsProcessingCount > 0) {
            unshiftComment(comment);
            sendDebugInfo(
              `レート制限リトライ: 別コメント処理中のためキュー先頭に再挿入: "${newMessage.substring(0, 20)}..."`
            );
            return;
          }

          ttsProcessingCount++;
          synthesizeWithRetry(comment, retryCount, rateLimitRetryCount + 1);
        }, error.retryAfter * 1000);

        return;
      }

      // 通常のエラー処理
      if (retryCount < maxRetries) {
        sendDebugInfo(`VOICEVOXリトライ（${retryCount + 1}/${maxRetries}）: ${newMessage}`);
        // リトライ中は ttsProcessingCount を維持
        setTimeout(() => synthesizeWithRetry(comment, retryCount + 1, rateLimitRetryCount), 1000);
      } else {
        // リトライ上限到達: コメントをスキップ
        ttsProcessingCount--;
        sendDebugInfo(`VOICEVOXエラー（スキップ）: ${error.message} - "${newMessage}"`);
        sendStatus('error', `${error.message} — 生成スキップ`);
        // eslint-disable-next-line no-console
        console.error('VoiceVoxエラー:', error);
        scheduleNextProcessing();
      }
    });
}

// TTS Quest v3 API で音声合成を行い、音声URLを返す
export async function fetchVoiceVox(apiKey: string, text: string, speakerId?: string): Promise<string> {
  const encodedText = encodeURIComponent(text);
  const effectiveSpeakerId =
    speakerId || (await chrome.storage.sync.get(['speakerId'])).speakerId || '1';

  let url = `https://api.tts.quest/v3/voicevox/synthesis?text=${encodedText}&speaker=${effectiveSpeakerId}`;
  if (apiKey) {
    url += `&key=${encodeURIComponent(apiKey)}`;
  }

  const response = await fetchWithTimeout(url, 15_000);

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
      const res = await fetchWithTimeout(audioStatusUrl, 10_000);
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
  retryCount: number,
  seq: number
): void {
  const maxRetries = 3;
  const currentSession = getState().sessionId;
  const { newMessage, speakerId } = comment;

  sendStatus('generating');

  fetchLocalVoiceVox(newMessage, speakerId)
    .then((dataUri) => {
      // Stop後に完了した古いリクエストは破棄（カウンタはcancelScheduledProcessingでリセット済み）
      if (getState().sessionId !== currentSession) return;
      ttsProcessingCount--;

      sendDebugInfo(`ローカルVOICEVOX RESPONSE (seq=${seq})：data URI (${dataUri.length} chars) | キュー: ${formatQueueState()}`);

      insertInOrder(seq, { type: 'url', url: dataUri });
      updateBadge();
      evaluateRushMode();
      playNextAudio();
      scheduleNextProcessing();
    })
    .catch((error: Error) => {
      // Stop後に完了した古いリクエストは破棄（カウンタはcancelScheduledProcessingでリセット済み）
      if (getState().sessionId !== currentSession) return;

      if (retryCount < maxRetries) {
        sendDebugInfo(`ローカルVOICEVOXリトライ（${retryCount + 1}/${maxRetries}）: ${newMessage}`);
        setTimeout(() => synthesizeLocalWithRetry(comment, retryCount + 1, seq), 1000);
      } else {
        ttsProcessingCount--;
        // エラー時はスキップして順序を進める
        insertInOrder(seq, null);
        sendDebugInfo(`ローカルVOICEVOXエラー（スキップ）: ${error.message} - "${newMessage}"`);
        sendStatus('error', `${error.message} — 生成スキップ`);
        // eslint-disable-next-line no-console
        console.error('ローカルVOICEVOXエラー:', error);
        scheduleNextProcessing();
      }
    });
}

// 並列合成の結果を元のコメント順に audioQueue へ挿入する
export function insertInOrder(seq: number, item: AudioQueueItem | null): void {
  if (item) {
    pendingResults.set(seq, item);
  }

  // nextAudioInsertSeq から連続する完了済みアイテムをフラッシュ
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (pendingResults.has(nextAudioInsertSeq)) {
      const ready = pendingResults.get(nextAudioInsertSeq)!;
      pendingResults.delete(nextAudioInsertSeq);
      pushAudio(ready);
      nextAudioInsertSeq++;
    } else if (seq === nextAudioInsertSeq && !item) {
      // スキップ（エラー）: 番号を進める
      nextAudioInsertSeq++;
    } else {
      break;
    }
  }
}

// ローカル VOICEVOX API で音声合成（audio_query → synthesis → data URI）
export async function fetchLocalVoiceVox(text: string, speakerId?: string): Promise<string> {
  const effectiveSpeakerId =
    speakerId || (await chrome.storage.sync.get(['localSpeakerId'])).localSpeakerId || '1';
  const encodedText = encodeURIComponent(text);

  // Step 1: audio_query
  let audioQueryRes: Response;
  try {
    audioQueryRes = await fetchWithTimeout(
      `${localVoicevoxHost}/audio_query?text=${encodedText}&speaker=${effectiveSpeakerId}`,
      30_000,
      { method: 'POST' }
    );
  } catch {
    throw new Error('VOICEVOXエンジンに接続できません。アプリが起動しているか確認してください。');
  }

  if (!audioQueryRes.ok) {
    let detail = '';
    try {
      const body = await audioQueryRes.json();
      detail = JSON.stringify(body);
    } catch {
      try { detail = await audioQueryRes.text(); } catch { /* ignore */ }
    }
    throw new Error(`audio_query エラー (${audioQueryRes.status})${detail ? ': ' + detail : ''}`);
  }

  const audioQuery: unknown = await audioQueryRes.json();

  // Step 2: synthesis
  let synthesisRes: Response;
  try {
    synthesisRes = await fetchWithTimeout(
      `${localVoicevoxHost}/synthesis?speaker=${effectiveSpeakerId}`,
      60_000,
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
    let detail = '';
    try {
      const body = await synthesisRes.json();
      detail = JSON.stringify(body);
    } catch {
      try { detail = await synthesisRes.text(); } catch { /* ignore */ }
    }
    throw new Error(`synthesis エラー (${synthesisRes.status})${detail ? ': ' + detail : ''}`);
  }

  // Step 3: WAV バイナリ → data URI
  const arrayBuffer = await synthesisRes.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  return `data:audio/wav;base64,${base64}`;
}

// ArrayBuffer → Base64 文字列変換（チャンク分割で O(n) に最適化）
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}
