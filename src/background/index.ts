import { getState, updateState } from './state';
import { extractVideoId, fetchLiveChatId } from './youtube-api';
import { handleAudioEnded } from './audio-player';
import { initTabListeners } from './tab-manager';
import { startPolling, stopAll } from './lifecycle';
import { sendStatus, sendDebugInfo, updateErrorMessage } from './messaging';
import { loadFilterConfigFromStorage, setFilterConfig } from './comment-filter';
import type { FilterConfig } from './comment-filter';
import { setTtsEngine, setBrowserVoice } from './tts-api';
import type { TtsEngine } from '@/types/state';

// ポップアップ・ログページから session storage にアクセスできるようにする
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

// タブリスナー初期化
initTabListeners();

// フィルタ設定をストレージから読み込み
loadFilterConfigFromStorage();

// TTSエンジン設定をストレージから読み込み
chrome.storage.sync.get(['ttsEngine', 'browserVoice'], (data) => {
  if (data.ttsEngine) setTtsEngine(data.ttsEngine as TtsEngine);
  if (data.browserVoice) setBrowserVoice(data.browserVoice as string);
});

// 共通の読み上げ開始フロー（onMessageとonCommandで共有）
async function handleStart(config: {
  apiKeyVOICEVOX: string;
  apiKeyYoutube: string;
  speed: number;
  latestOnlyMode: boolean;
  speakerId?: string;
}): Promise<{ status: string; message?: string; details?: string }> {
  if (!config.apiKeyYoutube) {
    return { status: 'error', message: 'YouTube APIキーが入力されていません。' };
  }

  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'タブ取得エラー';
    return { status: 'error', message: msg };
  }

  if (!tabs || tabs.length === 0) {
    return { status: 'error', message: 'アクティブなタブが見つかりません。' };
  }

  // タブIDを保存
  updateState({ activeTabId: tabs[0].id, latestOnlyMode: config.latestOnlyMode });

  const videoId = extractVideoId(tabs[0].url || '');
  if (!videoId) {
    return { status: 'error', message: 'ビデオIDが見つかりません。' };
  }

  sendStatus('connecting');

  try {
    const liveChatId = await fetchLiveChatId(videoId, config.apiKeyYoutube);

    // デバッグ情報をポップアップに表示
    sendDebugInfo(`Video ID: ${videoId}\nIs Live: true\nLiveChatId: ${liveChatId}`);

    updateState({ liveChatId });

    startPolling({
      apiKeyVOICEVOX: config.apiKeyVOICEVOX,
      apiKeyYoutube: config.apiKeyYoutube,
      speed: config.speed,
      tabId: tabs[0].id!,
      speakerId: config.speakerId,
    });

    sendStatus('listening');
    return { status: 'success' };
  } catch (error) {
    const err = error as Error & { details?: unknown };
    // eslint-disable-next-line no-console
    console.error('YouTube APIリクエストエラー:', err);
    sendStatus('error', err.message);
    return {
      status: 'error',
      message: err.message,
      details: err.details ? JSON.stringify(err.details, null, 2) : undefined,
    };
  }
}

