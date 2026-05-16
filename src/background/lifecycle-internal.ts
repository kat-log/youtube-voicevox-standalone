import { getState, updateState, pushComment, clearAudioQueue } from './state';
import { trackFetch, trackDrop } from './lifecycle-tracker';
import { getFilterConfig, shouldFilter, stripEmojis, removeNgWords } from './comment-filter';
import { isRandomSpeakerEnabled, getRandomSpeakerId } from './random-speaker';
import { logDebug, logInfo } from './messaging';
import { updateBadge } from './audio-player';
import { evaluateAutoCatchUp, getAutoCatchUpConfig } from './auto-catchup';
import { evaluateRushMode } from './rush-mode';
import { scheduleNextProcessing } from './tts-api';

interface StandaloneConfig {
  apiKeyVOICEVOX: string;
  speed: number;
  tabId: number;
  speakerId?: string;
}

let standaloneConfig: StandaloneConfig | null = null;

export function getStandaloneConfig(): StandaloneConfig | null {
  return standaloneConfig;
}

export function setStandaloneConfig(config: StandaloneConfig): void {
  standaloneConfig = config;
}

export function processChatMessages(
  messages: Array<{ text: string; timestampMs: number }>,
  config: StandaloneConfig
): void {
  if (messages.length === 0) return;

  const state = getState();
  const filterConfig = getFilterConfig();
  const autoCatchUpEnabled = getAutoCatchUpConfig().enabled;

  const getEffectiveSpeakerId = (): string | undefined =>
    isRandomSpeakerEnabled() ? (getRandomSpeakerId() || config.speakerId) : config.speakerId;

  const isFirstFetch = state.latestTimestamp === null;

  if (isFirstFetch || (state.latestOnlyMode && !autoCatchUpEnabled)) {
    // 最初の取得または最新N件モードでは最新のN件のみを取得
    const N = state.latestOnlyCount || 3;
    const latestItems = messages.slice(-N);
    let addedCount = 0;

    for (const item of latestItems) {
      if (state.latestTimestamp !== null && item.timestampMs < state.latestTimestamp) {
        logDebug(`重複スキップ: "${item.text}"`);
        continue;
      }

      updateState({ latestTimestamp: item.timestampMs });

      let newMessage =
        filterConfig.enabled && filterConfig.stripEmoji
          ? stripEmojis(item.text)
          : item.text;

      if (newMessage.length === 0) {
        logInfo(`絵文字除去で空: "${item.text}"`);
        continue;
      }

      if (filterConfig.enabled && filterConfig.ngWordAction === 'remove') {
        const before = newMessage;
        newMessage = removeNgWords(newMessage, filterConfig.ngWords);
        if (newMessage.length === 0) {
          logInfo(`NGワード除去で空: "${item.text}"`);
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
        const lcId1 = crypto.randomUUID();
        const ft1 = Date.now();
        trackFetch(lcId1, newMessage, ft1);
        const dropped1 = pushComment({
          apiKeyVOICEVOX: config.apiKeyVOICEVOX,
          newMessage,
          speed: config.speed,
          tabId: config.tabId,
          speakerId: getEffectiveSpeakerId(),
          lifecycleId: lcId1,
          fetchTime: ft1,
        });
        for (const d of dropped1) { if (d.lifecycleId) trackDrop(d.lifecycleId); }
        addedCount++;
      }
    }

    // 最新N件モードではcommentQueue+audioQueueの合計をN件にキャップ
    if (state.latestOnlyMode && !autoCatchUpEnabled) {
      const queue = getState().commentQueue;
      const totalPending = queue.length + getState().audioQueue.length;
      if (totalPending > N) {
        const toDropItems = queue.slice(0, Math.max(0, queue.length - N));
        const keptComments = queue.slice(-N);
        clearAudioQueue();
        updateState({ commentQueue: keptComments });
        for (const d of toDropItems) { if (d.lifecycleId) trackDrop(d.lifecycleId); }
        logInfo(`🗑️ キューキャップ: ${totalPending - keptComments.length}件破棄, ${keptComments.length}件保持`);
      }
    }

    logInfo(`📥 新着コメント: ${addedCount}件追加（最新${N}件モード, ${messages.length}件取得）`);
  } else {
    // 通常モードでは差分をすべて取得
    const currentState = getState();
    const beforeQueueSize = currentState.commentQueue.length;

    for (const item of messages) {
      if (currentState.latestTimestamp === null || item.timestampMs >= currentState.latestTimestamp) {
        updateState({ latestTimestamp: item.timestampMs });


        let newMessage =
          filterConfig.enabled && filterConfig.stripEmoji
            ? stripEmojis(item.text)
            : item.text;

        if (newMessage.length === 0) {
          logInfo(`絵文字除去で空: "${item.text}"`);
          continue;
        }

        if (filterConfig.enabled && filterConfig.ngWordAction === 'remove') {
          const before = newMessage;
          newMessage = removeNgWords(newMessage, filterConfig.ngWords);
          if (newMessage.length === 0) {
            logInfo(`NGワード除去で空: "${item.text}"`);
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
          const lcId2 = crypto.randomUUID();
          const ft2 = Date.now();
          trackFetch(lcId2, newMessage, ft2);
          const dropped2 = pushComment({
            apiKeyVOICEVOX: config.apiKeyVOICEVOX,
            newMessage,
            speed: config.speed,
            tabId: config.tabId,
            speakerId: getEffectiveSpeakerId(),
            lifecycleId: lcId2,
            fetchTime: ft2,
          });
          for (const d of dropped2) { if (d.lifecycleId) trackDrop(d.lifecycleId); }
        }
      } else {
        logDebug(`重複スキップ: "${item.text}"`);
      }
    }

    const afterQueueSize = getState().commentQueue.length;
    const addedCount = afterQueueSize - beforeQueueSize;
    logInfo(`📥 新着コメント: ${addedCount}件追加（${messages.length}件取得）`);
  }

  updateBadge();
  evaluateAutoCatchUp();
  evaluateRushMode();
  scheduleNextProcessing();
}
