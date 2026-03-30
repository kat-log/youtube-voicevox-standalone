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
  /** true のとき API リクエストに currentPlayerState: { playerOffsetMs: "0" } を付与する必要がある */
  needsPlayerState?: boolean;
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

type LiveChatContents = { liveChatRenderer?: { continuations?: unknown[] }; liveChatReplayRenderer?: { continuations?: unknown[] } };

/** live_chat ページの ytInitialData.contents から API 用トークンを抽出する */
function extractContinuationFromLiveChatPage(contents: LiveChatContents): ExtractedContinuation | null {
  const isReplay = 'liveChatReplayRenderer' in contents;
  const renderer = isReplay ? contents.liveChatReplayRenderer : contents.liveChatRenderer;
  if (!renderer?.continuations?.[0]) return null;
  const cont = renderer.continuations[0] as ContinuationItem;
  // API 直送できるトークン（liveChatReplayContinuationData / timedContinuationData）のみ採用
  const data = cont.liveChatReplayContinuationData ?? cont.timedContinuationData ?? cont.invalidationContinuationData;
  if (!data?.continuation) return null;
  return {
    continuation: data.continuation,
    timeoutMs: ('timeoutMs' in data && typeof data.timeoutMs === 'number') ? data.timeoutMs : 5000,
    isReplay,
  };
}

/** ウォッチページの conversationBar から reload トークン（文字列）と isReplay を取得する */
function extractReloadTokenFromConversationBar(conversationBar: LiveChatContents): { reloadToken: string; isReplay: boolean } | null {
  const isReplay = 'liveChatReplayRenderer' in conversationBar;
  const renderer = isReplay ? conversationBar.liveChatReplayRenderer : conversationBar.liveChatRenderer;
  if (!renderer?.continuations?.[0]) return null;
  const cont = renderer.continuations[0] as ContinuationItem;
  const token = cont.reloadContinuationData?.continuation
    ?? cont.liveChatReplayContinuationData?.continuation
    ?? cont.timedContinuationData?.continuation
    ?? cont.invalidationContinuationData?.continuation;
  if (!token) return null;
  return { reloadToken: token, isReplay };
}

/** HTML 内から liveChatReplayContinuationData / timedContinuationData トークンを正規表現で抽出する */
function extractApiTokenFromHtml(html: string): ExtractedContinuation | null {
  // liveChatReplayContinuationData を優先（アーカイブ配信）
  const replayMatch = html.match(/"liveChatReplayContinuationData"\s*:\s*\{[^}]*?"continuation"\s*:\s*"([^"]+)"/);
  if (replayMatch) return { continuation: replayMatch[1], timeoutMs: 5000, isReplay: true };

  // timedContinuationData（ライブ配信のフォールバック）
  const timedMatch = html.match(/"timedContinuationData"\s*:\s*\{[^}]*?"continuation"\s*:\s*"([^"]+)"/);
  if (timedMatch) return { continuation: timedMatch[1], timeoutMs: 5000, isReplay: false };

  return null;
}

/** ytcfg.set({...}) ブロック内から liveChatReplayContinuationData / timedContinuationData トークンを抽出する */
function extractApiTokenFromYtcfg(html: string): ExtractedContinuation | null {
  const marker = 'ytcfg.set(';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  // '(' の後の '{' を開始点に brace-counting でブロック終端を探す
  const braceStart = html.indexOf('{', markerIdx + marker.length);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let braceEnd = -1;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { braceEnd = i; break; } }
  }
  if (braceEnd === -1) return null;

  return extractApiTokenFromHtml(html.slice(braceStart, braceEnd + 1));
}

/** background から get_live_chat_replay API に直接 POST してアーカイブ配信の初期トークンを取得する */
async function fetchReplayTokenViaApi(reloadToken: string): Promise<ExtractedContinuation | null> {
  try {
    const res = await fetchWithTimeout(
      'https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay',
      15_000,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240731.40.00',
              hl: 'ja',
            },
          },
          continuation: reloadToken,
          currentPlayerState: { playerOffsetMs: '0' },
        }),
      }
    );
    if (!res.ok) return null;

    const data = await res.json() as {
      continuationContents?: {
        liveChatContinuation?: {
          continuations?: unknown[];
        };
      };
    };
    const continuations = data.continuationContents?.liveChatContinuation?.continuations;
    if (!continuations?.[0]) return null;
    const cont = continuations[0] as ContinuationItem;
    const token = cont.liveChatReplayContinuationData?.continuation ?? cont.timedContinuationData?.continuation;
    if (!token) return null;
    const timeoutMs = cont.liveChatReplayContinuationData?.timeoutMs ?? cont.timedContinuationData?.timeoutMs ?? 5000;
    return { continuation: token, timeoutMs, isReplay: true };
  } catch {
    return null;
  }
}

