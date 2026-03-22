let currentAudio: HTMLAudioElement | null = null;

chrome.runtime.onMessage.addListener(
  (
    message: { target?: string; action: string; [key: string]: unknown },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message.target !== 'offscreen') return;

    switch (message.action) {
      case 'playAudio':
        playAudio(
          message.url as string,
          message.volume as number,
          message.speed as number
        );
        sendResponse({ status: 'success' });
        break;

      case 'stopAudio':
        stopAudio();
        sendResponse({ status: 'success' });
        break;

      case 'setVolume':
        if (currentAudio) {
          currentAudio.volume = message.volume as number;
        }
        sendResponse({ status: 'success' });
        break;

      case 'setSpeed':
        if (currentAudio) {
          currentAudio.playbackRate = message.speed as number;
        }
        sendResponse({ status: 'success' });
        break;
    }

    return true;
  }
);

function playAudio(url: string, volume: number, speed: number): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  const audio = new Audio(url);
  audio.volume = volume;
  audio.playbackRate = speed;
  currentAudio = audio;

  audio.onended = () => {
    currentAudio = null;
    chrome.runtime.sendMessage({ action: 'audioEnded' }).catch(() => {});
  };

  audio.onerror = () => {
    currentAudio = null;
    chrome.runtime.sendMessage({ action: 'audioError' }).catch(() => {});
  };

  audio.play().catch(() => {
    currentAudio = null;
    chrome.runtime.sendMessage({ action: 'audioError' }).catch(() => {});
  });
}

function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}
