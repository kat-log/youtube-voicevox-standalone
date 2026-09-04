import '../styles/popup-layout.scss';
import '../styles/styles.scss';
import { loadSettings } from './settings-loader';
import { initMessageHandler } from './message-handler';
import { initPlaybackControls } from './playback-controls';
import { initFilterConfig } from './filter-config';
import { initRushModeConfig } from './rush-mode-config';
import { initRandomSpeedConfig } from './random-speed-config';
import { initAutoCatchupConfig } from './auto-catchup-config';
import { initTtsEngineConfig } from './tts-engine-config';
import { initParallelPlaybackConfig } from './parallel-playback-config';
import { initRandomSpeakerConfig } from './random-speaker-config';
import { initDarkMode } from './dark-mode';
import { initTestSpeakConfig } from './test-speak-config';
import { initSectionLayout, applySectionLayout } from './section-layout';

// これ以上のキーが一度に変わったら設定インポート／リセットとみなす（background と同じ閾値）
const BULK_CHANGE_THRESHOLD = 5;

/**
 * 設定ページでのインポート／リセットは storage を直接書き換えるため、
 * ポップアップをタブで開いている場合は表示が古いままになる。
 * 一括変更を検知して画面全体を読み込み直す。
 */
function initBulkChangeRefresh(): void {
  // インポートは削除と書き込みの2回に分かれて届くため、まとめて1回だけ読み直す
  let timer: ReturnType<typeof setTimeout> | undefined;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (Object.keys(changes).length < BULK_CHANGE_THRESHOLD) return;

    clearTimeout(timer);
    timer = setTimeout(() => {
      loadSettings();
      applySectionLayout();
    }, 100);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initMessageHandler();
  initPlaybackControls();
  initFilterConfig();
  initRushModeConfig();
  initRandomSpeedConfig();
  initAutoCatchupConfig();
  initTtsEngineConfig();
  initParallelPlaybackConfig();
  initRandomSpeakerConfig();
  initDarkMode();
  initTestSpeakConfig();
  initSectionLayout();
  initBulkChangeRefresh();
});