// メッセージルーター（統合された単一のリスナー）
chrome.runtime.onMessage.addListener(
  (
    request: { action: string; [key: string]: unknown },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    switch (request.action) {
      case 'start': {
        handleStart({
          apiKeyVOICEVOX: request.apiKeyVOICEVOX as string,
          apiKeyYoutube: request.apiKeyYoutube as string,
          speed: request.speed as number,
          latestOnlyMode: request.latestOnlyMode as boolean,
          speakerId: request.speakerId as string | undefined,
        })
          .then((response) => sendResponse(response))
          .catch((error: Error) => sendResponse({ status: 'error', message: error.message }));
        return true;
      }

      case 'stop': {
        stopAll();
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateLatestOnlyMode': {
        updateState({ latestOnlyMode: request.latestOnlyMode as boolean });

        // コメントキューをクリア（モード切替時に古いキューを消去）
        if (request.latestOnlyMode) {
          updateState({ commentQueue: [] });
        }

        // 現在のタイムスタンプを更新（新しいモードでの基準点として使用）
        updateState({ latestTimestamp: Date.now() });

        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateSpeaker': {
        const state = getState();
        const updatedQueue = state.commentQueue.map((comment) => ({
          ...comment,
          speakerId: request.speakerId as string,
        }));
        updateState({ commentQueue: updatedQueue });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'getStatus': {
        // popup再オープン時に現在のステータスを返す
        const state = getState();
        const queueLength = state.commentQueue.length + state.audioQueue.length;
        sendResponse({ status: state.currentStatus, commentCount: state.commentCount, queueLength });
        return true;
      }

      case 'audioEnded': {
        handleAudioEnded();
        if (sender?.tab?.id) {
          // playNextAudio は handleAudioEnded 内で呼ばれる
        }
        sendResponse({ status: 'success' });
        return true;
      }

      case 'setVolume': {
        const state = getState();
        if (!state.activeTabId) {
          sendResponse({ status: 'error', message: '再生中のタブがありません' });
          return true;
        }
        chrome.scripting.executeScript(
          {
            target: { tabId: state.activeTabId },
            func: (volume: number) => {
              if (window.currentAudio) {
                window.currentAudio.volume = volume;
              }
            },
            args: [request.volume as number],
          },
          () => {
            if (chrome.runtime.lastError) {
              // eslint-disable-next-line no-console
              console.error('音量設定エラー:', chrome.runtime.lastError.message);
            }
          }
        );
        sendResponse({ status: 'success' });
        return true;
      }

      case 'setSpeed': {
        const state = getState();
        if (!state.activeTabId) {
          sendResponse({ status: 'error', message: '再生中のタブがありません' });
          return true;
        }
        chrome.scripting.executeScript(
          {
            target: { tabId: state.activeTabId },
            func: (speed: number) => {
              if (window.currentAudio) {
                window.currentAudio.playbackRate = speed;
              }
            },
            args: [request.speed as number],
          },
          () => {
            if (chrome.runtime.lastError) {
              // eslint-disable-next-line no-console
              console.error('再生速度設定エラー:', chrome.runtime.lastError.message);
            }
          }
        );
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateQueueSpeed': {
        const state = getState();
        const updatedQueue = state.commentQueue.map((comment) => ({
          ...comment,
          speed: request.speed as number,
        }));
        updateState({ commentQueue: updatedQueue });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateFilterConfig': {
        const config = request.filterConfig as FilterConfig;
        setFilterConfig(config);
        chrome.storage.sync.set({ filterConfig: config });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateTtsEngine': {
        const engine = request.engine as TtsEngine;
        setTtsEngine(engine);
        chrome.storage.sync.set({ ttsEngine: engine });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateBrowserVoice': {
        const voiceName = request.voiceName as string;
        setBrowserVoice(voiceName);
        chrome.storage.sync.set({ browserVoice: voiceName });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'getStats': {
        chrome.storage.local.get({ stats: { totalCount: 0, lastActiveDate: '' } }, (data) => {
          sendResponse({ status: 'success', stats: data.stats });
        });
        return true;
      }
    }

    return true;
  }
);

// ショートカットキーハンドラー（共通の handleStart を使用）
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'start-reading') {
    const data = await chrome.storage.sync.get([
      'apiKeyVOICEVOX',
      'apiKeyYoutube',
      'speed',
      'volume',
      'latestOnlyMode',
      'speakerId',
    ]);

    if (!data.apiKeyYoutube) {
      // eslint-disable-next-line no-console
      console.error('YouTube APIキーが設定されていません。');
      updateErrorMessage('YouTube APIキーが設定されていません。');
      return;
    }

    try {
      const result = await handleStart({
        apiKeyVOICEVOX: data.apiKeyVOICEVOX || '',
        apiKeyYoutube: data.apiKeyYoutube,
        speed: data.speed || 1.0,
        latestOnlyMode: data.latestOnlyMode || false,
        speakerId: data.speakerId,
      });

      if (result.status === 'error') {
        updateErrorMessage(result.message || 'エラーが発生しました');
      } else {
        updateErrorMessage('エラーなし');
      }
    } catch (error) {
      const err = error as Error;
      sendStatus('error', err.message);
      updateErrorMessage(err.message);
    }
  } else if (command === 'stop-reading') {
    stopAll();
    sendDebugInfo('ショートカットキーによる停止コマンドを実行しました');
    updateErrorMessage('停止しました');
  }
});
