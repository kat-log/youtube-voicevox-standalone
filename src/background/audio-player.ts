import { getState, updateState, shiftAudio } from './state';
import { sendStatus, sendDebugInfo, formatQueueState } from './messaging';
import { scheduleNextProcessing } from './tts-api';
import { evaluateRushMode, resolveEffectiveSpeed } from './rush-mode';

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

// 次の音声を再生
export function playNextAudio(): void {
  const state = getState();
  if (state.isPlaying || state.audioQueue.length === 0) {
    if (!state.isPlaying && state.audioQueue.length === 0 && state.commentQueue.length === 0 && !lastQueueEmptyLogged) {
      sendDebugInfo(`⏸ キュー空 - 次のポーリング待ち`);
      sendStatus('waiting');
      lastQueueEmptyLogged = true;
    } else if (!state.isPlaying && state.audioQueue.length === 0 && state.commentQueue.length > 0) {
      sendDebugInfo(`⏳ audioQueue空 / commentキュー: ${state.commentQueue.length}件 - TTS生成待ち`);
    }
    return;
  }
  lastQueueEmptyLogged = false;

  const item = shiftAudio();
  if (!item) return;

  const tabId = state.activeTabId;
  if (!tabId) return;

  updateState({ isPlaying: true });
  sendStatus('listening');
  sendDebugInfo(`▶ 再生開始 | キュー: ${formatQueueState()}`);

  // フェイルセーフタイマー（30秒で強制リセット）
  if (state.playingTimeout) {
    clearTimeout(state.playingTimeout);
  }
  const timeout = setTimeout(() => {
    if (getState().isPlaying) {
      // eslint-disable-next-line no-console
      console.warn('音声再生タイムアウト: isPlayingを強制リセット');
      updateState({ isPlaying: false });
      playNextAudio();
    }
  }, 30000);
  updateState({ playingTimeout: timeout });

  chrome.storage.sync.get(['volume', 'speed'], (data) => {
    const volume = data.volume !== undefined ? data.volume : 1.0;
    const baseSpeed = data.speed !== undefined ? data.speed : 1.0;
    const speed = resolveEffectiveSpeed(baseSpeed);

    if (item.type === 'url') {
      injectAudioUrl(tabId, item.url!, volume, speed);
    } else {
      playSpeechSynthesis(item.text!, item.voiceName, volume, speed);
    }
  });
}

// VOICEVOX: Audio要素をタブに注入して再生
function injectAudioUrl(tabId: number, audioUrl: string, volume: number, speed: number): void {
  chrome.scripting.executeScript(
    {
      target: { tabId },
      func: (audioUrl: string, volume: number, speed: number) => {
        if (window.currentAudio) {
          window.currentAudio.pause();
        }
        const audio = new Audio(audioUrl);
        audio.volume = volume;
        audio.playbackRate = speed;
        window.currentAudio = audio;
        audio.play();
        audio.onended = () => {
          chrome.runtime.sendMessage({ action: 'audioEnded' });
        };
      },
      args: [audioUrl, volume, speed],
    },
    () => {
      if (chrome.runtime.lastError) {
        // eslint-disable-next-line no-console
        console.error('VoiceVoxエラー:', chrome.runtime.lastError.message);
        handlePlaybackError();
      }
    }
  );
}

// ブラウザTTS: chrome.tts APIで再生
function playSpeechSynthesis(
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
          }
          handleAudioEnded();
        }
      },
    },
    () => {
      if (chrome.runtime.lastError) {
        // eslint-disable-next-line no-console
        console.error('chrome.tts.speakエラー:', chrome.runtime.lastError.message);
        handlePlaybackError();
      }
    }
  );
}

// 再生エラー時の共通処理
function handlePlaybackError(): void {
  updateState({ isPlaying: false });
  const state = getState();
  if (state.playingTimeout) {
    clearTimeout(state.playingTimeout);
    updateState({ playingTimeout: null });
  }
  scheduleNextProcessing();
}

// 現在の音声を停止
export function stopCurrentAudio(): void {
  // ブラウザTTS（chrome.tts）を停止 - 再生中でなくても安全に呼び出し可
  chrome.tts.stop();

  // VOICEVOX: タブ内のAudio要素を停止
  const state = getState();
  if (!state.activeTabId) return;

  chrome.scripting
    .executeScript({
      target: { tabId: state.activeTabId },
      func: () => {
        if (window.currentAudio) {
          window.currentAudio.pause();
          window.currentAudio = null;
        }
      },
    })
    .catch(() => {
      // タブが既に閉じている場合は無視
    });
}

// audioEnded メッセージのハンドラー
export function handleAudioEnded(): void {
  const state = getState();
  if (state.playingTimeout) {
    clearTimeout(state.playingTimeout);
  }
  state.commentCount++;
  updateState({
    isPlaying: false,
    playingTimeout: null,
  });
  incrementCumulativeCount();
  updateBadge();
  evaluateRushMode();
  sendDebugInfo(`■ 再生終了 | キュー: ${formatQueueState()}`);

  // キュー状態に応じたステータス設定（playNextAudio/scheduleNextProcessingが適切に更新）
  const updatedState = getState();
  if (updatedState.audioQueue.length === 0 && updatedState.commentQueue.length === 0) {
    sendStatus('waiting');
  }

  playNextAudio();
  scheduleNextProcessing();
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
