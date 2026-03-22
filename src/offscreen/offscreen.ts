const activeAudios = new Map<string, HTMLAudioElement>();

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
          message.audioId as string,
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
        for (const audio of activeAudios.values()) {
          audio.volume = message.volume as number;
        }
        sendResponse({ status: 'success' });
        break;

      case 'setSpeed':
        for (const audio of activeAudios.values()) {
          audio.playbackRate = message.speed as number;
        }
        sendResponse({ status: 'success' });
        break;
    }

    return true;
  }
);

function playAudio(audioId: string, url: string, volume: number, speed: number): void {
  const audio = new Audio(url);
  audio.volume = volume;
  audio.playbackRate = speed;
  activeAudios.set(audioId, audio);

  audio.onended = () => {
    activeAudios.delete(audioId);
    chrome.runtime.sendMessage({ action: 'audioEnded', audioId }).catch(() => {});
  };

  audio.onerror = () => {
    activeAudios.delete(audioId);
    chrome.runtime.sendMessage({ action: 'audioError', audioId }).catch(() => {});
  };

  audio.play().catch(() => {
    activeAudios.delete(audioId);
    chrome.runtime.sendMessage({ action: 'audioError', audioId }).catch(() => {});
  });
}

function stopAudio(): void {
  for (const audio of activeAudios.values()) {
    audio.pause();
  }
  activeAudios.clear();
}
