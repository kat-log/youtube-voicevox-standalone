import type { TTSQuestSynthesisResponse, TTSQuestAudioStatusResponse } from '@/types/api-responses';
import type { TtsEngine } from '@/types/state';
import { getState, shiftComment, pushAudio } from './state';
import { sendDebugInfo, sendStatus } from './messaging';
import { playNextAudio, updateBadge } from './audio-player';

// TTSエンジン設定（モジュールレベルキャッシュ）
let currentEngine: TtsEngine = 'voicevox';
let browserVoiceName: string | null = null;

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
  if (state.commentQueue.length === 0) {
    return;
  }

  const comment = shiftComment();
  if (!comment) return;

  if (currentEngine === 'browser') {
    // ブラウザTTS: API不要、直接audioQueueに追加
    sendDebugInfo(`ブラウザTTS：${comment.newMessage}`);
    pushAudio({
      type: 'speech',
      text: comment.newMessage,
      voiceName: browserVoiceName || undefined,
    });
    sendStatus('listening');
    updateBadge();
    playNextAudio();
    return;
  }

  // VOICEVOX: TTS Quest APIで音声合成
  sendDebugInfo(`VOICEVOX REQUEST：${comment.newMessage}`);
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
      // Stop後に完了した古いリクエストは破棄
      if (getState().sessionId !== currentSession) return;

      sendDebugInfo(`VOICEVOX RESPONSE：${audioUrl}`);

      pushAudio({ type: 'url', url: audioUrl });
      sendStatus('listening');
      updateBadge();
      playNextAudio();
    })
    .catch((error: Error) => {
      // Stop後に完了した古いリクエストは破棄
      if (getState().sessionId !== currentSession) return;

      if (retryCount < maxRetries) {
        sendDebugInfo(`VOICEVOXリトライ（${retryCount + 1}/${maxRetries}）: ${newMessage}`);
        setTimeout(() => synthesizeWithRetry(comment, retryCount + 1), 1000);
      } else {
        // リトライ上限到達: コメントをスキップ
        sendDebugInfo(`VOICEVOXエラー（スキップ）: ${error.message} - "${newMessage}"`);
        // eslint-disable-next-line no-console
        console.error('VoiceVoxエラー:', error);
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
    sendDebugInfo(`レート制限: ${data.retryAfter || 5}秒待機中...`);
    await new Promise((r) => setTimeout(r, waitMs));
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
