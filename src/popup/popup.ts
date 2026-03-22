import '../styles/styles.scss';
import { loadSettings } from './settings-loader';
import { initMessageHandler } from './message-handler';
import { initPlaybackControls } from './playback-controls';
import { initFilterConfig } from './filter-config';
import { initRushModeConfig } from './rush-mode-config';
import { initAutoCatchupConfig } from './auto-catchup-config';
import { initTtsEngineConfig } from './tts-engine-config';
import { initParallelPlaybackConfig } from './parallel-playback-config';
import { initDarkMode } from './dark-mode';

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initMessageHandler();
  initPlaybackControls();
  initFilterConfig();
  initRushModeConfig();
  initAutoCatchupConfig();
  initTtsEngineConfig();
  initParallelPlaybackConfig();
  initDarkMode();
});
