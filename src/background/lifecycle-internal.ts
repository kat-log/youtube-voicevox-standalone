import { getState, updateState, pushComment } from './state';
import { getFilterConfig, shouldFilter, stripEmojis, removeNgWords } from './comment-filter';
import { isRandomSpeakerEnabled, getRandomSpeakerId } from './random-speaker';
import { logInfo, logWarn } from './messaging';
import { updateBadge } from './audio-player';
import { evaluateAutoCatchUp, getAutoCatchUpConfig } from './auto-catchup';
import { evaluateRushMode } from './rush-mode';
import { scheduleNextProcessing } from './tts-api';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
import type { StandaloneChatMessage } from './youtubei-api';

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

interface ContinuationItem {
  reloadContinuationData?: { continuation: string };
  timedContinuationData?: { continuation: string; timeoutMs?: number };
  invalidationContinuationData?: { continuation: string };
  liveChatReplayContinuationData?: { continuation: string; timeoutMs?: number };
}

interface ExtractedContinuation {
  continuation: string;
  timeoutMs: number;
  isReplay: boolean;
}

function extractYtInitialDataJson(html: string): string | null {
  // "var ytInitialData = " または "window[\"ytInitialData\"] = " のどちらにも対応
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', "window['ytInitialData'] = "];
  let jsonStart = -1;
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx !== -1) { jsonStart = idx + marker.length; break; }
  }
  if (jsonStart === -1 || html[jsonStart] !== '{') return null;

  // ブレースカウントで JSON オブジェクトの終端を探す
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return html.slice(jsonStart, i + 1); }
  }
  return null;
}

async function fetchInitialContinuation(videoId: string): Promise<ExtractedContinuation> {
  const url = `https://www.youtube.com/live_chat?v=${videoId}`;
  const response = await fetchWithTimeout(url, 15_000);
  if (!response.ok) throw new Error(`ライブチャットページの取得に失敗しました: HTTP ${response.status}`);

  const html = await response.text();
  const jsonStr = extractYtInitialDataJson(html);
  if (!jsonStr) throw new Error('ytInitialData が見つかりません。ライブ配信またはチャットリプレイ付き動画を開いてください。');

  let ytData: { contents?: { liveChatRenderer?: { continuations?: unknown[] }; liveChatReplayRenderer?: { continuations?: unknown[] } } };
  try { ytData = JSON.parse(jsonStr) as typeof ytData; }
  catch { throw new Error('ライブチャットデータの解析に失敗しました。'); }

  const contents = ytData?.contents;
  if (!contents) throw new Error('チャットデータの contents が見つかりません。ライブ配信またはチャットリプレイ付き動画を開いてください。');

  const isReplay = 'liveChatReplayRenderer' in contents;
  const renderer = isReplay ? contents.liveChatReplayRenderer : contents.liveChatRenderer;
  if (!renderer) throw new Error(`liveChatRenderer が見つかりません（ライブ配信またはチャットリプレイ付き動画を開いてください。isReplay=${isReplay}）`);
  if (!renderer.continuations?.[0]) throw new Error('continuations が見つかりません。チャットが無効な動画の可能性があります。');

  const cont = renderer.continuations[0] as ContinuationItem;
  const data = cont.liveChatReplayContinuationData ?? cont.timedContinuationData ?? cont.reloadContinuationData ?? cont.invalidationContinuationData;
  if (!data?.continuation) throw new Error('継続トークンが見つかりません。ライブ配信またはチャットリプレイ付き動画を開いてください。');

  return {
    continuation: data.continuation,
    timeoutMs: ('timeoutMs' in data && typeof data.timeoutMs === 'number') ? data.timeoutMs : 5000,
    isReplay,
  };
}

async function sendMessageWithInjectionFallback(
  tabId: number,
  message: { action: string; videoId: string; initialContinuation: ExtractedContinuation }
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    logWarn(`スタンドアロン: Content Script が未注入。動的注入を試みます: ${(err as Error).message}`);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['standaloneChat.js'] });
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    await chrome.tabs.sendMessage(tabId, message);
  }
}

export async function startPollingInternal(config: StandaloneConfig & { videoId: string }): Promise<void> {
  standaloneConfig = {
    apiKeyVOICEVOX: config.apiKeyVOICEVOX,
    speed: config.speed,
    tabId: config.tabId,
    speakerId: config.speakerId,
  };

  const initialContinuation = await fetchInitialContinuation(config.videoId);

  await sendMessageWithInjectionFallback(config.tabId, {
    action: 'startStandalonePolling',
    videoId: config.videoId,
    initialContinuation,
  });
}

export function processStandaloneMessages(
  messages: StandaloneChatMessage[],
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

      if (shouldFilter(newMessage, filterConfig)) {
        logInfo(`フィルタ除外: "${newMessage}"`);
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

    logInfo(`📥 スタンドアロン新着コメント: ${addedCount}件追加（最新${N}件モード, ${messages.length}件取得）`);
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

        if (shouldFilter(newMessage, filterConfig)) {
          logInfo(`フィルタ除外: "${newMessage}"`);
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

    const afterQueueSize = getState().commentQueue.length;
    const addedCount = afterQueueSize - beforeQueueSize;
    logInfo(`📥 スタンドアロン新着コメント: ${addedCount}件追加（${messages.length}件取得）`);
  }

  updateBadge();
  evaluateAutoCatchUp();
  evaluateRushMode();
  scheduleNextProcessing();
}
