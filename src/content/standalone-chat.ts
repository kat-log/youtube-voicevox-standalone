// スタンドアロンモード Content Script
// youtube.com オリジン上で動作し、YouTubei 内部 API でコメントを取得して background に送る

interface StartStandaloneMessage {
  action: 'startStandalonePolling';
  videoId: string;
  initialContinuation: { continuation: string; timeoutMs: number; isReplay: boolean };
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
}

interface LiveChatContinuation {
  continuations?: ContinuationItem[];
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

function extractMessages(lcc: LiveChatContinuation): Array<{ text: string; timestampMs: number }> {
  const results: Array<{ text: string; timestampMs: number }> = [];
  for (const action of lcc.actions ?? []) {
    const renderer = action.addChatItemAction?.item?.liveChatTextMessageRenderer;
    if (!renderer) continue;

    const text = (renderer.message?.runs ?? [])
      .filter((run) => run.text !== undefined)
      .map((run) => run.text as string)
      .join('');

    if (!text) continue;

    const timestampMs = renderer.timestampUsec
      ? Math.floor(parseInt(renderer.timestampUsec, 10) / 1000)
      : Date.now();

    results.push({ text, timestampMs });
  }
  return results;
}

function startPolling(videoId: string, initial: ExtractedContinuation): void {
  let stopped = false;
  let currentContinuation = initial.continuation;
  let currentTimeoutMs = initial.timeoutMs;
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
      if (messages.length > 0) {
        chrome.runtime.sendMessage({ action: 'standaloneChatMessages', messages }).catch(() => {});
      }

      const next = extractNextContinuation(lcc);
      if (!next) {
        chrome.runtime.sendMessage({ action: 'standaloneEnded' }).catch(() => {});
        return;
      }

      currentContinuation = next.continuation;
      currentTimeoutMs = next.timeoutMs;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      chrome.runtime.sendMessage({ action: 'standaloneError', message }).catch(() => {});
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
