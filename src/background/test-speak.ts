import { getTtsEngine, getBrowserVoice, fetchVoiceVox, fetchLocalVoiceVox } from './tts-api';
import { ensureOffscreenDocument, correctTtsRate, isRateSupportedVoice } from './audio-player';
import { logInfo, logDebug, logWarn, logError } from './messaging';

let testAudioCounter = 0;
const testAudioSpeakerMap = new Map<string, string>();

function generateTestAudioId(): string {
  return `test-${Date.now()}-${testAudioCounter++}`;
}

// テスト再生の進捗を popup / 専用ページにブロードキャスト
function sendTestSpeakResult(
  status: 'generating' | 'playing' | 'done' | 'error',
  message?: string,
  speakerId?: string,
): void {
  chrome.runtime
    .sendMessage({ action: 'testSpeakResult', status, message, speakerId })
    .catch(() => {});
}

export async function handleTestSpeak(
  text: string,
  speakerId?: string,
): Promise<{ status: string; message?: string }> {
  const engine = getTtsEngine();
  const audioId = generateTestAudioId();

  if (speakerId) {
    testAudioSpeakerMap.set(audioId, speakerId);
  }

  logInfo(`テスト再生開始 [${engine}]: "${text}"${speakerId ? ` (speaker: ${speakerId})` : ''}`);
  sendTestSpeakResult('generating', undefined, speakerId);

  try {
    const data = await chrome.storage.sync.get([
      'volume',
      'speed',
      'apiKeyVOICEVOX',
      'speakerId',
      'localSpeakerId',
    ]);
    const volume: number = data.volume ?? 1.0;
    const speed: number = data.speed ?? 1.0;

    if (engine === 'browser') {
      const voiceName = speakerId || getBrowserVoice();
      sendTestSpeakResult('playing', undefined, speakerId);

      return new Promise((resolve) => {
        chrome.tts.speak(
          text,
          {
            voiceName: voiceName || undefined,
            lang: 'ja-JP',
            rate: isRateSupportedVoice(voiceName || undefined)
              ? correctTtsRate(speed)
              : 1.0,
            volume: isRateSupportedVoice(voiceName || undefined) ? volume : 1.0,
            onEvent: (event) => {
              if (
                event.type === 'end' ||
                event.type === 'interrupted' ||
                event.type === 'cancelled'
              ) {
                sendTestSpeakResult('done', undefined, speakerId);
                logDebug(`テスト再生完了 [${audioId}]`);
              } else if (event.type === 'error') {
                sendTestSpeakResult(
                  'error',
                  event.errorMessage || '不明なエラー',
                  speakerId,
                );
                logWarn(
                  `テスト再生エラー [${audioId}]: ${event.errorMessage}`,
                );
              }
            },
          },
          () => {
            if (chrome.runtime.lastError) {
              sendTestSpeakResult('error', chrome.runtime.lastError.message, speakerId);
              resolve({
                status: 'error',
                message: chrome.runtime.lastError.message,
              });
            } else {
              resolve({ status: 'success' });
            }
          },
        );
      });
    }

    // voicevox / local-voicevox: 合成 → offscreen で再生
    let audioUrl: string;

    if (engine === 'local-voicevox') {
      audioUrl = await fetchLocalVoiceVox(text, speakerId || data.localSpeakerId);
    } else {
      audioUrl = await fetchVoiceVox(
        data.apiKeyVOICEVOX || '',
        text,
        speakerId || data.speakerId,
      );
    }

    logDebug(`テスト再生 音声取得完了 [${audioId}]`);
    sendTestSpeakResult('playing', undefined, speakerId);

    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'playAudio',
      audioId,
      url: audioUrl,
      volume,
      speed,
    });

    return { status: 'success' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '不明なエラー';
    sendTestSpeakResult('error', msg, speakerId);
    logError(`テスト再生エラー [${audioId}]: ${msg}`);
    return { status: 'error', message: msg };
  }
}

/** audioId がテスト再生用かどうかを判定 */
export function isTestAudioId(audioId: string): boolean {
  return audioId.startsWith('test-');
}

/** テスト再生の音声終了ハンドラ（カウンター・バッジ更新なし） */
export function handleTestAudioEnded(audioId: string): void {
  const speakerId = testAudioSpeakerMap.get(audioId);
  testAudioSpeakerMap.delete(audioId);
  sendTestSpeakResult('done', undefined, speakerId);
  logDebug(`テスト再生完了 [${audioId}]`);
}

/** テスト再生の音声エラーハンドラ */
export function handleTestAudioError(audioId: string): void {
  const speakerId = testAudioSpeakerMap.get(audioId);
  testAudioSpeakerMap.delete(audioId);
  sendTestSpeakResult('error', 'Offscreen再生エラー', speakerId);
  logWarn(`テスト再生エラー [${audioId}]`);
}
