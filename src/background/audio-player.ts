import {
  getState,
  updateState,
  shiftAudio,
  unshiftAudio,
  incrementPlayingCount,
  decrementPlayingCount,
  setPlayingTimeout,
  clearPlayingTimeout,
  clearAllPlayingTimeouts,
} from './state';
import { sendStatus, sendDebugInfo, formatQueueState } from './messaging';
import { scheduleNextProcessing } from './tts-api';
import { evaluateRushMode, resolveEffectiveSpeed } from './rush-mode';
import { getEffectiveMaxConcurrent } from './parallel-playback';

/** chrome.tts の rate を補正（エンジンの指数的スケーリングを相殺） */
function correctTtsRate(sliderSpeed: number): number {
  return Math.sqrt(sliderSpeed);
}

/** 指定音声が rate パラメータをサポートするか判定 */
function isRateSupportedVoice(voiceName: string | undefined): boolean {
  if (!voiceName) return true;
  const name = voiceName.toLowerCase();
  return name === 'kyoko' || name.startsWith('google');
}

// キュー空通知の重複防止フラグ
let lastQueueEmptyLogged = false;

// audioId 生成
let audioIdCounter = 0;
function generateAudioId(): string {
  return `audio-${Date.now()}-${audioIdCounter++}`;
}

// chrome.tts 用の現在の audioId（1つしか再生できないため）
let currentChromeTtsAudioId = '';

// 次の音声を再生（並列対応: maxConcurrent まで同時再生）
export function playNextAudio(): void {
  const maxConcurrent = getEffectiveMaxConcurrent();

  // maxConcurrent まで同時にキューから取り出して再生
  while (getState().playingCount < maxConcurrent && getState().audioQueue.length > 0) {
    const item = shiftAudio();
    if (!item) break;

    // chrome.tts は並列再生不可: 他の音声が再生中ならキューに戻して中断
    if (item.type === 'speech' && getState().playingCount > 0) {
      unshiftAudio(item);
      break;
    }

    const audioId = generateAudioId();
    incrementPlayingCount();
    lastQueueEmptyLogged = false;

    sendStatus('listening');
    sendDebugInfo(`▶ 再生開始 [${audioId}] | 同時再生: ${getState().playingCount}/${maxConcurrent} | キュー: ${formatQueueState()}`);

    // フェイルセーフタイマー（30秒で強制リセット）
    const timeout = setTimeout(() => {
      if (getState().playingCount > 0) {
        // eslint-disable-next-line no-console
        console.warn(`音声再生タイムアウト [${audioId}]: playingCountをデクリメント`);
        sendDebugInfo(`⚠ 音声再生タイムアウト [${audioId}]: 30秒経過で強制終了`);
        handleAudioEndedById(audioId);
      }
    }, 30000);
    setPlayingTimeout(audioId, timeout);

    // 音量・速度を取得して再生
    const capturedAudioId = audioId;
    const capturedItem = item;
    chrome.storage.sync.get(['volume', 'speed'], (data) => {
      const volume = data.volume !== undefined ? data.volume : 1.0;
      const baseSpeed = data.speed !== undefined ? data.speed : 1.0;
      const speed = resolveEffectiveSpeed(baseSpeed);

      if (capturedItem.type === 'url') {
        playAudioViaOffscreen(capturedAudioId, capturedItem.url!, volume, speed);
      } else {
        currentChromeTtsAudioId = capturedAudioId;
        playSpeechSynthesis(capturedAudioId, capturedItem.text!, capturedItem.voiceName, volume, speed);
      }
    });
  }

  // キュー空チェック（何も再生中でない場合のみ）
  const state = getState();
  if (state.playingCount === 0 && state.audioQueue.length === 0) {
    if (state.commentQueue.length === 0 && !lastQueueEmptyLogged) {
      sendDebugInfo(`⏸ キュー空 - 次のポーリング待ち`);
      sendStatus('waiting');
      lastQueueEmptyLogged = true;
    } else if (state.commentQueue.length > 0) {
      sendDebugInfo(`⏳ audioQueue空 / commentキュー: ${state.commentQueue.length}件 - TTS生成待ち`);
    }
  }
}

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });
  if (existingContexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'VOICEVOX TTS audio playback',
  });
}

