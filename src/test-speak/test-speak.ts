import '../styles/styles.scss';
import type { TtsEngine } from '@/types/state';
import {
  parseSpeakerName,
  parseLocalSpeakers,
  groupByCharacter,
  type ParsedSpeaker,
} from '@/utils/speaker-parser';
import { createTestSpeakButton, initTestSpeakResultListener } from '@/utils/test-speak-ui';

let allSpeakers: ParsedSpeaker[] = [];
let currentEngine: TtsEngine = 'voicevox';

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
chrome.storage.sync.get(['ttsEngine', 'localVoicevoxHost'], (data) => {
  currentEngine = (data.ttsEngine as TtsEngine) || 'local-voicevox';
  const host = data.localVoicevoxHost || 'http://localhost:50021';

  const engineLabel = document.getElementById('engine-label')!;
  if (currentEngine === 'browser') {
    engineLabel.textContent = 'ブラウザ内蔵音声';
  } else if (currentEngine === 'local-voicevox') {
    engineLabel.textContent = `ローカル VOICEVOX（${host}）`;
  } else {
    engineLabel.textContent = 'VOICEVOX（Web API）';
  }

  fetchSpeakers(host);
});

// テスト再生結果リスナーを初期化
initTestSpeakResultListener();

function getTestText(): string {
  return (document.getElementById('testText') as HTMLInputElement).value.trim();
}

function fetchSpeakers(localHost: string): void {
  if (currentEngine === 'browser') {
    chrome.tts.getVoices((voices) => {
      const withName = voices.filter((v) => v.voiceName);
      const jaVoices = withName.filter((v) => v.lang?.startsWith('ja'));
      const otherVoices = withName.filter((v) => !v.lang?.startsWith('ja'));
      allSpeakers = [
        ...jaVoices.map((v) => ({
          id: v.voiceName!,
          character: '日本語',
          style: '',
          fullName: `${v.voiceName} (${v.lang || '?'})`,
        })),
        ...otherVoices.map((v) => ({
          id: v.voiceName!,
          character: 'その他',
          style: '',
          fullName: `${v.voiceName} (${v.lang || '?'})`,
        })),
      ];
      render();
    });
  } else if (currentEngine === 'local-voicevox') {
    chrome.runtime.sendMessage(
      { action: 'getLocalSpeakers', host: localHost },
      (response: {
        status: string;
        speakers?: Array<{ name: string; styles: Array<{ id: number; name: string }> }>;
        message?: string;
      }) => {
        if (
          chrome.runtime.lastError ||
          !response ||
          response.status !== 'success' ||
          !response.speakers
        ) {
          showError(
            'ローカル VOICEVOX から話者リストを取得できませんでした。エンジンが起動しているか確認してください。',
          );
          return;
        }
        allSpeakers = parseLocalSpeakers(response.speakers);
        render();
      },
    );
  } else {
    chrome.runtime.sendMessage(
      { action: 'getSpeakerList' },
      (response: { status: string; speakers?: (string | null)[]; message?: string }) => {
        if (
          chrome.runtime.lastError ||
          !response ||
          response.status !== 'success' ||
          !response.speakers
        ) {
          showError('話者リストの取得に失敗しました。');
          return;
        }
        allSpeakers = response.speakers
          .map((name, index) => (name !== null ? parseSpeakerName(String(index), name) : null))
          .filter((s): s is ParsedSpeaker => s !== null);
        render();
      },
    );
  }
}

function showError(msg: string): void {
  const container = document.getElementById('speakerList')!;
  container.innerHTML = `<div class="error-msg">${msg}</div>`;
}

function render(): void {
  const container = document.getElementById('speakerList')!;
  container.innerHTML = '';

  const groups = groupByCharacter(allSpeakers);

  for (const [charName, speakers] of groups) {
    const group = document.createElement('div');
    group.className = 'char-group';
    group.dataset.character = charName;

    // Header
    const header = document.createElement('div');
    header.className = 'char-header';

    const name = document.createElement('span');
    name.className = 'char-name';
    name.textContent = charName;

    const count = document.createElement('span');
    count.className = 'char-count';
    count.textContent = `${speakers.length}スタイル`;

    const arrow = document.createElement('span');
    arrow.className = 'char-arrow';
    arrow.textContent = '\u25B6';

    header.appendChild(name);
    header.appendChild(count);
    header.appendChild(arrow);

    header.addEventListener('click', () => {
      group.classList.toggle('open');
    });

    // Styles list
    const stylesList = document.createElement('div');
    stylesList.className = 'char-styles';

    for (const speaker of speakers) {
      const item = document.createElement('div');
      item.className = 'style-item';
      item.dataset.fullName = speaker.fullName;

      const label = document.createElement('span');
      label.className = 'style-label';
      label.textContent = speaker.style || speaker.fullName;

      const idSpan = document.createElement('span');
      idSpan.className = 'style-id';
      idSpan.textContent = `ID:${speaker.id}`;

      const { playBtn, playStatus } = createTestSpeakButton(speaker.id, getTestText);

      item.appendChild(label);
      item.appendChild(idSpan);
      item.appendChild(playBtn);
      item.appendChild(playStatus);
      stylesList.appendChild(item);
    }

    group.appendChild(header);
    group.appendChild(stylesList);
    container.appendChild(group);
  }
}

// --- Expand / Collapse all ---
document.getElementById('expandAllBtn')!.addEventListener('click', () => {
  document.querySelectorAll<HTMLElement>('.char-group:not(.hidden)').forEach((g) => g.classList.add('open'));
});
document.getElementById('collapseAllBtn')!.addEventListener('click', () => {
  document.querySelectorAll<HTMLElement>('.char-group').forEach((g) => g.classList.remove('open'));
});

// --- Search filter ---
document.getElementById('searchInput')!.addEventListener('input', () => {
  const query = (document.getElementById('searchInput') as HTMLInputElement).value.toLowerCase();

  const groups = document.querySelectorAll<HTMLElement>('.char-group');
  for (const group of groups) {
    const charName = group.dataset.character || '';
    const items = group.querySelectorAll<HTMLElement>('.style-item');
    let visibleCount = 0;

    for (const item of items) {
      const fullName = (item.dataset.fullName || '').toLowerCase();
      const matchesSearch = !query || fullName.includes(query) || charName.toLowerCase().includes(query);

      if (matchesSearch) {
        item.classList.remove('hidden');
        visibleCount++;
      } else {
        item.classList.add('hidden');
      }
    }

    if (visibleCount === 0) {
      group.classList.add('hidden');
    } else {
      group.classList.remove('hidden');
    }
  }
});
