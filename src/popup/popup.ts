import '../styles/popup-layout.scss';
import '../styles/styles.scss';
import { loadSettings } from './settings-loader';
import { initMessageHandler } from './message-handler';
import { initPlaybackControls } from './playback-controls';
import { initFilterConfig } from './filter-config';
import { initRushModeConfig } from './rush-mode-config';
import { initAutoCatchupConfig } from './auto-catchup-config';
import { initTtsEngineConfig } from './tts-engine-config';
import { initParallelPlaybackConfig } from './parallel-playback-config';
import { initRandomSpeakerConfig } from './random-speaker-config';
import { initDarkMode } from './dark-mode';
import { initTestSpeakConfig } from './test-speak-config';
import { initDataManagement } from './data-management';

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initMessageHandler();
  initPlaybackControls();
  initFilterConfig();
  initRushModeConfig();
  initAutoCatchupConfig();
  initTtsEngineConfig();
  initParallelPlaybackConfig();
  initRandomSpeakerConfig();
  initDarkMode();
  initTestSpeakConfig();
  initDataManagement();
});
