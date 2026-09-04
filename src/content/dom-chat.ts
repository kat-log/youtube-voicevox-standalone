// DOMベース チャット取得 Content Script
// chrome.scripting.executeScript で live_chat iframe 含む全フレームに注入される
// MutationObserver で yt-live-chat-text-message-renderer の追加を監視し、
// テキストを background に送信する。

// 多重実行防止（executeScript + manifest 両方から注入された場合）
// const _win は再注入時に SyntaxError になるため window を直接キャストして使用する
type WindowWithInit = Window & { __domChatInitialized?: boolean };
if ((window as WindowWithInit).__domChatInitialized) {
  // すでに実行中なので何もしない
} else {
  (window as WindowWithInit).__domChatInitialized = true;

  let observer: MutationObserver | null = null;
  let active = false;
  // 拡張機能の再読み込み・更新・無効化で拡張コンテキストが破棄されると、
  // ページに残った古い content script は chrome API 呼び出しで
  // "Extension context invalidated." を同期 throw する（＝孤児化）。
  // 想定内の状態なので例外は握りつぶし、自分自身を停止する。
  let orphaned = false;
  let storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0] | null = null;

  // コンテキスト破棄後は chrome.runtime.id が undefined になる
  const isContextValid = (): boolean => {
    try {
      return chrome.runtime?.id !== undefined;
    } catch {
      return false;
    }
  };

  const handleOrphaned = (): void => {
    if (orphaned) return;
    orphaned = true;
    active = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (storageListener) {
      try {
        chrome.storage.onChanged.removeListener(storageListener);
      } catch {
        // コンテキスト破棄後は removeListener 自体も失敗しうる
      }
      storageListener = null;
    }
    // 拡張機能を再読み込みしたあと同じタブへ再注入されたとき、
    // 「すでに実行中」と誤判定して新しいスクリプトが起動しないのを防ぐ
    (window as WindowWithInit).__domChatInitialized = false;
  };

  /** chrome API 呼び出しラッパ。孤児化していれば何もせず false を返す */
  const callChrome = (fn: () => void): boolean => {
    if (orphaned || !isContextValid()) {
      handleOrphaned();
      return false;
    }
    try {
      fn();
      return true;
    } catch {
      // "Extension context invalidated." など。想定内なので握りつぶす
      handleOrphaned();
      return false;
    }
  };

  const sendLog = (message: string): void => {
    callChrome(() => {
      chrome.runtime.sendMessage({ action: 'domChatLog', message }).catch(() => {});
    });
  };

  // alt が絵文字・絵文字修飾子のみで構成されているか（標準Unicode絵文字の img 判定用）
  const UNICODE_EMOJI_ONLY_REGEX =
    /^[\uFE0F\u200D\p{Emoji_Presentation}\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]+$/u;

  const extractText = (renderer: Element): string => {
    const messageEl = renderer.querySelector('#message');
    if (!messageEl) return '';

    let text = '';
    for (const node of messageEl.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.tagName === 'IMG') {
          const alt = (el as HTMLImageElement).alt?.trim() ?? '';
          if (alt) {
            if (alt.startsWith(':') && alt.endsWith(':')) {
              // すでにショートコード形式（例: ":_2BROOtojya:"）
              text += alt;
            } else if (UNICODE_EMOJI_ONLY_REGEX.test(alt)) {
              // 標準Unicode絵文字（YouTubeは <img alt="🙌"> で描画する）。
              // コロンで包むと偽ショートコードになり、絵文字除去時に
              // 後続の本文まで巻き込んで削除されてしまうため、そのまま連結する。
              text += alt;
            } else {
              // カスタム絵文字名（例: "KyoyuAnijyaKyoyu"）
              text += `:${alt}:`;
            }
          }
        } else {
          text += el.textContent ?? '';
        }
      }
    }
    return text.trim();
  };

  const startObserver = (): void => {
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
          if (retryCount === MAX_RETRIES) {
            sendLog(`チャットDOM (#items) が ${MAX_RETRIES * 0.5}秒待っても見つかりません。チャット欄が表示されているか確認してください。低速リトライへ切り替えます。`);
          }
          setTimeout(tryAttach, 5000);
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

        const batchBaseTime = Date.now();
        const newMessages: Array<{ text: string; timestampMs: number }> = [];

        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;

            const checkRenderer = (el: Element): void => {
              if (existing.has(el)) return;
              existing.add(el);
              const text = extractText(el);
              if (text) {
                newMessages.push({ text, timestampMs: batchBaseTime + newMessages.length });
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
          callChrome(() => {
            chrome.runtime
              .sendMessage({ action: 'domChatMessages', messages: newMessages })
              .catch((e) => {
                sendLog(`送信エラー: ${String(e)}`);
              });
          });
        }
      });

      observer.observe(items, { childList: true, subtree: true });
      sendLog('MutationObserver 監視開始完了');
    };

    tryAttach();
  };

  const stopObserver = (): void => {
    if (!active && !observer) return;
    active = false;
    if (observer) {
      observer.disconnect();
      observer = null;
      sendLog('Observer 停止');
    }
  };

  // ページロード時ログ
  sendLog(`dom-chat.ts ロード完了 (URL: ${location.href})`);

  // storage 確認して自動起動
  callChrome(() => {
    chrome.storage.session.get(['chatMode', 'domModeActive'], (data) => {
      sendLog(`ストレージ確認: chatMode=${String(data.chatMode)}, domModeActive=${String(data.domModeActive)}`);
      if (data.chatMode === 'dom' && data.domModeActive === true) {
        startObserver();
      }
    });
  });

  // storage 変化を監視
  storageListener = (changes, areaName): void => {
    if (orphaned) return;
    if (areaName !== 'session') return;
    const modeActive = changes.domModeActive;
    const chatMode = changes.chatMode;

    if (!modeActive && !chatMode) return;

    sendLog(`storage 変化: domModeActive=${String(modeActive?.newValue)}, chatMode=${String(chatMode?.newValue)}`);

    if (modeActive?.newValue === true) {
      const newChatMode = chatMode?.newValue as string | undefined;
      if (newChatMode === 'dom' || !newChatMode) {
        if (!newChatMode) {
          callChrome(() => {
            chrome.storage.session.get(['chatMode'], (d) => {
              if (d.chatMode === 'dom') startObserver();
            });
          });
        } else {
          startObserver();
        }
      }
    } else if (modeActive?.newValue === false) {
      stopObserver();
    }
  };
  callChrome(() => {
    if (storageListener) chrome.storage.onChanged.addListener(storageListener);
  });
}
