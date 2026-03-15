import { getState, updateState, shiftAudio } from './state';

// 次の音声を再生
export function playNextAudio(): void {
  const state = getState();
  if (state.isPlaying || state.audioQueue.length === 0) {
    return;
  }

  const audioUrl = shiftAudio();
  if (!audioUrl) return;

  const tabId = state.activeTabId;
  if (!tabId) return;

  updateState({ isPlaying: true });

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
    const speed = data.speed !== undefined ? data.speed : 1.0;

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
          updateState({ isPlaying: false });
          if (getState().playingTimeout) {
            clearTimeout(getState().playingTimeout!);
            updateState({ playingTimeout: null });
          }
        }
      }
    );
  });
}

// 現在のタブで再生中の音声を停止
export function stopCurrentAudio(): void {
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
  updateState({
    isPlaying: false,
    playingTimeout: null,
  });
  updateBadge();
  playNextAudio();
}

// アイコンバッジ更新
export function updateBadge(): void {
  const state = getState();
  const queueLen = state.commentQueue.length + state.audioQueue.length;

  if (queueLen > 0 && (state.intervalId !== null || state.commentIntervalId !== null)) {
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
