// スタンドアロンモード Content Script
// youtube.com オリジン上で動作し、YouTubei 内部 API でコメントを取得して background に送る

interface StartStandaloneMessage {
  action: 'startStandalonePolling';
  videoId: string;
  initialContinuation: { continuation: string; timeoutMs: number; isReplay: boolean; needsPlayerState?: boolean };
}

interface StopStandaloneMessage {
  action: 'stopStandalonePolling';
}

type IncomingMessage = StartStandaloneMessage | StopStandaloneMessage;

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
  needsPlayerState?: boolean;
}

interface LiveChatContinuation {
  continuations?: ContinuationItem[];
  actions?: Array<{
    replayChatItemAction?: {
      videoOffsetTimeMsec?: string;
      actions?: Array<{
        addChatItemAction?: {
          item?: {
            liveChatTextMessageRenderer?: {
              message?: { runs?: Array<{ text?: string; emoji?: unknown }> };
              timestampUsec?: string;
            };
          };
        };
      }>;
    };
    addChatItemAction?: {
      item?: {
        liveChatTextMessageRenderer?: {
          message?: { runs?: Array<{ text?: string; emoji?: unknown }> };
          timestampUsec?: string;
        };
      };
    };
  }>;
}

function extractNextContinuation(lcc: LiveChatContinuation): { continuation: string; timeoutMs: number } | null {
  if (!lcc.continuations?.[0]) return null;
  const cont = lcc.continuations[0] as ContinuationItem;
  const data =
    cont.liveChatReplayContinuationData ??
    cont.timedContinuationData ??
    cont.reloadContinuationData ??
    cont.invalidationContinuationData;

  if (!data?.continuation) return null;
  return {
    continuation: data.continuation,
    timeoutMs: ('timeoutMs' in data && typeof data.timeoutMs === 'number') ? data.timeoutMs : 5000,
  };
}

function extractMessages(lcc: LiveChatContinuation): Array<{ text: string; timestampMs: number; videoOffsetMs?: number }> {
  const results: Array<{ text: string; timestampMs: number; videoOffsetMs?: number }> = [];

  for (const action of lcc.actions ?? []) {
    // ライブ配信: action.addChatItemAction
    // アーカイブ: action.replayChatItemAction.actions[].addChatItemAction
    const replayAction = action.replayChatItemAction;
    const videoOffsetMs = replayAction?.videoOffsetTimeMsec
      ? parseInt(replayAction.videoOffsetTimeMsec, 10)
      : undefined;
    const innerActions = replayAction?.actions ?? [action];

    for (const inner of innerActions ?? []) {
      const renderer = inner.addChatItemAction?.item?.liveChatTextMessageRenderer;
      if (!renderer) continue;

      const text = (renderer.message?.runs ?? [])
        .filter((run) => run.text !== undefined)
        .map((run) => run.text as string)
        .join('');

      if (!text) continue;

      const timestampMs = renderer.timestampUsec
        ? Math.floor(parseInt(renderer.timestampUsec, 10) / 1000)
        : Date.now();

      results.push({ text, timestampMs, videoOffsetMs });
    }
  }
  return results;
}

function startPolling(_videoId: string, initial: ExtractedContinuation): void {
  let stopped = false;
  let currentContinuation = initial.continuation;
  let currentTimeoutMs = initial.timeoutMs;
  // リプレイモードでは現在の動画再生位置から開始する
  let sendPlayerState = initial.isReplay || (initial.needsPlayerState ?? false);
  const video = document.querySelector('video');
  const initialPlayerOffsetMs = (initial.isReplay && video)
    ? String(Math.floor(video.currentTime * 1000))
    : '0';
  // アーカイブ配信: 動画の現在位置（ms）。この値未満の videoOffsetTimeMsec を持つチャンクはスキップする
  const catchUpTargetMs = initial.isReplay && video ? Math.floor(video.currentTime * 1000) : 0;
  let caughtUp = catchUpTargetMs === 0;
  let consecutiveErrors = 0;
  const MAX_RETRIES = 5;
  const endpoint = initial.isReplay
    ? '/youtubei/v1/live_chat/get_live_chat_replay'
    : '/youtubei/v1/live_chat/get_live_chat';

  const loop = async (): Promise<void> => {
    if (stopped) return;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240731.40.00',
              hl: 'ja',
            },
          },
          continuation: currentContinuation,
          ...(sendPlayerState ? { currentPlayerState: { playerOffsetMs: initialPlayerOffsetMs } } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`YouTubei API エラー: ${response.status}`);
      }

      const data = await response.json() as { continuationContents?: { liveChatContinuation?: LiveChatContinuation } };
      const lcc = data.continuationContents?.liveChatContinuation;
      if (!lcc) {
        chrome.runtime.sendMessage({ action: 'standaloneEnded' }).catch(() => {});
        return;
      }

      const messages = extractMessages(lcc);

      // アーカイブ配信: videoOffsetTimeMsec が catchUpTargetMs に達するまでスキップ
      if (!caughtUp) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.videoOffsetMs !== undefined && lastMsg.videoOffsetMs >= catchUpTargetMs) {
          caughtUp = true;
        }
        // まだ追いついていない場合は messages を送信しない（即座に次チャンクへ）
        if (!caughtUp) {
          currentTimeoutMs = 0;
        }
      }

      if (caughtUp && messages.length > 0) {
        const sendable = messages.filter(m => m.videoOffsetMs === undefined || m.videoOffsetMs >= catchUpTargetMs);
        if (sendable.length > 0) {
          chrome.runtime.sendMessage({ action: 'standaloneChatMessages', messages: sendable }).catch(() => {});
        }
      }

      const next = extractNextContinuation(lcc);
      if (!next) {
        chrome.runtime.sendMessage({ action: 'standaloneEnded' }).catch(() => {});
        return;
      }

      consecutiveErrors = 0;
      sendPlayerState = false;
      currentContinuation = next.continuation;
      currentTimeoutMs = next.timeoutMs;
    } catch (err) {
      consecutiveErrors++;
      const message = err instanceof Error ? err.message : String(err);
      if (consecutiveErrors >= MAX_RETRIES) {
        chrome.runtime.sendMessage({ action: 'standaloneError', message: `${message}（最大再試行回数(${MAX_RETRIES}回)に達しました）` }).catch(() => {});
        return;
      }
      const backoffMs = Math.min(5000 * Math.pow(2, consecutiveErrors - 1), 60000);
      chrome.runtime.sendMessage({ action: 'standaloneError', message: `${message}（${consecutiveErrors}回目のエラー、${backoffMs / 1000}秒後に再試行）` }).catch(() => {});
      if (!stopped) {
        setTimeout(() => { void loop(); }, backoffMs);
      }
      return;
    }

    if (!stopped) {
      setTimeout(() => { void loop(); }, currentTimeoutMs);
    }
  };

  void loop();

  // stopStandalonePolling を受け取ったらループを停止
  chrome.runtime.onMessage.addListener((msg: IncomingMessage) => {
    if (msg.action === 'stopStandalonePolling') {
      stopped = true;
    }
  });
}

chrome.runtime.onMessage.addListener((msg: IncomingMessage, _sender, sendResponse) => {
  if (msg.action !== 'startStandalonePolling') return;

  startPolling(msg.videoId, msg.initialContinuation);
  sendResponse({ status: 'success' });
});