async function fetchLiveChatPage(urlParam: string): Promise<ExtractedContinuation | null> {
  const url = `https://www.youtube.com/live_chat?${urlParam}&is_from_web=1`;
  const res = await fetchWithTimeout(url, 15_000);
  if (!res.ok) return null;
  const html = await res.text();

  // まず ytInitialData JSON から抽出（ライブ配信・一部アーカイブ）
  const jsonStr = extractYtInitialDataJson(html);
  if (jsonStr) {
    try {
      const ytData = JSON.parse(jsonStr) as { contents?: LiveChatContents };
      const contents = ytData?.contents;
      if (contents && ('liveChatRenderer' in contents || 'liveChatReplayRenderer' in contents)) {
        const result = extractContinuationFromLiveChatPage(contents);
        if (result) return result;
      }
    } catch { /* fall through */ }
  }

  // ytInitialData が無い場合は正規表現で直接抽出（アーカイブ配信 continuation ページ）
  return extractApiTokenFromHtml(html) ?? extractApiTokenFromYtcfg(html);
}

async function fetchInitialContinuation(videoId: string): Promise<ExtractedContinuation> {
  // Step 1: live_chat?v= で直接取得を試みる（ライブ配信はここで成功）
  const direct = await fetchLiveChatPage(`v=${videoId}`);
  if (direct) return direct;

  // Step 2: ウォッチページの conversationBar から reload トークンを取得
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const watchRes = await fetchWithTimeout(watchUrl, 15_000);
  if (!watchRes.ok) throw new Error(`ウォッチページの取得に失敗しました: HTTP ${watchRes.status}`);

  const watchHtml = await watchRes.text();
  const watchJson = extractYtInitialDataJson(watchHtml);
  if (!watchJson) throw new Error('ytInitialData が見つかりません。ライブ配信またはチャットリプレイ付き動画を開いてください。');

  type WatchData = {
    contents?: { twoColumnWatchNextResults?: { conversationBar?: LiveChatContents } };
  };
  let watchData: WatchData;
  try { watchData = JSON.parse(watchJson) as WatchData; }
  catch { throw new Error('ウォッチページデータの解析に失敗しました。'); }

  const conversationBar = watchData?.contents?.twoColumnWatchNextResults?.conversationBar;
  if (!conversationBar) {
    const twoCol = watchData?.contents?.twoColumnWatchNextResults;
    throw new Error(`[Step2] conversationBar なし（twoColumnWatchNextResults keys: ${Object.keys(twoCol ?? {}).join(',')}）`);
  }

  const reloadInfo = extractReloadTokenFromConversationBar(conversationBar);
  if (!reloadInfo) {
    const cbKeys = Object.keys(conversationBar).join(',');
    throw new Error(`[Step2] reloadToken 取得失敗（conversationBar keys: ${cbKeys}）`);
  }

  // Step 3a: reload トークンで live_chat?continuation= を取得し、正規表現で API トークンを抽出
  const viaContinuation = await fetchLiveChatPage(`continuation=${encodeURIComponent(reloadInfo.reloadToken)}`);
  if (viaContinuation) return viaContinuation;

  // Step 3b: get_live_chat_replay API に直接 POST してトークンを変換（アーカイブ配信向け）
  const viaApi = await fetchReplayTokenViaApi(reloadInfo.reloadToken);
  if (viaApi) return viaApi;

  // Step 3c: reloadContinuationData をそのままコンテントスクリプトに渡す。
  // コンテントスクリプトは youtube.com 上で動くためクッキー付きで API を叩ける。
  // needsPlayerState=true により最初のリクエストに currentPlayerState: { playerOffsetMs: "..." } を付与する。
  return {
    continuation: reloadInfo.reloadToken,
    timeoutMs: 5000,
    isReplay: true,
    needsPlayerState: true,
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
