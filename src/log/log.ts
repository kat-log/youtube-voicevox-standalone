import '../styles/styles.scss';
import type { LogLevel, LogEntry } from '@/types/messages';

// フィルタ状態: どのレベルを表示するか
const activeFilters = new Set<LogLevel>(['info', 'warn', 'error']);

// 初期化時にダークモード設定を反映
chrome.storage.sync.get(['darkMode'], function (data) {
  let isDark: boolean;
  if (data.darkMode !== undefined) {
    isDark = data.darkMode;
  } else {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  if (isDark) {
    document.body.classList.add('dark-mode');
  }
});

// ログエントリからspan要素を生成する共通関数
function createLogSpan(level: LogLevel, timestamp: string, message: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.dataset.level = level;
  span.textContent = `[${timestamp}] ${message}\n`;

  // レベル別CSSクラス
  const levelClass = `log-${level}`;
  const isSeparator = message.includes('══════');
  span.className = isSeparator ? `${levelClass} log-separator` : levelClass;

  // フィルタ状態に応じて表示/非表示
  if (!activeFilters.has(level)) {
    span.style.display = 'none';
  }

  return span;
}

// session storage から保存済みログを復元
chrome.storage.session.get({ debugLogs: [] }, (data) => {
  const debugElement = document.getElementById('debug');
  if (debugElement && data.debugLogs.length > 0) {
    for (const entry of data.debugLogs) {
      // 旧形式（文字列）との互換対応
      if (typeof entry === 'string') {
        const span = createLogSpan('info', '', '');
        span.textContent = entry + '\n';
        if (entry.includes('══════')) {
          span.className = 'log-info log-separator';
        }
        debugElement.appendChild(span);
      } else {
        const log = entry as LogEntry;
        debugElement.appendChild(createLogSpan(log.level, log.timestamp, log.message));
      }
    }
    const logContentArea = document.getElementById('log-content-area');
    if (logContentArea) {
      logContentArea.scrollTop = logContentArea.scrollHeight;
    }
  }
});

// リアルタイムメッセージリスナー
chrome.runtime.onMessage.addListener(function (request: {
  action: string;
  level?: LogLevel;
  message?: string;
  timestamp?: string;
}) {
  if (request.action === 'debugInfo') {
    const debugElement = document.getElementById('debug');
    const logContentArea = document.getElementById('log-content-area');

    if (debugElement && logContentArea) {
      const isScrolledToBottom =
        logContentArea.scrollHeight - logContentArea.clientHeight <= logContentArea.scrollTop + 50;

      const level: LogLevel = request.level || 'info';
      const timestamp = request.timestamp || new Date().toLocaleTimeString();
      debugElement.appendChild(createLogSpan(level, timestamp, request.message || ''));

      if (isScrolledToBottom) {
        logContentArea.scrollTop = logContentArea.scrollHeight;
      }
    }
  }
});

// フィルタボタンのトグルロジック
document.querySelectorAll<HTMLButtonElement>('.log-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const level = btn.dataset.level as LogLevel;
    btn.classList.toggle('active');

    if (activeFilters.has(level)) {
      activeFilters.delete(level);
    } else {
      activeFilters.add(level);
    }

    // 該当レベルのログ要素を一括show/hide
    const debugElement = document.getElementById('debug');
    if (debugElement) {
      const spans = debugElement.querySelectorAll<HTMLSpanElement>(`[data-level="${level}"]`);
      const display = activeFilters.has(level) ? '' : 'none';
      spans.forEach((span) => { span.style.display = display; });
    }
  });
});

// ログクリア機能
document.getElementById('clear-log')?.addEventListener('click', () => {
  const debugElement = document.getElementById('debug');
  if (debugElement) {
    debugElement.textContent = '';
  }
  chrome.storage.session.set({ debugLogs: [] });
});
