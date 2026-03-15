import { getState, updateState } from './state';
import { stopAll } from './lifecycle';

export function initTabListeners(): void {
  // タブが閉じられた場合のクリーンアップ
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === getState().activeTabId) {
      stopAll();
      updateState({ activeTabId: null });
    }
  });

  // タブがYouTube以外に遷移した場合のクリーンアップ
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === getState().activeTabId && changeInfo.url) {
      if (!changeInfo.url.includes('youtube.com/watch')) {
        stopAll();
        updateState({ activeTabId: null });
      }
    }
  });
}
