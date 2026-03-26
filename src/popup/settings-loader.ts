import { setRangeFill, updateDualRangeFill, formatMaxLength, maxLengthToSlider } from './slider-utils';
import { updateStatusUI, validateInputs, updateShortcutTooltips } from './status-ui';
import { setSpeed, setVolume } from './playback-controls';
import { updateStatsLink } from './message-handler';
import { toggleEngineUI, populateBrowserVoices, fetchLocalSpeakers, updateVoicevoxBalanceVisibility } from './tts-engine-config';
import { updateParallelSpeakersToggleState, updateSpeakerCountSummary } from './parallel-playback-config';
import { updateRandomSpeakerSummary, updateSpeakerDropdownForRandomMode } from './random-speaker-config';

export function loadSettings(): void {
  chrome.storage.sync.get(
    [
      'apiKeyVOICEVOX',
      'apiKeyYoutube',
      'speed',
      'volume',
      'latestOnlyMode',
      'latestOnlyCount',
      'speakerId',
      'darkMode',
      'filterConfig',
      'ttsEngine',
      'browserVoice',
      'localVoicevoxHost',
      'localSpeakerId',
      'rushModeConfig',
      'autoCatchUpConfig',
      'parallelPlaybackConfig',
      'parallelSpeakersConfig',
      'randomSpeakerEnabled',
      'parallelSynthesisCount',
    ],
    function (data) {
      (document.getElementById('apiKeyVOICEVOX') as HTMLInputElement).value =
        data.apiKeyVOICEVOX || '';
      (document.getElementById('apiKeyYoutube') as HTMLInputElement).value =
        data.apiKeyYoutube || '';
      updateVoicevoxBalanceVisibility();

      const loadedSpeed = data.speed || 1.0;
      setSpeed(loadedSpeed);
      const speedSlider = document.getElementById('speed') as HTMLInputElement;
      speedSlider.value = String(loadedSpeed);
      document.getElementById('current-speed')!.textContent = `${loadedSpeed.toFixed(1)}x`;
      speedSlider.setAttribute('aria-valuetext', `${loadedSpeed.toFixed(1)}倍速`);
      setRangeFill(speedSlider);

      const loadedVolume = data.volume || 1.0;
      setVolume(loadedVolume);
      const volumeSlider = document.getElementById('volume') as HTMLInputElement;
      volumeSlider.value = String(loadedVolume);
      document.getElementById('current-volume')!.textContent = `${loadedVolume}`;
      setRangeFill(volumeSlider);
      const volumePct = Math.round(loadedVolume * 100);
      document.getElementById('volume')!.setAttribute('aria-valuetext', `音量${volumePct}%`);

      const latestOnlyMode = data.latestOnlyMode || false;
      (document.getElementById('latestOnlyMode') as HTMLInputElement).checked = latestOnlyMode;
      document
        .getElementById('latestOnlyMode')!
        .setAttribute('aria-checked', String(latestOnlyMode));

      const latestOnlyCount = data.latestOnlyCount || 3;
      document.getElementById('latest-only-options')!.style.display = latestOnlyMode
        ? 'block'
        : 'none';
      const latestCountSlider = document.getElementById('latestOnlyCount') as HTMLInputElement;
      latestCountSlider.value = String(latestOnlyCount);
      document.getElementById('current-latest-count')!.textContent = `${latestOnlyCount}件`;
      latestCountSlider.setAttribute('aria-valuetext', `${latestOnlyCount}件`);
      setRangeFill(latestCountSlider);

      // ダークモード設定を復元（未設定時はシステム設定に従う）
      const darkModeCheckbox = document.getElementById('darkMode') as HTMLInputElement;
      let isDark: boolean;
      if (data.darkMode !== undefined) {
        isDark = data.darkMode;
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      if (isDark) {
        document.body.classList.add('dark-mode');
        darkModeCheckbox.checked = true;
        darkModeCheckbox.setAttribute('aria-checked', 'true');
      }

      // フィルタ設定を復元
      const fc = data.filterConfig || {
        enabled: false,
        minLength: 1,
        maxLength: 0,
        skipEmojiOnly: false,
        ngWords: [],
      };
      (document.getElementById('filterEnabled') as HTMLInputElement).checked = fc.enabled;
      document.getElementById('filterEnabled')!.setAttribute('aria-checked', String(fc.enabled));
      document.getElementById('filter-options')!.style.display = fc.enabled ? 'block' : 'none';
      const filterMinLengthSlider = document.getElementById('filterMinLength') as HTMLInputElement;
      filterMinLengthSlider.value = String(fc.minLength);
      document.getElementById('current-min-length')!.textContent = String(fc.minLength);
      document.getElementById('min-length-display')!.textContent = String(fc.minLength);
      const maxSliderVal = maxLengthToSlider(fc.maxLength || 0);
      const filterMaxLengthSlider = document.getElementById('filterMaxLength') as HTMLInputElement;
      filterMaxLengthSlider.value = String(maxSliderVal);
      const maxDisplay = formatMaxLength(maxSliderVal);
      document.getElementById('current-max-length')!.textContent = maxDisplay;
      document.getElementById('max-length-display')!.textContent = maxDisplay;
      updateDualRangeFill();
      (document.getElementById('filterSkipEmojiOnly') as HTMLInputElement).checked =
        fc.skipEmojiOnly;
      document
        .getElementById('filterSkipEmojiOnly')!
        .setAttribute('aria-checked', String(fc.skipEmojiOnly));
      (document.getElementById('filterStripEmoji') as HTMLInputElement).checked =
        fc.stripEmoji || false;
      document
        .getElementById('filterStripEmoji')!
        .setAttribute('aria-checked', String(fc.stripEmoji || false));
      (document.getElementById('filterNgWords') as HTMLInputElement).value = (
        fc.ngWords || []
      ).join(', ');
      const ngWordAction = fc.ngWordAction || 'remove';
      const ngWordActionRadio = document.querySelector(
        `input[name="ngWordAction"][value="${ngWordAction}"]`
      ) as HTMLInputElement | null;
      if (ngWordActionRadio) ngWordActionRadio.checked = true;
      const hasNgWords = (fc.ngWords || []).length > 0;
      document.getElementById('ngWordActionGroup')!.style.display = hasNgWords ? 'block' : 'none';

      // ラッシュモード設定を復元
      const rc = data.rushModeConfig || {
        enabled: false,
        activateThreshold: 20,
        returnThreshold: 0,
        rushSpeed: 2.0,
      };
      (document.getElementById('rushModeEnabled') as HTMLInputElement).checked = rc.enabled;
      document.getElementById('rushModeEnabled')!.setAttribute('aria-checked', String(rc.enabled));
      document.getElementById('rush-mode-options')!.style.display = rc.enabled ? 'block' : 'none';

      const rushActivateSlider = document.getElementById('rushActivateThreshold') as HTMLInputElement;
      rushActivateSlider.value = String(rc.activateThreshold);
      document.getElementById('current-rush-activate')!.textContent = `${rc.activateThreshold}件`;
      rushActivateSlider.setAttribute('aria-valuetext', `${rc.activateThreshold}件`);
      setRangeFill(rushActivateSlider);

      const rushSpeedSlider = document.getElementById('rushSpeed') as HTMLInputElement;
      rushSpeedSlider.value = String(rc.rushSpeed);
      document.getElementById('current-rush-speed')!.textContent = `${rc.rushSpeed.toFixed(1)}x`;
      rushSpeedSlider.setAttribute('aria-valuetext', `${rc.rushSpeed.toFixed(1)}倍速`);
      setRangeFill(rushSpeedSlider);

      const rushReturnSlider = document.getElementById('rushReturnThreshold') as HTMLInputElement;
      rushReturnSlider.value = String(rc.returnThreshold);
      document.getElementById('current-rush-return')!.textContent = `${rc.returnThreshold}件`;
      rushReturnSlider.setAttribute('aria-valuetext', `${rc.returnThreshold}件`);
      setRangeFill(rushReturnSlider);

      // 自動キャッチアップ設定を復元
      const ac = data.autoCatchUpConfig || {
        enabled: false,
        threshold: 50,
      };
      (document.getElementById('autoCatchUpEnabled') as HTMLInputElement).checked = ac.enabled;
      document.getElementById('autoCatchUpEnabled')!.setAttribute('aria-checked', String(ac.enabled));
      document.getElementById('auto-catchup-options')!.style.display = ac.enabled ? 'block' : 'none';

      const catchUpThresholdSlider = document.getElementById('autoCatchUpThreshold') as HTMLInputElement;
      catchUpThresholdSlider.value = String(ac.threshold);
      document.getElementById('current-catchup-threshold')!.textContent = `${ac.threshold}件`;
      catchUpThresholdSlider.setAttribute('aria-valuetext', `${ac.threshold}件`);
      setRangeFill(catchUpThresholdSlider);

      // 並列再生設定を復元
      const pp = data.parallelPlaybackConfig || {
        alwaysEnabled: false,
        autoEnabled: false,
        autoTriggerThreshold: 10,
      };
      (document.getElementById('parallelAlwaysEnabled') as HTMLInputElement).checked = pp.alwaysEnabled;
      document.getElementById('parallelAlwaysEnabled')!.setAttribute('aria-checked', String(pp.alwaysEnabled));
      document.getElementById('parallel-always-options')!.style.display = pp.alwaysEnabled ? 'block' : 'none';

      (document.getElementById('parallelAutoEnabled') as HTMLInputElement).checked = pp.autoEnabled;
      document.getElementById('parallelAutoEnabled')!.setAttribute('aria-checked', String(pp.autoEnabled));
      document.getElementById('parallel-auto-options')!.style.display = pp.autoEnabled ? 'block' : 'none';

      const parallelAutoThresholdSlider = document.getElementById('parallelAutoTriggerThreshold') as HTMLInputElement;
      parallelAutoThresholdSlider.value = String(pp.autoTriggerThreshold);
      document.getElementById('current-parallel-auto-threshold')!.textContent = `${pp.autoTriggerThreshold}件`;
      parallelAutoThresholdSlider.setAttribute('aria-valuetext', `${pp.autoTriggerThreshold}件`);
      setRangeFill(parallelAutoThresholdSlider);

      // TTSエンジン設定を復元
      const engine = data.ttsEngine || 'voicevox';
      (document.getElementById('ttsEngine') as HTMLSelectElement).value = engine;
      toggleEngineUI(engine);

      // ブラウザ音声リストを取得
      populateBrowserVoices(data.browserVoice);

      // ローカルVOICEVOXホスト設定を復元
      if (data.localVoicevoxHost) {
        (document.getElementById('localVoicevoxHost') as HTMLInputElement).value =
          data.localVoicevoxHost;
      }

      // 並列音声生成数を復元
      const parallelSynthesisCount = data.parallelSynthesisCount || 3;
      const parallelSynthesisSlider = document.getElementById('parallelSynthesisCount') as HTMLInputElement;
      parallelSynthesisSlider.value = String(parallelSynthesisCount);
      document.getElementById('current-parallel-synthesis')!.textContent = String(parallelSynthesisCount);
      parallelSynthesisSlider.setAttribute('aria-valuetext', String(parallelSynthesisCount));
      setRangeFill(parallelSynthesisSlider);

      // ローカルVOICEVOX選択時にスピーカーリストを自動取得
      if (engine === 'local-voicevox') {
        const host =
          data.localVoicevoxHost ||
          (document.getElementById('localVoicevoxHost') as HTMLInputElement).value;
        fetchLocalSpeakers(host, data.localSpeakerId);
      }

      // 持ち回り制話者設定を復元（トグル状態と要約テキストのみ、詳細は専用ページ）
      const psc = data.parallelSpeakersConfig || { enabled: false, speakerIds: [], roundRobinSpeakerCount: 3 };
      const parallelSpeakersToggle = document.getElementById('parallelSpeakersEnabled') as HTMLInputElement;
      parallelSpeakersToggle.checked = psc.enabled;
      parallelSpeakersToggle.setAttribute('aria-checked', String(psc.enabled));
      document.getElementById('parallel-speakers-options')!.style.display = psc.enabled ? 'block' : 'none';

      // 話者数の要約テキストを初期化
      updateSpeakerCountSummary();

      // 話者一覧を取得して選択メニューを作成
      fetch('https://static.tts.quest/voicevox_speakers.json')
        .then((response) => response.json())
        .then((speakers: (string | null)[]) => {
          const select = document.getElementById('speaker') as HTMLSelectElement;
          speakers.forEach((speaker, index) => {
            if (speaker) {
              const option = document.createElement('option');
              option.value = String(index);
              option.textContent = speaker;
              select.appendChild(option);
            }
          });
          // 保存された話者IDを選択
          select.value = data.speakerId || '1';

          // ランダム話者モードの復元
          const randomEnabled = data.randomSpeakerEnabled || false;
          const randomCheckbox = document.getElementById('randomSpeakerEnabled') as HTMLInputElement;
          randomCheckbox.checked = randomEnabled;
          randomCheckbox.setAttribute('aria-checked', String(randomEnabled));
          if (randomEnabled) {
            // 現在のエンジンに応じた話者ドロップダウンを無効化・ラベル表示
            updateSpeakerDropdownForRandomMode(engine, true);
            // 話者選択リンクと要約を表示
            const configLink = document.getElementById('random-speaker-config-link');
            if (configLink) configLink.style.display = 'block';
            updateRandomSpeakerSummary();
          }

          // 持ち回り制トグルの有効/無効を設定
          updateParallelSpeakersToggleState();
        });

      // OSに応じてツールチップのテキストを更新
      updateShortcutTooltips();

      // 現在のステータスを取得
      chrome.runtime.sendMessage(
        { action: 'getStatus' },
        function (response: { status?: string; commentCount?: number; queueLength?: number; isRushActive?: boolean }) {
          if (chrome.runtime.lastError) return;
          if (response) {
            updateStatusUI(
              response.status || 'idle',
              '',
              response.commentCount || 0,
              response.queueLength || 0,
              response.isRushActive || false
            );
          }
        }
      );

      // 初期バリデーション
      validateInputs();
    }
  );

  // 累計読み上げ数を読み込んで実績ウィジェットを更新
  chrome.storage.local.get({ stats: { totalCount: 0 } }, (data) => {
    updateStatsLink(data.stats.totalCount);
  });

  // session storage から保存済みログを復元
  chrome.storage.session.get({ debugLogs: [] }, (data) => {
    const debugElement = document.getElementById('debug');
    if (debugElement && data.debugLogs.length > 0) {
      debugElement.textContent = data.debugLogs.join('\n') + '\n';
      const accordionContent = debugElement.closest('.accordion-content') as HTMLElement | null;
      if (accordionContent) {
        accordionContent.scrollTop = accordionContent.scrollHeight;
      }
    }
  });
}
