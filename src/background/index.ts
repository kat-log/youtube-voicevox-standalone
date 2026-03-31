import { getState, updateState, incrementSessionId } from './state';
import { extractVideoId, fetchLiveChatId } from './youtube-api';
import { handleAudioEnded, handleAudioEndedById, initPlaybackSettings, updateCachedVolume, updateCachedSpeed } from './audio-player';
import { initTabListeners } from './tab-manager';
import { startPolling, stopAll } from './lifecycle';
import { processChatMessages, getStandaloneConfig, setStandaloneConfig } from './lifecycle-internal';
import { sendStatus, logInfo, logWarn, updateErrorMessage } from './messaging';
import { loadFilterConfigFromStorage, setFilterConfig } from './comment-filter';
import { setTtsEngine, setBrowserVoice, setLocalVoicevoxHost, setMaxParallelSynthesis, cancelScheduledProcessing } from './tts-api';
import { loadRushConfigFromStorage, setRushConfig, evaluateRushMode } from './rush-mode';
import { loadAutoCatchUpConfigFromStorage, setAutoCatchUpConfig } from './auto-catchup';
import { loadParallelPlaybackConfigFromStorage, setParallelPlaybackConfig, loadParallelSpeakersConfigFromStorage, setParallelSpeakersConfig } from './parallel-playback';
import { loadRandomSpeakerConfigFromStorage, setRandomSpeakerEnabled, setRandomSpeakerEngine, setAllowedSpeakerIds, isRandomSpeakerEnabled, getRandomSpeakerStorageKey } from './random-speaker';
import { initSpeakerNames, initLocalSpeakerNames, setSpeakerNameEngine } from './speaker-names';
import { handleTestSpeak, isTestAudioId, handleTestAudioEnded, handleTestAudioError } from './test-speak';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
import type { TtsEngine } from '@/types/state';
import type { IncomingMessage } from '@/types/messages';

// ポップアップ・ログページから session storage にアクセスできるようにする
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

// タブリスナー初期化
initTabListeners();

// フィルタ設定をストレージから読み込み
loadFilterConfigFromStorage();

// ラッシュモード設定をストレージから読み込み
loadRushConfigFromStorage();

// 自動キャッチアップ設定をストレージから読み込み
loadAutoCatchUpConfigFromStorage();

// 並列再生設定をストレージから読み込み
loadParallelPlaybackConfigFromStorage();

// 並列再生マルチ話者設定をストレージから読み込み
loadParallelSpeakersConfigFromStorage();

// ランダム話者設定をストレージから読み込み
loadRandomSpeakerConfigFromStorage();

// 音量・速度キャッシュを初期化
initPlaybackSettings();

// 話者名キャッシュを初期化
initSpeakerNames();

// TTSエンジン設定をストレージから読み込み
chrome.storage.sync.get(['ttsEngine', 'browserVoice', 'localVoicevoxHost', 'parallelSynthesisCount'], (data) => {
  const engine = data.ttsEngine as TtsEngine | undefined;
  if (engine) {
    setTtsEngine(engine);
    setSpeakerNameEngine(engine);
  }
  if (data.browserVoice) setBrowserVoice(data.browserVoice as string);
  if (data.localVoicevoxHost) {
    setLocalVoicevoxHost(data.localVoicevoxHost as string);
    if (engine === 'local-voicevox') {
      initLocalSpeakerNames(data.localVoicevoxHost as string);
    }
  }
  if (data.parallelSynthesisCount) {
    setMaxParallelSynthesis(data.parallelSynthesisCount as number);
  }
});

