import { getState, updateState, resetState, incrementSessionId, pushComment, clearAllPlayingTimeouts } from './state';
import { LiveChatEndedError } from './youtube-api';
import { scheduleNextProcessing, cancelScheduledProcessing } from './tts-api';
import { stopCurrentAudio, updateBadge, clearBadge } from './audio-player';
import { sendStatus, logDebug, logInfo, logWarn, formatQueueState, clearDebugLogs } from './messaging';
import { ERROR_THRESHOLD_FOR_STATUS } from './state';
import { shouldFilter, getFilterConfig, stripEmojis, removeNgWords } from './comment-filter';
import { evaluateRushMode } from './rush-mode';
import { evaluateAutoCatchUp, getAutoCatchUpConfig } from './auto-catchup';
import { isRandomSpeakerEnabled, getRandomSpeakerId } from './random-speaker';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

// ポーリング開始
export function startPolling(config: {
  apiKeyVOICEVOX: string;
  apiKeyYoutube: string;
  speed: number;
  tabId: number;
  speakerId?: string;
}): void {
  // 新セッション開始時に前回のログをクリア
  clearDebugLogs();

  // ポーリング開始時にエラーカウンタとポーリング間隔をリセット
  const wasRateLimited = getState().isYouTubeRateLimited;
  updateState({ consecutiveErrors: 0, pollingIntervalMs: 5000 });

  if (wasRateLimited) {
    sendStatus('error', 'YouTube APIレート制限（403）');
    logWarn('🚫 前回のセッションでYouTube APIレート制限が検知されています');
  }
  let isFirstFetch = true;

  const getEffectiveSpeakerId = (): string | undefined =>
    isRandomSpeakerEnabled() ? (getRandomSpeakerId() || config.speakerId) : config.speakerId;

  const checkNewComments = async (): Promise<void> => {
    const state = getState();
    // ポーリング停止判定
    if (!state.liveChatId || !state.activeTabId) return;

    // 毎回最新のnextPageTokenでURLを構築
    const requestUrl = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${state.liveChatId}&part=snippet,authorDetails&key=${config.apiKeyYoutube}${
      state.nextPageToken ? `&pageToken=${state.nextPageToken}` : ''
    }`;

    // ポーリングサイクルのセパレータログ
    const cycleNum = state.pollingCycleCount + 1;
    updateState({ pollingCycleCount: cycleNum });
    logDebug(`══════ Poll #${cycleNum} (interval: ${state.pollingIntervalMs}ms) ══════`);

    // YouTube APIにリクエストを送る直前にステータスを更新（再生中はちらつき防止）
    if (getState().playingCount === 0) {
      sendStatus('fetching');
    }

    try {
      const response = await fetchWithTimeout(requestUrl, 15_000);

      if (!response.ok) {
        if (response.status === 403) {
          // 配信終了の検出: liveChatEnded reason をチェック
          try {
            const errorData = await response.json();
            if (
              errorData?.error?.errors?.some(
                (e: { reason: string }) => e.reason === 'liveChatEnded'
              )
            ) {
              throw new LiveChatEndedError('ライブ配信が終了しました。');
            }
          } catch (e) {
            if (e instanceof LiveChatEndedError) throw e;
            // JSONパース失敗は無視してレート制限として扱う
          }
          // liveChatEnded以外の403はレート制限
          const rateLimitError = new Error('YouTube APIレート制限（403）') as Error & {
            isRateLimit: boolean;
          };
          rateLimitError.isRateLimit = true;
          throw rateLimitError;
        }
        throw new Error(`YouTube APIリクエストに失敗しました（${response.status}）。`);
      }

      const data = await response.json();
      if (!data) return;

      // 成功時にエラーカウンタとレート制限フラグをリセット
      updateState({ consecutiveErrors: 0, isYouTubeRateLimited: false });

      // YouTube APIの推奨ポーリング間隔を保存
      if (data.pollingIntervalMillis) {
        updateState({ pollingIntervalMs: data.pollingIntervalMillis });
      }

      // エラー状態からの復帰: 実際の状態に応じたステータス設定
      const currentState2 = getState();
      if (currentState2.playingCount > 0) {
        // 再生中はそのまま維持
      } else if (currentState2.audioQueue.length === 0 && currentState2.commentQueue.length === 0) {
        sendStatus('waiting');
      }
      // それ以外（キューにアイテムあり）は generating/listening が適宜セットされる

      if (!data.items || data.items.length === 0) {
        logInfo(`YouTube新着コメント: 0件 | キュー: ${formatQueueState()} | 次回YouTubeコメント取得まで: ${getState().pollingIntervalMs}ms`);
        updateState({ nextPageToken: data.nextPageToken || null });
        return;
      }

      const currentState = getState();
      const autoCatchUpEnabled = getAutoCatchUpConfig().enabled;
      if (isFirstFetch || (currentState.latestOnlyMode && !autoCatchUpEnabled)) {
        // 最初の取得または最新N件モードでは最新のN件のみを取得
        const N = currentState.latestOnlyCount || 3;
        const latestItems = data.items.slice(-N);
        const filterConfig = getFilterConfig();
        let addedCount = 0;

        for (const item of latestItems) {
          const rawMessage: string = item.snippet.displayMessage;
          const timestamp = new Date(item.snippet.publishedAt).getTime();

          if (currentState.latestTimestamp && timestamp <= currentState.latestTimestamp) {
            logDebug(`重複スキップ: "${rawMessage}"`);
            continue;
          }

          updateState({ latestTimestamp: timestamp });
          let newMessage =
            filterConfig.enabled && filterConfig.stripEmoji
              ? stripEmojis(rawMessage)
              : rawMessage;
          if (newMessage.length === 0) {
            logInfo(`絵文字除去で空: "${rawMessage}"`);
            continue;
          }
          if (filterConfig.enabled && filterConfig.ngWordAction === 'remove') {
            const before = newMessage;
            newMessage = removeNgWords(newMessage, filterConfig.ngWords);
            if (newMessage.length === 0) {
              logInfo(`NGワード除去で空: "${rawMessage}"`);
              continue;
            }
            if (newMessage !== before) {
              logInfo(`NGワード除去: "${before}" → "${newMessage}"`);
            }
          }
          const filterReason1 = shouldFilter(newMessage, filterConfig);
          if (filterReason1) {
            logInfo(`フィルタ除外(${filterReason1}): "${newMessage}"`);
          } else {
            pushComment({
              apiKeyVOICEVOX: config.apiKeyVOICEVOX,
              newMessage,
              speed: config.speed,
              tabId: config.tabId,
              speakerId: getEffectiveSpeakerId(),
            });
            addedCount++;
          }
        }

        // 最新N件モードではキューをN件にキャップ（古いコメントを破棄）
        // 自動発動が有効な場合はキャップせず、evaluateAutoCatchUp() に任せる
        if (currentState.latestOnlyMode && !autoCatchUpEnabled) {
          const queue = getState().commentQueue;
          if (queue.length > N) {
            const discarded = queue.length - N;
            updateState({ commentQueue: queue.slice(-N) });
            logInfo(`🗑️ キューキャップ: ${discarded}件破棄, ${N}件保持`);
          }
        }

        logInfo(`📥 YouTube新着コメント: ${addedCount}件追加（最新${N}件モード, ${data.items.length}件取得） | キュー: ${formatQueueState()} | 次回YouTubeコメント取得まで: ${getState().pollingIntervalMs}ms`);
        isFirstFetch = false;
      } else {
        // 通常モードでは差分をすべて取得
        const beforeQueueSize = currentState.commentQueue.length;
        const filterConfig = getFilterConfig();
        for (const item of data.items) {
          const rawMessage: string = item.snippet.displayMessage;
          const timestamp = new Date(item.snippet.publishedAt).getTime();

          if (!currentState.latestTimestamp || timestamp > currentState.latestTimestamp) {
            updateState({ latestTimestamp: timestamp });
            let newMessage =
              filterConfig.enabled && filterConfig.stripEmoji
                ? stripEmojis(rawMessage)
                : rawMessage;
            if (newMessage.length === 0) {
              logInfo(`絵文字除去で空: "${rawMessage}"`);
            } else {
              if (filterConfig.enabled && filterConfig.ngWordAction === 'remove') {
                const before = newMessage;
                newMessage = removeNgWords(newMessage, filterConfig.ngWords);
                if (newMessage.length === 0) {
                  logInfo(`NGワード除去で空: "${rawMessage}"`);
                  continue;
                }
                if (newMessage !== before) {
                  logInfo(`NGワード除去: "${before}" → "${newMessage}"`);
                }
              }
              const filterReason2 = shouldFilter(newMessage, filterConfig);
              if (filterReason2) {
                logInfo(`フィルタ除外(${filterReason2}): "${newMessage}"`);
              } else {
                pushComment({
                  apiKeyVOICEVOX: config.apiKeyVOICEVOX,
                  newMessage,
                  speed: config.speed,
                  tabId: config.tabId,
                  speakerId: getEffectiveSpeakerId(),
                });
              }
            }
          }
        }
        const afterQueueSize = getState().commentQueue.length;
        const addedCount = afterQueueSize - beforeQueueSize;
        logInfo(`📥 YouTube新着コメント: ${addedCount}件追加（${data.items.length}件取得） | キュー: [音声生成待ち:${beforeQueueSize}→${afterQueueSize}, 再生待ち:${getState().audioQueue.length}] | 次回YouTubeコメント取得まで: ${getState().pollingIntervalMs}ms`);
      }

      updateState({ nextPageToken: data.nextPageToken || null });
      updateBadge();
      evaluateAutoCatchUp();
      evaluateRushMode();
      scheduleNextProcessing();
    } catch (err) {
      const error = err as Error & { isRateLimit?: boolean };

      if (error instanceof LiveChatEndedError) {
        // 配信終了検出: 自動停止
        logInfo('ライブ配信が終了しました。読み上げを停止します。');
        sendStatus('idle', 'ライブ配信が終了しました');
        stopAll();
        return;
      }

      const currentState = getState();
      updateState({ consecutiveErrors: currentState.consecutiveErrors + 1 });

      if (error.isRateLimit) {
        // レート制限: 即座にUIに表示（閾値チェック不要）
        // eslint-disable-next-line no-console
        console.warn('YouTube APIレート制限:', error.message);
        logWarn(
          `🚫 レート制限検知（${currentState.consecutiveErrors + 1}回連続）- ポーリング間隔を延長`
        );
        updateState({ isYouTubeRateLimited: true });
        sendStatus('error', error.message);
      } else {
        // eslint-disable-next-line no-console
        console.error('YouTube APIリクエストエラー:', error);
        logWarn(
          `YouTube APIエラー（${currentState.consecutiveErrors + 1}回連続）: ${error.message}`
        );
        // 通常エラーは一定回数以上連続の場合のみUIに表示
        if (getState().consecutiveErrors >= ERROR_THRESHOLD_FOR_STATUS) {
          sendStatus('error', error.message);
        }
      }
    } finally {
      const finalState = getState();
      // 配信終了で stopAll が呼ばれた場合はポーリングしない
      if (finalState.liveChatId && finalState.activeTabId) {
        // 成功時: YouTube API推奨間隔を使用
        // エラー時: 推奨間隔を基準に指数バックオフ（最大60秒）
        let delay: number;
        if (finalState.consecutiveErrors === 0) {
          delay = finalState.pollingIntervalMs;
        } else {
          delay = Math.min(finalState.pollingIntervalMs * Math.pow(2, finalState.consecutiveErrors), 60000);
        }
        updateState({ intervalId: setTimeout(checkNewComments, delay) });
      }
    }
  };

  // コメント処理開始
  scheduleNextProcessing();

  checkNewComments();
}

// 全停止
export function stopAll(): void {
  const state = getState();

  // セッションを無効化（進行中の非同期処理を破棄）
  incrementSessionId();

  // フェイルセーフタイマーを全クリア
  clearAllPlayingTimeouts();

  // ポーリングタイマーをクリア
  if (state.intervalId) {
    clearTimeout(state.intervalId);
    updateState({ intervalId: null });
  }

  // コメント処理スケジュールをキャンセル
  cancelScheduledProcessing();

  // 音声停止
  stopCurrentAudio();

  // Offscreen documentを閉じる
  chrome.offscreen.closeDocument().catch(() => {
    // ドキュメントが存在しない場合は無視
  });

  // Content Script のポーリングを停止（スタンドアロンモード用）
  if (state.activeTabId) {
    chrome.tabs.sendMessage(state.activeTabId, { action: 'stopStandalonePolling' }).catch(() => {});
  }

  // DOMモードの MutationObserver を停止
  chrome.storage.session.set({ domModeActive: false }).catch(() => {});

  // 状態リセット
  resetState();
  sendStatus('idle');

  // バッジクリア
  clearBadge();
}
