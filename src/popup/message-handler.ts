import { getCurrentRank } from '../stats/ranks';
import { updateStatusUI } from './status-ui';

// 実績ウィジェット更新
export function updateStatsLink(totalCount: number): void {
  const rank = getCurrentRank(totalCount);
  const emoji = document.getElementById('stats-emoji');
  const name = document.getElementById('stats-rank-name');
  const count = document.getElementById('stats-total-count');
  if (emoji) emoji.textContent = rank.emoji;
  if (name) name.textContent = rank.name;
  if (count) count.textContent = `${totalCount.toLocaleString()}件`;
}

export function initMessageHandler(): void {
  // エラーメッセージ更新のリスナーを追加
  chrome.runtime.onMessage.addListener(function (request: {
    action: string;
    status?: string;
    level?: string;
    message?: string;
    timestamp?: string;
    commentCount?: number;
    queueLength?: number;
    totalCount?: number;
    isRushActive?: boolean;
  }) {
    // ステータス更新
    if (request.action === 'updateStatus') {
      updateStatusUI(
        request.status || 'idle',
        request.message || '',
        request.commentCount || 0,
        request.queueLength || 0,
        request.isRushActive || false
      );
    } else if (request.action === 'updateErrorMessage') {
      const errorElement = document.getElementById('error');
      if (errorElement) {
        errorElement.textContent = request.message || '';
      }
    }
    // 累計読み上げ数の更新
    else if (request.action === 'updateStats') {
      updateStatsLink(request.totalCount || 0);
    }
    // デバッグメッセージリスナー
    else if (request.action === 'debugInfo') {
      const debugElement = document.getElementById('debug');
      // #debug の親要素（ログのアコーディオン）を直接取得
      const accordionContent = debugElement?.closest('.accordion-content') as HTMLElement | null;
      if (debugElement && accordionContent) {
        // スクロール位置の判定
        // クライアントの高さ + スクロール量が、全体の高さとほぼ同じであれば一番下にいると判定
        // 許容誤差を大きめ(50px)にして、ほぼ底付近にいれば自動スクロールを維持する
        const isScrolledToBottom =
          accordionContent.scrollHeight - accordionContent.clientHeight <=
          accordionContent.scrollTop + 50;

        const timestamp = request.timestamp || new Date().toLocaleTimeString();
        const level = request.level || 'info';
        const span = document.createElement('span');
        span.className = `log-${level}`;
        span.textContent = `[${timestamp}] ${request.message}\n`;
        debugElement.appendChild(span);

        // 一番下にいた場合のみ、新しいログに合わせて一番下までスクロールさせる
        if (isScrolledToBottom) {
          accordionContent.scrollTop = accordionContent.scrollHeight;
        }
      }
    }
  });

  // 実績ページを開く
  document.getElementById('stats-link')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('stats/stats.html') });
  });

  // 専用ページを開く
  document.getElementById('open-log-page')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('log/log.html') });
  });

  // アコーディオンの機能を追加
  document.querySelectorAll('.accordion-button').forEach((btn) => {
    btn.addEventListener('click', function (this: HTMLElement) {
      this.classList.toggle('active');
      const accordion = this.closest('.accordion');
      const content = accordion?.querySelector('.accordion-content') as HTMLElement;
      if (content) {
        content.classList.toggle('active');
      }
    });
  });
}
