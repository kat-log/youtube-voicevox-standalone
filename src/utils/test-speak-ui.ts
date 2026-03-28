/**
 * テスト再生 UI の共有ユーティリティ
 * 専用ページ・speaker-selection・speaker-config で共通利用
 */

/** 再生ボタン + ステータス span を生成する */
export function createTestSpeakButton(
  speakerId: string,
  getTestText: () => string,
): { playBtn: HTMLButtonElement; playStatus: HTMLSpanElement } {
  const playBtn = document.createElement('button');
  playBtn.className = 'play-btn';
  playBtn.dataset.speakerId = speakerId;
  playBtn.textContent = '\u25B6';
  playBtn.title = 'テスト再生';
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const text = getTestText();
    if (!text) return;
    playBtn.disabled = true;
    chrome.runtime.sendMessage({
      action: 'testSpeak',
      text,
      speakerId,
    });
  });

  const playStatus = document.createElement('span');
  playStatus.className = 'play-status';
  playStatus.dataset.speakerId = speakerId;

  return { playBtn, playStatus };
}

/** testSpeakResult メッセージを受信し、data-speaker-id で対応する UI を更新する */
export function initTestSpeakResultListener(): void {
  chrome.runtime.onMessage.addListener(
    (request: {
      action: string;
      status?: string;
      message?: string;
      speakerId?: string;
    }) => {
      if (request.action !== 'testSpeakResult' || !request.speakerId) return;
      const escapedId = CSS.escape(request.speakerId);
      const btn = document.querySelector(
        `.play-btn[data-speaker-id="${escapedId}"]`,
      ) as HTMLButtonElement | null;
      const statusEl = document.querySelector(
        `.play-status[data-speaker-id="${escapedId}"]`,
      );
      if (!btn || !statusEl) return;

      switch (request.status) {
        case 'generating':
          statusEl.textContent = '生成中...';
          btn.disabled = true;
          break;
        case 'playing':
          statusEl.textContent = '再生中';
          break;
        case 'done':
          statusEl.textContent = '';
          btn.disabled = false;
          break;
        case 'error':
          statusEl.textContent = request.message || 'エラー';
          btn.disabled = false;
          break;
      }
    },
  );
}
