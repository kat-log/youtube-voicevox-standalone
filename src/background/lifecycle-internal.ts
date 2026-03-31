import { getState, updateState, pushComment } from './state';
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
      if (state.latestTimestamp && item.timestampMs <= state.latestTimestamp) {
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

    // 最新N件モードではキューをN件にキャップ
    if (state.latestOnlyMode && !autoCatchUpEnabled) {
      const queue = getState().commentQueue;
      if (queue.length > N) {
        const discarded = queue.length - N;
        updateState({ commentQueue: queue.slice(-N) });
        logInfo(`🗑️ キューキャップ: ${discarded}件破棄, ${N}件保持`);
      }
    }

    logInfo(`📥 新着コメント: ${addedCount}件追加（最新${N}件モード, ${messages.length}件取得）`);
  } else {
    // 通常モードでは差分をすべて取得
    const currentState = getState();
    const beforeQueueSize = currentState.commentQueue.length;

    for (const item of messages) {
      if (!currentState.latestTimestamp || item.timestampMs > currentState.latestTimestamp) {
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
          pushComment({
            apiKeyVOICEVOX: config.apiKeyVOICEVOX,
            newMessage,
            speed: config.speed,
            tabId: config.tabId,
            speakerId: getEffectiveSpeakerId(),
          });
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