// VOICEVOX: Offscreen Documentで再生
async function playAudioViaOffscreen(audioId: string, audioUrl: string, volume: number, speed: number): Promise<void> {
  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'playAudio',
      audioId,
      url: audioUrl,
      volume,
      speed,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Offscreen再生エラー:', (error as Error).message);
    sendDebugInfo(`⚠ Offscreen再生エラー: ${(error as Error).message}`);
    handlePlaybackErrorById(audioId);
  }
}

// ブラウザTTS: chrome.tts APIで再生
function playSpeechSynthesis(
  audioId: string,
  text: string,
  voiceName: string | undefined,
  volume: number,
  speed: number
): void {
  chrome.tts.speak(
    text,
    {
      voiceName: voiceName || undefined,
      lang: 'ja-JP',
      rate: isRateSupportedVoice(voiceName) ? correctTtsRate(speed) : 1.0,
      volume: isRateSupportedVoice(voiceName) ? volume : 1.0,
      onEvent: (event) => {
        if (
          event.type === 'end' ||
          event.type === 'interrupted' ||
          event.type === 'cancelled' ||
          event.type === 'error'
        ) {
          if (event.type === 'error') {
            // eslint-disable-next-line no-console
            console.error('chrome.tts error:', event.errorMessage);
            sendDebugInfo(`⚠ ブラウザTTSエラー: ${event.errorMessage || '不明'}`);
          }
          handleAudioEndedById(audioId);
        }
      },
    },
    () => {
      if (chrome.runtime.lastError) {
        // eslint-disable-next-line no-console
        console.error('chrome.tts.speakエラー:', chrome.runtime.lastError.message);
        sendDebugInfo(`⚠ ブラウザTTS再生エラー: ${chrome.runtime.lastError.message}`);
        handlePlaybackErrorById(audioId);
      }
    }
  );
}

// 再生エラー時の共通処理
function handlePlaybackErrorById(audioId: string): void {
  clearPlayingTimeout(audioId);
  decrementPlayingCount();
  sendDebugInfo(`⚠ 再生エラー回復 [${audioId}] | 同時再生: ${getState().playingCount} | キュー: ${formatQueueState()}`);
  playNextAudio();
  scheduleNextProcessing();
}

// 現在の音声を停止（全音声）
export function stopCurrentAudio(): void {
  // ブラウザTTS（chrome.tts）を停止
  chrome.tts.stop();

  // VOICEVOX: Offscreen Documentの全音声を停止
  chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'stopAudio',
  }).catch(() => {
    // Offscreen documentが存在しない場合は無視
  });

  // 再生カウントと全タイムアウトをリセット
  updateState({ playingCount: 0 });
  clearAllPlayingTimeouts();
}

// audioEnded メッセージのハンドラー（audioId指定）
export function handleAudioEndedById(audioId: string): void {
  clearPlayingTimeout(audioId);
  decrementPlayingCount();

  const state = getState();
  state.commentCount++;
  incrementCumulativeCount();
  updateBadge();
  evaluateRushMode();
  sendDebugInfo(`■ 再生終了 [${audioId}] | 同時再生: ${state.playingCount} | キュー: ${formatQueueState()}`);

  // キュー状態に応じたステータス設定
  if (state.playingCount === 0 && state.audioQueue.length === 0 && state.commentQueue.length === 0) {
    sendStatus('waiting');
  }

  playNextAudio();
  scheduleNextProcessing();
}

// 後方互換: audioId なしの handleAudioEnded（chrome.tts完了時用）
export function handleAudioEnded(): void {
  handleAudioEndedById(currentChromeTtsAudioId || 'unknown');
}

// 累計読み上げ数を永続化してブロードキャスト
function incrementCumulativeCount(): void {
  chrome.storage.local.get({ stats: { totalCount: 0, lastActiveDate: '' } }, (data) => {
    const stats = data.stats;
    stats.totalCount++;
    stats.lastActiveDate = new Date().toISOString().split('T')[0];
    chrome.storage.local.set({ stats });
    chrome.runtime.sendMessage({ action: 'updateStats', totalCount: stats.totalCount }).catch(() => {});
  });
}

// アイコンバッジ更新
export function updateBadge(): void {
  const state = getState();
  const queueLen = state.commentQueue.length + state.audioQueue.length;

  if (queueLen > 0 && state.intervalId !== null) {
    chrome.action.setBadgeText({ text: String(queueLen) });
    chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// バッジクリア
export function clearBadge(): void {
  chrome.action.setBadgeText({ text: '' });
}
