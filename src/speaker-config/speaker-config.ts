import '../styles/styles.scss';
import type { TtsEngine, ParallelSpeakersConfig } from '@/types/state';
import { RANDOM_SPEAKER_SENTINEL } from '@/types/state';

let speakerOptions: Array<{ value: string; label: string }> = [];
let currentEngine: TtsEngine = 'voicevox';
let savedEnabled = false; // 持ち回り制の有効/無効（このページでは変更しない）
let savedSpeakerIds: string[] = [];
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

// --- Dark mode ---
chrome.storage.sync.get(['darkMode'], (data) => {
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

// --- Init ---
chrome.storage.sync.get(
  ['ttsEngine', 'localVoicevoxHost', 'parallelSpeakersConfig', 'randomSpeakerEnabled'],
  (data) => {
    currentEngine = (data.ttsEngine as TtsEngine) || 'voicevox';
    const host = data.localVoicevoxHost || 'http://localhost:50021';

    const engineLabel = document.getElementById('engine-label')!;
    if (currentEngine === 'browser') {
      engineLabel.textContent = 'ブラウザ内蔵音声';
    } else if (currentEngine === 'local-voicevox') {
      engineLabel.textContent = `ローカル VOICEVOX（${host}）`;
    } else {
      engineLabel.textContent = 'VOICEVOX（Web API）';
    }

    // 保存済み設定を復元
    const psc: ParallelSpeakersConfig = data.parallelSpeakersConfig || {
      enabled: false,
      speakerIds: [],
      roundRobinSpeakerCount: 3,
    };
    savedEnabled = psc.enabled;
    savedSpeakerIds = psc.speakerIds;

    const countSlider = document.getElementById('speakerCount') as HTMLInputElement;
    countSlider.value = String(psc.roundRobinSpeakerCount);
    document.getElementById('current-count')!.textContent = String(psc.roundRobinSpeakerCount);
    countSlider.setAttribute('aria-valuetext', String(psc.roundRobinSpeakerCount));

    // ランダム話者モードの判定
    const randomEnabled = data.randomSpeakerEnabled || false;
    if (randomEnabled) {
      document.getElementById('speaker-assignments')!.style.display = 'none';
      document.getElementById('random-mode-note')!.style.display = 'block';
    } else if (!psc.enabled) {
      // 持ち回り制がOFFの場合、個別話者設定は不要
      document.getElementById('speaker-assignments')!.style.display = 'none';
      document.getElementById('round-robin-off-note')!.style.display = 'block';
    }

    fetchSpeakers(host);
  }
);

function fetchSpeakers(localHost: string): void {
  if (currentEngine === 'browser') {
    chrome.tts.getVoices((voices) => {
      speakerOptions = voices
        .filter((v) => v.voiceName)
        .map((v) => ({
          value: v.voiceName!,
          label: `${v.voiceName} (${v.lang || '?'})`,
        }));
      renderDropdowns();
    });
  } else if (currentEngine === 'local-voicevox') {
    chrome.runtime.sendMessage(
      { action: 'getLocalSpeakers', host: localHost },
      (response: {
        status: string;
        speakers?: Array<{ name: string; styles: Array<{ id: number; name: string }> }>;
      }) => {
        if (chrome.runtime.lastError || !response || response.status !== 'success' || !response.speakers) {
          document.getElementById('speaker-list')!.innerHTML =
            '<p class="info-text" style="color: var(--error-color)">ローカル VOICEVOX から話者リストを取得できませんでした。</p>';
          return;
        }
        speakerOptions = [];
        for (const speaker of response.speakers) {
          for (const style of speaker.styles) {
            speakerOptions.push({
              value: String(style.id),
              label: `${speaker.name} (${style.name})`,
            });
          }
        }
        renderDropdowns();
      }
    );
  } else {
    // VOICEVOX Web API
    fetch('https://static.tts.quest/voicevox_speakers.json')
      .then((res) => res.json())
      .then((speakers: (string | null)[]) => {
        speakerOptions = [];
        speakers.forEach((speaker, index) => {
          if (speaker) {
            speakerOptions.push({ value: String(index), label: speaker });
          }
        });
        renderDropdowns();
      })
      .catch(() => {
        document.getElementById('speaker-list')!.innerHTML =
          '<p class="info-text" style="color: var(--error-color)">話者リストの取得に失敗しました。</p>';
      });
  }
}

function renderDropdowns(): void {
  const container = document.getElementById('speaker-list')!;
  container.innerHTML = '';

  const count = parseInt(
    (document.getElementById('speakerCount') as HTMLInputElement).value,
    10
  );
  const dropdownCount = Math.max(0, count - 1);

  for (let i = 0; i < dropdownCount; i++) {
    const row = document.createElement('div');
    row.className = 'speaker-row';

    const label = document.createElement('label');
    label.textContent = `話者${i + 2}:`;

    const select = document.createElement('select');
    select.dataset.index = String(i);
    select.setAttribute('aria-label', `話者${i + 2}の選択`);

    for (const opt of speakerOptions) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }

    // ランダムオプションを末尾に追加
    const randomOption = document.createElement('option');
    randomOption.value = RANDOM_SPEAKER_SENTINEL;
    randomOption.textContent = 'ランダム';
    select.appendChild(randomOption);

    // 保存値を復元
    if (savedSpeakerIds[i]) {
      select.value = savedSpeakerIds[i];
    }

    select.addEventListener('change', () => autoSave());

    row.appendChild(label);
    row.appendChild(select);
    container.appendChild(row);
  }
}

function autoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    const roundRobinSpeakerCount = parseInt(
      (document.getElementById('speakerCount') as HTMLInputElement).value,
      10
    );

    const speakerIds: string[] = [];
    const selects = document.getElementById('speaker-list')!.querySelectorAll('select');
    selects.forEach((select) => {
      speakerIds.push(select.value);
    });

    const config: ParallelSpeakersConfig = {
      enabled: savedEnabled,
      speakerIds,
      roundRobinSpeakerCount,
    };

    chrome.runtime.sendMessage(
      {
        action: 'updateParallelSpeakersConfig',
        parallelSpeakersConfig: config,
      },
      () => {
        savedSpeakerIds = speakerIds;
      }
    );
  }, 300);
}

// --- Slider change ---
const countSlider = document.getElementById('speakerCount') as HTMLInputElement;
countSlider.addEventListener('input', () => {
  const val = parseInt(countSlider.value, 10);
  document.getElementById('current-count')!.textContent = String(val);
  countSlider.setAttribute('aria-valuetext', String(val));
  renderDropdowns();
  autoSave();
});