// 共通の読み上げ開始フロー（onMessageとonCommandで共有）
async function handleStart(config: {
  apiKeyVOICEVOX: string;
  apiKeyYoutube: string;
  speed: number;
  latestOnlyMode: boolean;
  latestOnlyCount: number;
  speakerId?: string;
  chatMode?: 'official' | 'dom';
}): Promise<{ status: string; message?: string; details?: string }> {
  if ((config.chatMode ?? 'dom') === 'official' && !config.apiKeyYoutube) {
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
  updateState({
    activeTabId: tabs[0].id,
    latestOnlyMode: config.latestOnlyMode,
    latestOnlyCount: config.latestOnlyCount,
  });

  const videoId = extractVideoId(tabs[0].url || '');
  if (!videoId) {
    return { status: 'error', message: 'ビデオIDが見つかりません。' };
  }

  // DOMモード: YouTube のチャット DOM を MutationObserver で監視（fetchLiveChatId 不要）
  if (config.chatMode === 'dom') {
    updateState({ liveChatId: 'dom' });
    setStandaloneConfig({
      apiKeyVOICEVOX: config.apiKeyVOICEVOX,
      speed: config.speed,
      tabId: tabs[0].id!,
      speakerId: config.speakerId,
    });
    // storage にモードをセット（content script の onChanged で検知）
    await chrome.storage.session.set({ chatMode: 'dom', domModeActive: true });
    // live_chat iframe を含む全フレームに domChat.js を注入（既存タブ対応）
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id!, allFrames: true },
        files: ['domChat.js'],
      });
      logInfo(`DOMモード開始: tabId=${tabs[0].id}, videoId=${videoId} (全フレームに注入済み)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logWarn(`DOMモード: スクリプト注入エラー: ${msg} (storage onChanged にフォールバック)`);
      logInfo(`DOMモード開始: tabId=${tabs[0].id}, videoId=${videoId}`);
    }
    sendStatus('waiting');
    return { status: 'success' };
  }

  sendStatus('connecting');

  try {
    const liveChatId = await fetchLiveChatId(videoId, config.apiKeyYoutube);

    // デバッグ情報をポップアップに表示
    logInfo(`Video ID: ${videoId}\nIs Live: true\nLiveChatId: ${liveChatId}`);

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
    request: IncomingMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    switch (request.action) {
      case 'start': {
        handleStart({
          apiKeyVOICEVOX: request.apiKeyVOICEVOX,
          apiKeyYoutube: request.apiKeyYoutube,
          speed: request.speed,
          latestOnlyMode: request.latestOnlyMode,
          latestOnlyCount: request.latestOnlyCount || 3,
          speakerId: request.speakerId,
          chatMode: request.chatMode,
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
        updateState({
          latestOnlyMode: request.latestOnlyMode,
          latestOnlyCount: request.latestOnlyCount || 3,
        });

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
        // ランダム話者モード時はキュー内のspeakerIdを上書きしない
        if (!isRandomSpeakerEnabled()) {
          const state = getState();
          const updatedQueue = state.commentQueue.map((comment) => ({
            ...comment,
            speakerId: request.speakerId,
          }));
          updateState({ commentQueue: updatedQueue });
        }
        sendResponse({ status: 'success' });
        return true;
      }

      case 'getStatus': {
        // popup再オープン時に現在のステータスを返す
        const state = getState();
        const queueLength = state.commentQueue.length + state.audioQueue.length;
        sendResponse({ status: state.currentStatus, commentCount: state.commentCount, queueLength, isRushActive: state.isRushActive });
        return true;
      }

      case 'audioEnded': {
        const audioId = request.audioId;
        if (audioId && isTestAudioId(audioId)) {
          handleTestAudioEnded(audioId);
        } else if (audioId) {
          handleAudioEndedById(audioId);
        } else {
          handleAudioEnded();
        }
        sendResponse({ status: 'success' });
        return true;
      }

      case 'audioError': {
        const audioId = request.audioId;
        if (audioId && isTestAudioId(audioId)) {
          handleTestAudioError(audioId);
        } else {
          // eslint-disable-next-line no-console
          console.error('Offscreen audio再生エラー', audioId);
          logWarn(`⚠ Offscreen audio再生エラー [${audioId || '不明'}]`);
          if (audioId) {
            handleAudioEndedById(audioId);
          } else {
            handleAudioEnded();
          }
        }
        sendResponse({ status: 'success' });
        return true;
      }

      case 'setVolume': {
        updateCachedVolume(request.volume);
        chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'setVolume',
          volume: request.volume,
        }).catch(() => {});
        sendResponse({ status: 'success' });
        return true;
      }

      case 'setSpeed': {
        updateCachedSpeed(request.speed);
        chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'setSpeed',
          speed: request.speed,
        }).catch(() => {});
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateQueueSpeed': {
        const state = getState();
        const updatedQueue = state.commentQueue.map((comment) => ({
          ...comment,
          speed: request.speed,
        }));
        updateState({ commentQueue: updatedQueue });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateFilterConfig': {
        const config = request.filterConfig;
        setFilterConfig(config);
        chrome.storage.sync.set({ filterConfig: config });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateRushModeConfig': {
        const config = request.rushModeConfig;
        setRushConfig(config);
        chrome.storage.sync.set({ rushModeConfig: config });
        evaluateRushMode();
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateAutoCatchUpConfig': {
        const config = request.autoCatchUpConfig;
        setAutoCatchUpConfig(config);
        chrome.storage.sync.set({ autoCatchUpConfig: config });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateParallelPlaybackConfig': {
        const config = request.parallelPlaybackConfig;
        setParallelPlaybackConfig(config);
        chrome.storage.sync.set({ parallelPlaybackConfig: config });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateParallelSpeakersConfig': {
        const config = request.parallelSpeakersConfig;
        setParallelSpeakersConfig(config);
        chrome.storage.sync.set({ parallelSpeakersConfig: config });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateRandomSpeakerConfig': {
        const enabled = request.enabled;
        const engine = request.engine;
        const host = request.host;
        if (engine) {
          setRandomSpeakerEngine(engine, host);
        }
        setRandomSpeakerEnabled(enabled);
        chrome.storage.sync.set({ randomSpeakerEnabled: enabled });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateRandomSpeakerAllowedIds': {
        const ids = request.ids;
        const engine = request.engine;
        const storageKey = getRandomSpeakerStorageKey(engine);
        setAllowedSpeakerIds(ids);
        chrome.storage.sync.set({ [storageKey]: ids });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'getSpeakerList': {
        fetchWithTimeout('https://static.tts.quest/voicevox_speakers.json', 10_000)
          .then((res) => res.json())
          .then((speakers) => {
            sendResponse({ status: 'success', speakers });
          })
          .catch((error: Error) => {
            sendResponse({ status: 'error', message: error.message });
          });
        return true;
      }

      case 'updateTtsEngine': {
        const engine = request.engine;
        cancelScheduledProcessing();
        incrementSessionId();
        setTtsEngine(engine);
        setSpeakerNameEngine(engine);
        chrome.storage.sync.set({ ttsEngine: engine });
        // ランダム話者のソースエンジンも切替
        chrome.storage.sync.get(['localVoicevoxHost'], (data) => {
          setRandomSpeakerEngine(engine, data.localVoicevoxHost);
          if (engine === 'local-voicevox' && data.localVoicevoxHost) {
            initLocalSpeakerNames(data.localVoicevoxHost);
          }
        });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateBrowserVoice': {
        const voiceName = request.voiceName;
        setBrowserVoice(voiceName);
        chrome.storage.sync.set({ browserVoice: voiceName });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateLocalVoicevoxHost': {
        const host = request.host;
        setLocalVoicevoxHost(host);
        chrome.storage.sync.set({ localVoicevoxHost: host });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'updateParallelSynthesis': {
        const count = request.count;
        setMaxParallelSynthesis(count);
        chrome.storage.sync.set({ parallelSynthesisCount: count });
        sendResponse({ status: 'success' });
        return true;
      }

      case 'testSpeak': {
        handleTestSpeak(request.text, request.speakerId)
          .then((response) => sendResponse(response))
          .catch((error: Error) => sendResponse({ status: 'error', message: error.message }));
        return true;
      }

      case 'testLocalVoicevox': {
        const host = request.host;
        fetchWithTimeout(`${host}/version`, 5_000)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((version) => {
            sendResponse({ status: 'success', message: String(version) });
          })
          .catch((error: Error) => {
            sendResponse({ status: 'error', message: error.message });
          });
        return true;
      }

      case 'getLocalSpeakers': {
        const host = request.host;
        fetchWithTimeout(`${host}/speakers`, 10_000)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((speakers) => {
            sendResponse({ status: 'success', speakers });
          })
          .catch((error: Error) => {
            sendResponse({ status: 'error', message: error.message });
          });
        return true;
      }

      case 'getStats': {
        chrome.storage.local.get({ stats: { totalCount: 0, lastActiveDate: '' } }, (data) => {
          sendResponse({ status: 'success', stats: data.stats });
        });
        return true;
      }

      case 'domChatMessages': {
        const config = getStandaloneConfig();
        if (config) processChatMessages(request.messages, config);
        sendResponse({ status: 'success' });
        return true;
      }

      case 'domChatError': {
        logWarn(`DOMチャット取得エラー: ${request.message}`);
        sendResponse({ status: 'success' });
        return true;
      }

      case 'domChatLog': {
        logInfo(`[DOM] ${request.message}`);
        sendResponse({ status: 'success' });
        return true;
      }

      default: {
        // ランタイムでは未知の action が届く可能性がある
        const _: never = request;
        const action = (_ as { action: string }).action;
        // eslint-disable-next-line no-console
        console.warn(`Unknown message action: ${action}`);
        logWarn(`⚠ 未知のメッセージaction: ${action}`);
        sendResponse({ status: 'error', message: `Unknown action: ${action}` });
        return true;
      }
    }
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
      'latestOnlyCount',
      'speakerId',
      'ttsEngine',
      'localSpeakerId',
      'chatMode',
    ]);

    const mode = (data.chatMode ?? 'dom') as 'official' | 'dom';

    if (mode === 'official' && !data.apiKeyYoutube) {
      // eslint-disable-next-line no-console
      console.error('YouTube APIキーが設定されていません。');
      updateErrorMessage('YouTube APIキーが設定されていません。');
      return;
    }

    const shortcutEngine = data.ttsEngine || 'local-voicevox';
    const shortcutSpeakerId = shortcutEngine === 'local-voicevox'
      ? data.localSpeakerId
      : data.speakerId;

    try {
      const result = await handleStart({
        apiKeyVOICEVOX: data.apiKeyVOICEVOX || '',
        apiKeyYoutube: data.apiKeyYoutube || '',
        speed: data.speed || 1.0,
        latestOnlyMode: data.latestOnlyMode || false,
        latestOnlyCount: data.latestOnlyCount || 3,
        speakerId: shortcutSpeakerId,
        chatMode: mode,
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
    logInfo('ショートカットキーによる停止コマンドを実行しました');
    updateErrorMessage('停止しました');
  }
});
