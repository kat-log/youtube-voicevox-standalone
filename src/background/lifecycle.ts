import { getState, updateState, resetState, incrementSessionId, pushComment } from './state';
import { LiveChatEndedError } from './youtube-api';
import { scheduleNextProcessing, cancelScheduledProcessing } from './tts-api';
import { stopCurrentAudio, updateBadge, clearBadge } from './audio-player';
import { sendStatus, sendDebugInfo, formatQueueState, clearDebugLogs } from './messaging';
import { ERROR_THRESHOLD_FOR_STATUS } from './state';
import { shouldFilter, getFilterConfig, stripEmojis, removeNgWords } from './comment-filter';
import { evaluateRushMode } from './rush-mode';
import { evaluateAutoCatchUp } from './auto-catchup';

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
  updateState({ consecutiveErrors: 0, pollingIntervalMs: 5000 });
  let latestMessage = '';
  let isFirstFetch = true;

  const checkNewComments = (): void => {
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
    sendDebugInfo(`══════ Poll #${cycleNum} (interval: ${state.pollingIntervalMs}ms) ══════`);

    // YouTube APIにリクエストを送る直前にステータスを更新（再生中はちらつき防止）
    if (!getState().isPlaying) {
      sendStatus('fetching');
    }

    fetch(requestUrl)
      .then((response) => {
        if (!response.ok) {
          if (response.status === 403) {
            // 配信終了の検出: liveChatEnded reason をチェック
            return response
              .json()
              .then((errorData) => {
                if (
                  errorData?.error?.errors?.some(
                    (e: { reason: string }) => e.reason === 'liveChatEnded'
                  )
                ) {
                  throw new LiveChatEndedError('ライブ配信が終了しました。');
                }
                // liveChatEnded以外の403はレート制限
                const rateLimitError = new Error('YouTube APIレート制限（403）') as Error & {
                  isRateLimit: boolean;
                };
                rateLimitError.isRateLimit = true;
                throw rateLimitError;
              })
              .catch((e) => {
                if (e instanceof LiveChatEndedError) throw e;
                if ((e as Error & { isRateLimit?: boolean }).isRateLimit) throw e;
                // JSONパース失敗はレート制限として扱う
                const rateLimitError = new Error('YouTube APIレート制限（403）') as Error & {
                  isRateLimit: boolean;
                };
                rateLimitError.isRateLimit = true;
                throw rateLimitError;
              });
          }
          throw new Error(`YouTube APIリクエストに失敗しました（${response.status}）。`);
        }
        return response.json();
      })
      .then((data) => {
        if (!data) return;

        // 成功時にエラーカウンタをリセット
        updateState({ consecutiveErrors: 0 });

        // YouTube APIの推奨ポーリング間隔を保存
        if (data.pollingIntervalMillis) {
          updateState({ pollingIntervalMs: data.pollingIntervalMillis });
        }

        // エラー状態からの復帰: 実際の状態に応じたステータス設定
        const currentState2 = getState();
        if (currentState2.isPlaying) {
          // 再生中はそのまま維持
        } else if (currentState2.audioQueue.length === 0 && currentState2.commentQueue.length === 0) {
          sendStatus('waiting');
        }
        // それ以外（キューにアイテムあり）は generating/listening が適宜セットされる

        if (!data.items || data.items.length === 0) {
          sendDebugInfo(`YouTube新着コメント: 0件 | キュー: ${formatQueueState()} | 次回YouTubeコメント取得まで: ${getState().pollingIntervalMs}ms`);
          updateState({ nextPageToken: data.nextPageToken || null });
          return;
        }

        const currentState = getState();
        if (isFirstFetch || currentState.latestOnlyMode) {
          // 最初の取得または最新のみモードでは最新の1件のみを取得
          sendDebugInfo(`📥 YouTube新着コメント: 1件取得（最新のみ） | キュー: ${formatQueueState()} | 次回YouTubeコメント取得まで: ${getState().pollingIntervalMs}ms`);
          const latestItem = data.items[data.items.length - 1];
          const rawMessage: string = latestItem.snippet.displayMessage;
          if (rawMessage !== latestMessage) {
            latestMessage = rawMessage;
            updateState({
              latestTimestamp: new Date(latestItem.snippet.publishedAt).getTime(),
            });
            const filterConfig = getFilterConfig();
            let newMessage =
              filterConfig.enabled && filterConfig.stripEmoji
                ? stripEmojis(rawMessage)
                : rawMessage;
            if (newMessage.length === 0) {
              sendDebugInfo(`絵文字除去で空: "${rawMessage}"`);
            } else {
              if (filterConfig.enabled && filterConfig.ngWordAction === 'remove') {
                const before = newMessage;
                newMessage = removeNgWords(newMessage, filterConfig.ngWords);
                if (newMessage.length === 0) {
                  sendDebugInfo(`NGワード除去で空: "${rawMessage}"`);
                  isFirstFetch = false;
                  return;
                }
                if (newMessage !== before) {
                  sendDebugInfo(`NGワード除去: "${before}" → "${newMessage}"`);
                }
              }
              if (shouldFilter(newMessage, filterConfig)) {
                sendDebugInfo(`フィルタ除外: "${newMessage}"`);
              } else {
                pushComment({
                  apiKeyVOICEVOX: config.apiKeyVOICEVOX,
                  newMessage,
                  speed: config.speed,
                  tabId: config.tabId,
                  speakerId: config.speakerId,
                });
              }
            }
          }
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
              latestMessage = rawMessage;
              let newMessage =
                filterConfig.enabled && filterConfig.stripEmoji
                  ? stripEmojis(rawMessage)
                  : rawMessage;
              if (newMessage.length === 0) {
                sendDebugInfo(`絵文字除去で空: "${rawMessage}"`);
              } else {
                if (filterConfig.enabled && filterConfig.ngWordAction === 'remove') {
                  const before = newMessage;
                  newMessage = removeNgWords(newMessage, filterConfig.ngWords);
                  if (newMessage.length === 0) {
                    sendDebugInfo(`NGワード除去で空: "${rawMessage}"`);
                    continue;
                  }
                  if (newMessage !== before) {
                    sendDebugInfo(`NGワード除去: "${before}" → "${newMessage}"`);
                  }
                }
                if (shouldFilter(newMessage, filterConfig)) {
                  sendDebugInfo(`フィルタ除外: "${newMessage}"`);
                } else {
                  pushComment({
                    apiKeyVOICEVOX: config.apiKeyVOICEVOX,
                    newMessage,
                    speed: config.speed,
                    tabId: config.tabId,
                    speakerId: config.speakerId,
                  });
                }
              }
            }
          }
          const afterQueueSize = getState().commentQueue.length;
          const addedCount = afterQueueSize - beforeQueueSize;
          sendDebugInfo(`📥 YouTube新着コメント: ${addedCount}件追加（${data.items.length}件取得） | キュー: [音声生成待ち:${beforeQueueSize}→${afterQueueSize}, 再生待ち:${getState().audioQueue.length}] | 次回YouTubeコメント取得まで: ${getState().pollingIntervalMs}ms`);
        }

        updateState({ nextPageToken: data.nextPageToken || null });
        updateBadge();
        evaluateAutoCatchUp();
        evaluateRushMode();
        scheduleNextProcessing();
      })
      .catch((error: Error & { isRateLimit?: boolean }) => {
        if (error instanceof LiveChatEndedError) {
          // 配信終了検出: 自動停止
          sendDebugInfo('ライブ配信が終了しました。読み上げを停止します。');
          sendStatus('idle', 'ライブ配信が終了しました');
          stopAll();
          return;
        }

        const state = getState();
        updateState({ consecutiveErrors: state.consecutiveErrors + 1 });

        if (error.isRateLimit) {
          // レート制限: デバッグログのみ
          // eslint-disable-next-line no-console
          console.warn('YouTube APIレート制限:', error.message);
          sendDebugInfo(
            `レート制限検知（${state.consecutiveErrors + 1}回連続）- ポーリング間隔を延長`
          );
        } else {
          // eslint-disable-next-line no-console
          console.error('YouTube APIリクエストエラー:', error);
          sendDebugInfo(
            `YouTube APIエラー（${state.consecutiveErrors + 1}回連続）: ${error.message}`
          );
        }

        // 一定回数以上連続でエラーの場合のみ、UIにエラー表示
        if (getState().consecutiveErrors >= ERROR_THRESHOLD_FOR_STATUS) {
          sendStatus('error', error.message);
        }
      })
      .finally(() => {
        const state = getState();
        // 配信終了で stopAll が呼ばれた場合はポーリングしない
        if (!state.liveChatId || !state.activeTabId) return;

        // 成功時: YouTube API推奨間隔を使用
        // エラー時: 推奨間隔を基準に指数バックオフ（最大60秒）
        let delay: number;
        if (state.consecutiveErrors === 0) {
          delay = state.pollingIntervalMs;
        } else {
          delay = Math.min(state.pollingIntervalMs * Math.pow(2, state.consecutiveErrors), 60000);
        }
        updateState({ intervalId: setTimeout(checkNewComments, delay) });
      });
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

  // フェイルセーフタイマーをクリア
  if (state.playingTimeout) {
    clearTimeout(state.playingTimeout);
    updateState({ playingTimeout: null });
  }

  // ポーリングタイマーをクリア
  if (state.intervalId) {
    clearTimeout(state.intervalId);
    updateState({ intervalId: null });
  }

  // コメント処理スケジュールをキャンセル
  cancelScheduledProcessing();

  // 音声停止
  stopCurrentAudio();

  // 状態リセット
  resetState();
  sendStatus('idle');

  // バッジクリア
  clearBadge();
}
