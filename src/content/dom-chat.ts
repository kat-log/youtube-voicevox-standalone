// DOMベース チャット取得 Content Script
// chrome.scripting.executeScript で live_chat iframe 含む全フレームに注入される
// MutationObserver で yt-live-chat-text-message-renderer の追加を監視し、
// テキストを background に送信する。

// 多重実行防止（executeScript + manifest 両方から注入された場合）
const _win = window as Window & { __domChatInitialized?: boolean };
if (_win.__domChatInitialized) {
  // すでに実行中なので何もしない
} else {
  _win.__domChatInitialized = true;

  let observer: MutationObserver | null = null;
  let active = false;

  function sendLog(message: string): void {
    chrome.runtime.sendMessage({ action: 'domChatLog', message }).catch(() => {});
  }

  function sendError(message: string): void {
    chrome.runtime.sendMessage({ action: 'domChatError', message }).catch(() => {});
  }

  function extractText(renderer: Element): string {
    const messageEl = renderer.querySelector('#message');
    if (!messageEl) return '';

    let text = '';
    for (const node of messageEl.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.tagName === 'IMG') {
          text += (el as HTMLImageElement).alt ?? '';
        } else {
          text += el.textContent ?? '';
        }
      }
    }
    return text.trim();
  }

  function startObserver(): void {
    if (active) return;
    active = true;
    sendLog(`Observer 開始 (URL: ${location.href})`);

    let retryCount = 0;
    const MAX_RETRIES = 20;

    const tryAttach = (): void => {
      if (!active) return;

      const items = document.querySelector('yt-live-chat-item-list-renderer #items');
      if (!items) {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          sendError(`チャットDOM (#items) が ${MAX_RETRIES * 0.5}秒待っても見つかりません。チャット欄が表示されているか確認してください。`);
          active = false;
          return;
        }
        if (retryCount === 1) {
          sendLog('チャットDOM (#items) 待機中...');
        }
        setTimeout(tryAttach, 500);
        return;
      }

      sendLog(`チャットDOM 発見 (${items.children.length}件表示中), MutationObserver 開始`);

      // 開始時点で表示済みのメッセージを記録（重複送信防止）
      const existing = new Set<Element>(
        Array.from(items.querySelectorAll('yt-live-chat-text-message-renderer'))
      );

      observer = new MutationObserver((mutations) => {
        if (!active) return;

        const newMessages: Array<{ text: string; timestampMs: number }> = [];

        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;

            const checkRenderer = (el: Element): void => {
              if (existing.has(el)) return;
              existing.add(el);
              const text = extractText(el);
              if (text) {
                newMessages.push({ text, timestampMs: Date.now() });
              }
            };

            if (node.tagName?.toLowerCase() === 'yt-live-chat-text-message-renderer') {
              checkRenderer(node);
            }
            node.querySelectorAll('yt-live-chat-text-message-renderer').forEach(checkRenderer);
          }
        }

        if (newMessages.length > 0) {
          sendLog(`新着コメント ${newMessages.length}件 → background へ送信`);
          chrome.runtime.sendMessage({ action: 'domChatMessages', messages: newMessages }).catch((e) => {
            sendLog(`送信エラー: ${String(e)}`);
          });
        }
      });

      observer.observe(items, { childList: true, subtree: true });
      sendLog('MutationObserver 監視開始完了');
    };

    tryAttach();
  }

  function stopObserver(): void {
    if (!active && !observer) return;
    active = false;
    if (observer) {
      observer.disconnect();
      observer = null;
      sendLog('Observer 停止');
    }
  }

  // ページロード時ログ
  sendLog(`dom-chat.ts ロード完了 (URL: ${location.href})`);

  // storage 確認して自動起動
  chrome.storage.session.get(['chatMode', 'domModeActive'], (data) => {
    sendLog(`ストレージ確認: chatMode=${String(data.chatMode)}, domModeActive=${String(data.domModeActive)}`);
    if (data.chatMode === 'dom' && data.domModeActive === true) {
      startObserver();
    }
  });

  // storage 変化を監視
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session') return;
    const modeActive = changes.domModeActive;
    const chatMode = changes.chatMode;

    sendLog(`storage 変化: domModeActive=${String(modeActive?.newValue)}, chatMode=${String(chatMode?.newValue)}`);

    if (modeActive?.newValue === true) {
      const newChatMode = chatMode?.newValue as string | undefined;
      if (newChatMode === 'dom' || !newChatMode) {
        if (!newChatMode) {
          chrome.storage.session.get(['chatMode'], (d) => {
            if (d.chatMode === 'dom') startObserver();
          });
        } else {
          startObserver();
        }
      }
    } else if (modeActive?.newValue === false) {
      stopObserver();
    }
  });
}
